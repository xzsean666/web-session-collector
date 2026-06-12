#!/usr/bin/env bash
#
# 持续调用小红书采集 API,把去重后的笔记写入 data/ 目录,每轮完成向 Slack 发送通知。
#
# 用法:
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz \
#     ./examples/collect-loop.sh "美食" "旅行"
#
#   # 关键词也可以放进 examples/keywords.txt(每行一个,# 开头为注释),然后:
#   SLACK_WEBHOOK_URL=... ./examples/collect-loop.sh
#
#   # 只跑一轮(不循环),适合测试:
#   ONCE=1 ./examples/collect-loop.sh "美食"
#
# 可配置环境变量:
#   BASE_URL          API 地址            (默认 http://100.90.168.1:10085)
#   IDLE_NOVNC_URL   idle noVNC 地址(提醒用) (默认 http://100.90.168.1:10087/vnc.html)
#   SLACK_WEBHOOK_URL Slack Incoming Webhook;未设置则跳过通知
#   SLACK_EACH_SESSION_NOTICE 逐条新笔记通知是否附带 session 提示 (默认 0)
#   DATA_DIR          数据目录            (默认 <仓库>/data)
#   KEYWORDS_FILE     关键词文件          (默认 <脚本目录>/keywords.txt)
#   KEYWORDS          关键词字符串(逗号或空格分隔),优先级低于命令行参数
#   INTERVAL          每轮之间的间隔秒数  (默认 1800 = 30 分钟)
#   ONCE              设为非空则只跑一轮
#   RECENT_DAYS / LIMIT / SCROLL_COUNT  覆盖搜索参数(留空则用服务端默认值)
#   BUSY_RETRIES / BUSY_WAIT  遇到 409 任务忙时的重试次数 / 间隔秒数 (默认 10 / 15)
#   FAILOVER          active session 失效时是否自动切换到可用备用 session (默认 1)
#   SESSION_RESTART   failover 前是否先重启当前 session 浏览器尝试恢复 (默认 1)
#   SESSION_RECOVERY_RETRIES / SESSION_RESTART_WAIT  重启恢复次数 / 重启后等待秒数 (默认 1 / 5)
#   SESSION_PREFLIGHT 搜索前是否强制检查登录态;0=搜索优先,失败再恢复 (默认 0)
#
set -uo pipefail

# ----- 配置 -----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 自动加载同目录下的 .env(ENV_FILE 可覆盖路径)。.env 里的值会成为下面各项的默认值。
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

BASE_URL="${BASE_URL:-http://100.90.168.1:10085}"
IDLE_NOVNC_URL="${IDLE_NOVNC_URL:-http://100.90.168.1:10087/vnc.html}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
SLACK_EACH_SESSION_NOTICE="${SLACK_EACH_SESSION_NOTICE:-0}"
DATA_DIR="${DATA_DIR:-${REPO_DIR}/data}"
KEYWORDS_FILE="${KEYWORDS_FILE:-${SCRIPT_DIR}/keywords.txt}"
INTERVAL="${INTERVAL:-1800}"
ONCE="${ONCE:-}"
RECENT_DAYS="${RECENT_DAYS:-}"
LIMIT="${LIMIT:-}"
SCROLL_COUNT="${SCROLL_COUNT:-}"
BUSY_RETRIES="${BUSY_RETRIES:-10}"
BUSY_WAIT="${BUSY_WAIT:-15}"
FAILOVER="${FAILOVER:-1}"
SESSION_RESTART="${SESSION_RESTART:-1}"
SESSION_RECOVERY_RETRIES="${SESSION_RECOVERY_RETRIES:-1}"
SESSION_RESTART_WAIT="${SESSION_RESTART_WAIT:-5}"
SESSION_PREFLIGHT="${SESSION_PREFLIGHT:-0}"

NOTES_FILE="${DATA_DIR}/notes.jsonl"
SEEN_FILE="${DATA_DIR}/seen_ids.txt"
LOG_FILE="${DATA_DIR}/collect.log"
SESSION_FAILOVER_NOTICE=""
export WSC_SESSION_NOTICE=""

