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
#   NOVNC_URL         noVNC 地址(提醒用) (默认 http://100.90.168.1:10086/vnc.html)
#   SLACK_WEBHOOK_URL Slack Incoming Webhook;未设置则跳过通知
#   DATA_DIR          数据目录            (默认 <仓库>/data)
#   KEYWORDS_FILE     关键词文件          (默认 <脚本目录>/keywords.txt)
#   KEYWORDS          关键词字符串(逗号或空格分隔),优先级低于命令行参数
#   INTERVAL          每轮之间的间隔秒数  (默认 1800 = 30 分钟)
#   ONCE              设为非空则只跑一轮
#   RECENT_DAYS / LIMIT / SCROLL_COUNT  覆盖搜索参数(留空则用服务端默认值)
#   BUSY_RETRIES / BUSY_WAIT  遇到 409 任务忙时的重试次数 / 间隔秒数 (默认 10 / 15)
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
NOVNC_URL="${NOVNC_URL:-http://100.90.168.1:10086/vnc.html}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
DATA_DIR="${DATA_DIR:-${REPO_DIR}/data}"
KEYWORDS_FILE="${KEYWORDS_FILE:-${SCRIPT_DIR}/keywords.txt}"
INTERVAL="${INTERVAL:-1800}"
ONCE="${ONCE:-}"
RECENT_DAYS="${RECENT_DAYS:-}"
LIMIT="${LIMIT:-}"
SCROLL_COUNT="${SCROLL_COUNT:-}"
BUSY_RETRIES="${BUSY_RETRIES:-10}"
BUSY_WAIT="${BUSY_WAIT:-15}"

NOTES_FILE="${DATA_DIR}/notes.jsonl"
SEEN_FILE="${DATA_DIR}/seen_ids.txt"
LOG_FILE="${DATA_DIR}/collect.log"

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
import json, os, sys, time, urllib.request

seen_file, notes_file, ts = sys.argv[1], sys.argv[2], sys.argv[3]
webhook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
each = os.environ.get("SLACK_EACH", "1").strip().lower() not in ("", "0", "false", "no")
each_max = int(os.environ.get("SLACK_EACH_MAX", "50") or 50)
each_delay = float(os.environ.get("SLACK_EACH_DELAY", "1") or 1)

def post_slack(text):
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
  if [ -z "${SLACK_WEBHOOK_URL}" ]; then
    log "(未配置 SLACK_WEBHOOK_URL,跳过 Slack 通知)"
    return 0
  fi
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "${msg}")"
  if ! curl -fsS -m 15 -X POST -H "Content-Type: application/json" \
        -d "${payload}" "${SLACK_WEBHOOK_URL}" >/dev/null 2>&1; then
    log "⚠️ Slack 通知发送失败"
  fi
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
  # 1) 健康检查
  if ! curl -fsS -m 10 "${BASE_URL}/health" >/dev/null 2>&1; then
    log "❌ API 不可达:${BASE_URL}"
    send_slack "🔴 采集失败:API 不可达 (${BASE_URL})"
    return 1
  fi

  # 2) 登录态检查
  local state
  state="$(curl -fsS -m 10 "${BASE_URL}/api/status" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('session',{}).get('state','unknown'))" 2>/dev/null || echo unknown)"
  if [ "${state}" != "logged_in" ]; then
    log "⚠️ 账号未登录(state=${state}),跳过本轮"
    send_slack "🟠 采集跳过:账号未登录 (state=${state})。请打开 noVNC 登录:${NOVNC_URL}"
    return 1
  fi

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
  send_slack "${msg}"
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