# PID / 锁文件放在 /tmp 固定路径 —— 全机只允许一个采集实例(与 DATA_DIR 无关)。
# 可用 PID_FILE / LOCK_FILE 环境变量覆盖。
PID_FILE="${PID_FILE:-/tmp/wsc-collect-loop.pid}"
LOCK_FILE="${LOCK_FILE:-/tmp/wsc-collect-loop.lock}"

mkdir -p "${DATA_DIR}"
touch "${SEEN_FILE}" "${NOTES_FILE}"

# ----- 关键词解析(命令行 > KEYWORDS 环境变量 > 关键词文件)-------------------
KW_LIST=()
if [ "$#" -gt 0 ]; then
  KW_LIST=("$@")
elif [ -n "${KEYWORDS:-}" ]; then
  # 只按逗号(或换行)分隔;单个关键词内部的空格保留,用于联合搜索(如 "美食 火锅")
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -n "$line" ] && KW_LIST+=("$line")
  done < <(printf '%s' "${KEYWORDS}" | tr ',' '\n')
elif [ -f "${KEYWORDS_FILE}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"                 # 去掉行内注释
    line="$(printf '%s' "$line" | xargs)"   # 去掉首尾空白
    [ -n "$line" ] && KW_LIST+=("$line")
  done < "${KEYWORDS_FILE}"
fi
if [ "${#KW_LIST[@]}" -eq 0 ]; then
  echo "错误:没有关键词。请用命令行参数、KEYWORDS 环境变量,或 ${KEYWORDS_FILE} 提供。" >&2
  exit 1
fi

# ----- 单实例保护(flock 锁 + PID 文件)-------------------------------------
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "错误:已有一个采集实例在运行(PID: $(cat "${PID_FILE}" 2>/dev/null || echo '?'),锁:${LOCK_FILE})。" >&2
    exit 1
  fi
else
  # 无 flock 时用 PID 文件兜底:若记录的进程仍存活,则拒绝启动
  if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}" 2>/dev/null)" 2>/dev/null; then
    echo "错误:已有一个采集实例在运行(PID: $(cat "${PID_FILE}"))。" >&2
    exit 1
  fi
fi
echo "$$" > "${PID_FILE}"

# ----- 去重写入辅助脚本(临时文件,退出时清理)-------------------------------
PYHELPER="$(mktemp)"
cleanup() { rm -f "${PYHELPER}" "${PID_FILE}"; }
trap cleanup EXIT
cat > "${PYHELPER}" <<'PY'
# 从 stdin 读取搜索 API 的响应 JSON,按 itemId 去重后追加写入 notes 文件;
# 同时(可选)把每一条【新】笔记单独发到 Slack,方便实时查看最新内容。
# argv: <seen_file> <notes_file> <collectedAt>
# 环境变量:SLACK_WEBHOOK_URL;SLACK_EACH(默认1,逐条发送开关);
#           SLACK_EACH_MAX(默认50,每轮逐条发送上限);SLACK_EACH_DELAY(默认1,逐条间隔秒)
#           SLACK_EACH_SESSION_NOTICE(默认0,逐条通知是否附带 session 提示)
import json, os, sys, time, urllib.request

seen_file, notes_file, ts = sys.argv[1], sys.argv[2], sys.argv[3]
webhook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
each = os.environ.get("SLACK_EACH", "1").strip().lower() not in ("", "0", "false", "no")
each_max = int(os.environ.get("SLACK_EACH_MAX", "50") or 50)
each_delay = float(os.environ.get("SLACK_EACH_DELAY", "1") or 1)
session_notice = os.environ.get("WSC_SESSION_NOTICE", "").strip()
each_session_notice = os.environ.get("SLACK_EACH_SESSION_NOTICE", "0").strip().lower() not in ("", "0", "false", "no")

def post_slack(text):
    if each_session_notice and session_notice:
        text = text + "\n\n" + session_notice
    payload = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        webhook, data=payload, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception:
        pass

def fmt(it, kw):
    title = it.get("title") or "(无标题)"
    author = it.get("author") or ""
    likes = it.get("likeCountText") or ""
    comments = it.get("commentCountText") or ""
    when = it.get("publishedAtText") or (it.get("publishedAt") or "")[:10]
    url = it.get("url") or ""
    content = (it.get("content") or "").strip()
    tags = it.get("tags") or []
    meta = " · ".join(x for x in [
        f"👤 {author}" if author else "",
        f"👍 {likes}" if likes else "",
        f"💬 {comments}" if comments else "",
        f"📅 {when}" if when else "",
    ] if x)
    parts = [f"📝 [{kw}] {title}"]
    if meta:
        parts.append(meta)
    if content:
        snippet = content[:200] + ("…" if len(content) > 200 else "")
        parts.append(snippet)
    if tags:
        parts.append("🏷️ " + " ".join(f"#{t}" for t in tags[:10]))
    if url:
        parts.append(f"🔗 {url}")
    return "\n".join(parts)

data = json.load(sys.stdin)

seen = set()
if os.path.exists(seen_file):
    with open(seen_file, encoding="utf-8") as fh:
        seen = {ln.strip() for ln in fh if ln.strip()}

new = 0
sent = 0
per = {}
results = (data.get("data") or {}).get("results") or []
with open(notes_file, "a", encoding="utf-8") as nf, \
     open(seen_file, "a", encoding="utf-8") as sf:
    for r in results:
        kw = r.get("keyword", "")
        per.setdefault(kw, 0)
        for it in r.get("matchedItems", []):
            nid = str(it.get("itemId") or "").strip()
            if not nid:
                url = str(it.get("url") or "").strip()
                nid = url.rstrip("/").split("/")[-1].split("?")[0] if url else ""
            if not nid or nid in seen:
                continue
            seen.add(nid)
            rec = dict(it)
            rec["_id"] = nid
            rec["_searchKeyword"] = kw
            rec["_collectedAt"] = ts
            nf.write(json.dumps(rec, ensure_ascii=False) + "\n")
            sf.write(nid + "\n")
            new += 1
            per[kw] += 1
            if each and webhook and sent < each_max:
                post_slack(fmt(it, kw))
                sent += 1
                if each_delay > 0:
                    time.sleep(each_delay)

print(json.dumps({"new": new, "perKeyword": per, "sent": sent}, ensure_ascii=False))
PY

# ----- 工具函数 -------------------------------------------------------------
log() {
  local line
  line="[$(date '+%F %T')] $*"
  echo "${line}"
  echo "${line}" >> "${LOG_FILE}"
}

send_slack() {
  local msg="$1"
  local include_session_notice="${2:-0}"
  local notice=""
  if [ -z "${SLACK_WEBHOOK_URL}" ]; then
    log "(未配置 SLACK_WEBHOOK_URL,跳过 Slack 通知)"
    return 0
  fi
  case "${include_session_notice}" in
    1|true|TRUE|yes|YES|session)
      notice="$(session_slack_notice)"
      ;;
  esac
  if [ -n "${notice}" ]; then
    msg="${msg}"$'\n\n'"${notice}"
  fi
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "${msg}")"
  if ! curl -fsS -m 15 -X POST -H "Content-Type: application/json" \
        -d "${payload}" "${SLACK_WEBHOOK_URL}" >/dev/null 2>&1; then
    log "⚠️ Slack 通知发送失败"
  fi
}

session_slack_notice() {
  local bad_sessions_notice
  bad_sessions_notice="$(all_bad_sessions_notice)"

  if [ -n "${SESSION_FAILOVER_NOTICE}" ]; then
    if [ -n "${bad_sessions_notice}" ]; then
      printf '%s\n\n%s' "${SESSION_FAILOVER_NOTICE}" "${bad_sessions_notice}"
      return 0
    fi

    printf '%s' "${SESSION_FAILOVER_NOTICE}"
    return 0
  fi

  if [ -n "${bad_sessions_notice}" ]; then
    printf '%s' "${bad_sessions_notice}"
    return 0
  fi

  printf '%s' ""
}

all_bad_sessions_notice() {
  curl -fsS -m 10 "${BASE_URL}/api/sessions" 2>/dev/null | python3 -c '
import json
import sys

base_url = sys.argv[1]
idle_novnc_url = sys.argv[2]
bad_states = {"logged_out", "challenge_required", "browser_closed", "error"}

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

bad_sessions = []
active_bad_sessions = []

for session in data.get("sessions") or []:
    session_id = str(session.get("id") or "").strip()
    state = str(session.get("state") or "unknown").strip()
    if not session_id or state not in bad_states:
        continue

    item = (session_id, state)
    if session.get("isApiActive"):
        active_bad_sessions.append(item)
    else:
        bad_sessions.append(item)

if not bad_sessions and not active_bad_sessions:
    sys.exit(0)

print("Session: 发现需要重新登录/处理的 session。")
if active_bad_sessions:
    print("当前 active 里也有失效 session;可以直接把它显示到 idle noVNC,10087 会镜像 active。")

for session_id, state in bad_sessions:
    print(f"- {session_id} ({state})")
    print("  登录命令:")
    print(f"  curl -s -X POST \"{base_url}/api/sessions/{session_id}/idle-novnc\"")
    print("  检查命令:")
    print(f"  curl -s -X POST \"{base_url}/api/session/check?sessionId={session_id}\"")

for session_id, state in active_bad_sessions:
    print(f"- {session_id} ({state}, active)")
    print("  登录命令:")
    print(f"  curl -s -X POST \"{base_url}/api/sessions/{session_id}/idle-novnc\"")
    print("  检查命令:")
    print(f"  curl -s -X POST \"{base_url}/api/session/check?sessionId={session_id}\"")

print(f"登录入口: {idle_novnc_url}")
print("处理方式: 一次只处理一个 session;执行其中一条登录命令,打开 10087 登录,检查通过后再处理下一条。")
' "${BASE_URL}" "${IDLE_NOVNC_URL}" 2>/dev/null || true
}

read_session_state_from_status() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('session',{}).get('state','unknown'))" \
    2>/dev/null || echo unknown
}

read_active_session_id_from_status() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('apiActiveSessionId') or '')" \
    2>/dev/null || true
}

read_session_state_from_check() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('session',{}).get('state','unknown'))" \
    2>/dev/null || echo unknown
}

refresh_session_state() {
  curl -fsS -m 30 -X POST "${BASE_URL}/api/session/check" 2>/dev/null \
    | read_session_state_from_check
}

session_state_for() {
  local session_id="$1"
  curl -fsS -m 30 -X POST "${BASE_URL}/api/session/check?sessionId=${session_id}" 2>/dev/null \
    | read_session_state_from_check
}

is_blocking_session_state() {
  case "$1" in
    logged_out|challenge_required|browser_closed|error)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_failover_http_status() {
  case "$1" in
    000|423|428|500|502|503|504)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

current_active_session_id() {
  curl -fsS -m 10 "${BASE_URL}/api/status" 2>/dev/null \
    | read_active_session_id_from_status
}

find_ready_fallback_session() {
  curl -fsS -m 10 "${BASE_URL}/api/sessions" | python3 -c '
import json, sys

data = json.load(sys.stdin)
for session in data.get("sessions") or []:
    if session.get("isApiActive"):
        continue
    if session.get("state") != "logged_in":
        continue
    if session.get("activeTask") is not None:
        continue
    if (session.get("monitor") or {}).get("running"):
        continue
    if not (session.get("browser") or {}).get("ready", False):
        continue
    if (session.get("page") or {}).get("closed", True):
        continue
    session_id = str(session.get("id") or "").strip()
    if session_id:
        print(session_id)
        break
' 2>/dev/null || true
}

list_restartable_fallback_sessions() {
  curl -fsS -m 10 "${BASE_URL}/api/sessions" | python3 -c '
import json, sys

data = json.load(sys.stdin)
for session in data.get("sessions") or []:
    if session.get("isApiActive"):
        continue
    if session.get("activeTask") is not None:
        continue
    if (session.get("monitor") or {}).get("running"):
        continue
    session_id = str(session.get("id") or "").strip()
    if session_id:
        print(session_id)
' 2>/dev/null || true
}

find_recovered_fallback_session() {
  local session_id

  case "${SESSION_RESTART}" in
    0|false|FALSE|no|NO)
      return 1
      ;;
  esac

  while IFS= read -r session_id; do
    [ -z "${session_id}" ] && continue
    if restart_session_browser "${session_id}" "fallback_recovery" >&2; then
      printf '%s\n' "${session_id}"
      return 0
    fi
  done < <(list_restartable_fallback_sessions)

  return 1
}

activate_fallback_session() {
  local current_state="$1"
  local failed_session_id="${2:-}"
  local fallback_session_id
  local login_command
  local idle_hint

  case "${FAILOVER}" in
    0|false|FALSE|no|NO)
      return 1
      ;;
  esac

  if [ -z "${failed_session_id}" ]; then
    failed_session_id="$(current_active_session_id)"
  fi

  fallback_session_id="$(find_ready_fallback_session)"
  if [ -z "${fallback_session_id}" ]; then
    fallback_session_id="$(find_recovered_fallback_session)"
  fi

  if [ -z "${fallback_session_id}" ]; then
    return 1
  fi

  log "active session state=${current_state},切换到备用 session:${fallback_session_id}"

  if curl -fsS -m 60 -X POST "${BASE_URL}/api/sessions/${fallback_session_id}/activate" >/dev/null 2>&1; then
    log "已激活备用 session:${fallback_session_id}"
    if [ -n "${failed_session_id}" ] && [ "${failed_session_id}" != "${fallback_session_id}" ]; then
      login_command="curl -s -X POST \"${BASE_URL}/api/sessions/${failed_session_id}/idle-novnc\""
      if curl -fsS -m 60 -X POST "${BASE_URL}/api/sessions/${failed_session_id}/idle-novnc" >/dev/null 2>&1; then
        idle_hint="已自动把失效 session 放到 idle noVNC;你可以直接打开 10087 登录。"
      else
        idle_hint="自动设置 idle noVNC 失败;请先手动执行下面的登录命令。"
      fi
    else
      login_command="curl -s -X POST \"${BASE_URL}/api/sessions/<失效sessionId>/idle-novnc\""
      idle_hint="未能确定失效 session id;请把命令里的 <失效sessionId> 换成要登录的 session。"
    fi
    SESSION_FAILOVER_NOTICE="$(printf 'Session: 检测到 active session 失效。\n失效 session: %s (%s)\n已切换备用 session: %s\n%s\n登录命令:\n```bash\n%s\n```\n登录入口: %s' \
      "${failed_session_id:-unknown}" \
      "${current_state}" \
      "${fallback_session_id}" \
      "${idle_hint}" \
      "${login_command}" \
      "${IDLE_NOVNC_URL}")"
    export WSC_SESSION_NOTICE="$(session_slack_notice)"
    return 0
  fi

  log "⚠️ 备用 session 激活失败:${fallback_session_id}"
  return 1
}

restart_session_browser() {
  local session_id="$1"
  local reason="${2:-session_recovery}"
  local state

  case "${SESSION_RESTART}" in
    0|false|FALSE|no|NO)
      return 1
      ;;
  esac

  if [ -z "${session_id}" ]; then
    return 1
  fi

  log "active session ${session_id} state=${reason},先重启浏览器尝试恢复"
  if ! curl -fsS -m 120 -X POST "${BASE_URL}/api/sessions/${session_id}/restart" >/dev/null 2>&1; then
    log "⚠️ session 浏览器重启失败:${session_id}"
    return 1
  fi

  sleep "${SESSION_RESTART_WAIT}"
  state="$(session_state_for "${session_id}")"
  log "重启后 session ${session_id} state=${state}"
  [ -n "${state}" ] && ! is_blocking_session_state "${state}"
}

recover_active_session() {
  local current_state="$1"
  local failed_session_id="${2:-}"
  local attempt

  if [ -z "${failed_session_id}" ]; then
    failed_session_id="$(current_active_session_id)"
  fi

  for attempt in $(seq 1 "${SESSION_RECOVERY_RETRIES}"); do
    if restart_session_browser "${failed_session_id}" "${current_state}"; then
      SESSION_FAILOVER_NOTICE="$(printf 'Session: 检测到 active session 异常,已通过重启浏览器恢复。\n恢复 session: %s\n原状态: %s\n重启次数: %s' \
        "${failed_session_id:-unknown}" \
        "${current_state}" \
        "${attempt}")"
      export WSC_SESSION_NOTICE="$(session_slack_notice)"
      return 0
    fi
  done

  if activate_fallback_session "${current_state}" "${failed_session_id}"; then
    return 0
  fi

  SESSION_FAILOVER_NOTICE="$(printf 'Session: active session 自动恢复失败。\n失效 session: %s (%s)\n已尝试: 重启浏览器 %s 次 + 切换备用 session\n结果: 没有可用 logged_in 备用 session,或备用 session 激活失败。\n登录命令:\n```bash\ncurl -s -X POST "%s/api/sessions/%s/idle-novnc"\n```\n登录入口: %s' \
    "${failed_session_id:-unknown}" \
    "${current_state}" \
    "${SESSION_RECOVERY_RETRIES}" \
    "${BASE_URL}" \
    "${failed_session_id:-unknown}" \
    "${IDLE_NOVNC_URL}")"
  export WSC_SESSION_NOTICE="$(session_slack_notice)"
  return 1
}

build_payload() {
  python3 - "$1" "${SEEN_FILE}" <<'PY'
import json, os, sys
body = {"keyword": sys.argv[1]}
for env_key, body_key in (("RECENT_DAYS", "recentDays"),
                          ("LIMIT", "limitPerKeyword"),
                          ("SCROLL_COUNT", "scrollCount")):
    val = os.environ.get(env_key, "").strip()
    if val:
        body[body_key] = int(val)
# FETCH_CONTENT 为真时,要求 API 额外打开详情页抓取正文/标签/图片
fc = os.environ.get("FETCH_CONTENT", "").strip().lower()
if fc in ("1", "true", "yes", "y"):
    body["fetchContent"] = True
# 把已采集过的 id 传给 API,让它跳过这些笔记的详情页(去重前置,省下大量重复抓取)。
seen_file = sys.argv[2] if len(sys.argv) > 2 else ""
try:
    exclude_max = int(os.environ.get("EXCLUDE_MAX", "500") or 500)
except ValueError:
    exclude_max = 500
if seen_file and os.path.exists(seen_file):
    with open(seen_file, encoding="utf-8") as fh:
        ids = [ln.strip() for ln in fh if ln.strip()]
    if ids:
        body["excludeItemIds"] = ids[-exclude_max:] if exclude_max > 0 else ids
print(json.dumps(body, ensure_ascii=False))
PY
}

# ----- 单轮采集 -------------------------------------------------------------
run_cycle() {
  SESSION_FAILOVER_NOTICE=""
  export WSC_SESSION_NOTICE="$(session_slack_notice)"

  # 1) 健康检查
  if ! curl -fsS -m 10 "${BASE_URL}/health" >/dev/null 2>&1; then
    SESSION_FAILOVER_NOTICE="Session: 本轮无法检查 session 状态,API 不可达。"
    export WSC_SESSION_NOTICE="${SESSION_FAILOVER_NOTICE}"
    log "❌ API 不可达:${BASE_URL}"
    send_slack "🔴 采集失败:API 不可达 (${BASE_URL})" 1
    return 1
  fi

  # 2) 登录态检查。默认搜索优先:只把搜索 API 的实际失败当成恢复触发条件。
  local state active_session_id status_body
  status_body="$(curl -fsS -m 10 "${BASE_URL}/api/status" 2>/dev/null || true)"
  state="$(printf '%s' "${status_body}" | read_session_state_from_status)"
  active_session_id="$(printf '%s' "${status_body}" | read_active_session_id_from_status)"

  case "${SESSION_PREFLIGHT}" in
    1|true|TRUE|yes|YES)
      if [ "${state}" != "logged_in" ]; then
        log "登录态缓存为 state=${state},主动刷新一次"
        state="$(refresh_session_state)"
      fi

      if is_blocking_session_state "${state}"; then
        if recover_active_session "${state}" "${active_session_id}"; then
          state="$(refresh_session_state)"
          active_session_id="$(current_active_session_id)"
          log "切换后 active session state=${state}"
        else
          log "⚠️ 账号未登录(state=${state}),且没有可用备用 session,跳过本轮"
          send_slack "🟠 采集跳过:账号未登录 (state=${state}),自动恢复和 failover 都失败。请打开 idle noVNC 登录:${IDLE_NOVNC_URL}" 1
          return 1
        fi
      fi

      if is_blocking_session_state "${state}"; then
        log "⚠️ 切换后账号仍不可用(state=${state}),跳过本轮"
        send_slack "🟠 采集跳过:切换后账号仍不可用 (state=${state})。请打开 idle noVNC 登录:${IDLE_NOVNC_URL}" 1
        return 1
      fi

      if [ "${state}" != "logged_in" ]; then
        log "⚠️ 登录态无法确认(state=${state}),继续尝试搜索"
      fi
      ;;
    *)
      log "搜索优先:跳过登录态前置拦截(state=${state}),由搜索结果决定是否恢复"
      ;;
  esac

  export WSC_SESSION_NOTICE="$(session_slack_notice)"

  # 3) 逐个关键词采集
  local total_new=0 summary_kw="" errors=""
  local kw payload resp code body attempt ts stat newc
  for kw in "${KW_LIST[@]}"; do
    payload="$(build_payload "${kw}")"
    code=""; body=""
    for attempt in $(seq 1 "${BUSY_RETRIES}"); do
      resp="$(curl -s -m 300 -w $'\n%{http_code}' -X POST \
        "${BASE_URL}/api/xiaohongshu/search" \
        -H "Content-Type: application/json" -d "${payload}" 2>/dev/null)"
      code="${resp##*$'\n'}"
      body="${resp%$'\n'*}"
      [ "${code}" = "200" ] && break
      if [ "${code}" = "409" ]; then
        log "  [${kw}] 任务忙(409),${BUSY_WAIT}s 后重试(${attempt}/${BUSY_RETRIES})"
        sleep "${BUSY_WAIT}"
        continue
      fi
      if is_failover_http_status "${code}"; then
        active_session_id="$(current_active_session_id)"
        if recover_active_session "search_http_${code}" "${active_session_id}"; then
          active_session_id="$(current_active_session_id)"
          log "  [${kw}] session 已恢复或已切换备用,重试当前关键词(${attempt}/${BUSY_RETRIES})"
          continue
        fi
      fi
      break
    done

    if [ "${code}" != "200" ]; then
      log "  [${kw}] 请求失败 HTTP ${code}"
      errors+="${kw}(HTTP ${code}) "
      continue
    fi

    # 本地时间(带时区偏移,如 +0900);受 .env 里的 TZ 控制(对应服务器所在地)。
    ts="$(date +%FT%T%z)"
    stat="$(printf '%s' "${body}" | python3 "${PYHELPER}" "${SEEN_FILE}" "${NOTES_FILE}" "${ts}" 2>/dev/null)"
    newc="$(printf '%s' "${stat}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('new',0))" 2>/dev/null || echo 0)"
    total_new=$(( total_new + newc ))
    summary_kw+="${kw}(+${newc}) "
    log "  [${kw}] 新增 ${newc} 条"
  done

  # 4) 汇总 + Slack 通知
  local total_seen
  total_seen="$(wc -l < "${SEEN_FILE}" 2>/dev/null | tr -d ' ')"
  total_seen="${total_seen:-0}"

  local emoji header msg
  if [ -n "${errors}" ]; then
    emoji="⚠️"; header="采集完成(部分失败)"
  else
    emoji="🟢"; header="采集完成"
  fi
  msg="$(printf '%s %s %s\n关键词: %s\n本轮新增: %s 条 | 累计(去重): %s 条\n数据文件: %s' \
    "${emoji}" "${header}" "$(date '+%F %T')" "${summary_kw}" "${total_new}" "${total_seen}" "${NOTES_FILE}")"
  [ -n "${errors}" ] && msg="${msg}"$'\n'"🔴 API 请求失败: ${errors}"

  log "本轮完成:新增 ${total_new} 条,累计去重 ${total_seen} 条${errors:+,失败: ${errors}}"
  if [ -n "${errors}" ]; then
    send_slack "${msg}" 1
  else
    send_slack "${msg}"
  fi
  return 0
}

# ----- 主循环 ---------------------------------------------------------------
log "采集启动 | 关键词: ${KW_LIST[*]} | 间隔: ${INTERVAL}s | 数据目录: ${DATA_DIR}"
while true; do
  run_cycle || true
  if [ -n "${ONCE}" ]; then
    log "ONCE=1,单轮结束退出。"
    break
  fi
  log "等待 ${INTERVAL}s 进入下一轮…"
  sleep "${INTERVAL}"
done
