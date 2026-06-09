#!/usr/bin/env bash
#
# 调用 web-session-collector(小红书)HTTP API 的示例脚本。
#
# 用法:
#   ./examples/call-search-api.sh "美食"
#   ./examples/call-search-api.sh "美食" "旅行" "穿搭"          # 多关键词
#   BASE_URL=http://127.0.0.1:10085 ./examples/call-search-api.sh "美食"
#
# 可调参数(均为环境变量,留空则用服务端默认值):
#   BASE_URL         API 地址,默认 http://100.90.168.1:10085
#   IDLE_NOVNC_URL   idle noVNC 地址,默认 http://100.90.168.1:10087/vnc.html
#   RECENT_DAYS      只保留最近 N 天的笔记(0 = 不过滤)
#   LIMIT            每个关键词最多返回多少条
#   SCROLL_COUNT     搜索结果页向下滚动加载的次数(越大抓得越多、越慢)
#   FAILOVER         active session 失效时是否自动切换到可用备用 session,默认 1
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://100.90.168.1:10085}"
IDLE_NOVNC_URL="${IDLE_NOVNC_URL:-http://100.90.168.1:10087/vnc.html}"
FAILOVER="${FAILOVER:-1}"

if [[ $# -lt 1 ]]; then
  echo "用法: $0 <关键词> [更多关键词...]" >&2
  exit 1
fi

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
  curl -fsS -m 30 -X POST "${BASE_URL}/api/session/check" \
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
    423|428|503)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

current_active_session_id() {
  curl -fsS -m 10 "${BASE_URL}/api/status" \
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

activate_fallback_session() {
  local current_state="$1"
  local failed_session_id="${2:-}"
  local fallback_session_id
  local login_command

  case "${FAILOVER}" in
    0|false|FALSE|no|NO)
      return 1
      ;;
  esac

  if [[ -z "${failed_session_id}" ]]; then
    failed_session_id="$(current_active_session_id)"
  fi

  fallback_session_id="$(find_ready_fallback_session)"

  if [[ -z "${fallback_session_id}" ]]; then
    return 1
  fi

  echo "==> active session state=${current_state},切换到备用 session: ${fallback_session_id}"
  if curl -fsS -m 60 -X POST "${BASE_URL}/api/sessions/${fallback_session_id}/activate" >/dev/null; then
    echo "    已激活 session: ${fallback_session_id}"
    if [[ -n "${failed_session_id}" && "${failed_session_id}" != "${fallback_session_id}" ]]; then
      login_command="curl -s -X POST \"${BASE_URL}/api/sessions/${failed_session_id}/idle-novnc\""
      if curl -fsS -m 60 -X POST "${BASE_URL}/api/sessions/${failed_session_id}/idle-novnc" >/dev/null; then
        echo "    已把失效 session 放到 idle noVNC: ${failed_session_id}"
        echo "    登录命令: ${login_command}"
        echo "    登录入口: ${IDLE_NOVNC_URL}"
      else
        echo "    设置 idle noVNC 失败,请手动执行: ${login_command}" >&2
      fi
    fi
    return 0
  fi

  echo "    备用 session 激活失败: ${fallback_session_id}" >&2
  return 1
}

# ---------------------------------------------------------------------------
# 1) 健康检查 —— 确认服务在运行
# ---------------------------------------------------------------------------
echo "==> GET ${BASE_URL}/health"
curl -fsS -m 10 "${BASE_URL}/health"
echo

# ---------------------------------------------------------------------------
# 2) 状态检查 —— 确认浏览器已就绪且账号处于登录态
#    session.state 应为 "logged_in";若是 "challenge_required" / "logged_out",
#    需要先通过 idle noVNC(http://<host>:10087/vnc.html)人工登录/过验证码。
# ---------------------------------------------------------------------------
echo "==> GET ${BASE_URL}/api/status"
status_body="$(curl -fsS -m 10 "${BASE_URL}/api/status")"
state="$(printf '%s' "${status_body}" | read_session_state_from_status)"
active_session_id="$(printf '%s' "${status_body}" | read_active_session_id_from_status)"
echo "session.state = ${state}"

if [[ "${state}" != "logged_in" ]]; then
  echo "==> POST ${BASE_URL}/api/session/check"
  state="$(refresh_session_state)"
  echo "session.state = ${state}"
fi

if is_blocking_session_state "${state}"; then
  if activate_fallback_session "${state}" "${active_session_id}"; then
    state="$(refresh_session_state)"
    active_session_id="$(current_active_session_id)"
    echo "session.state = ${state}"
  fi
fi

if [[ "${state}" != "logged_in" ]]; then
  echo "⚠️  账号未登录(${state})。请先打开 idle noVNC 人工登录后再搜索。" >&2
  exit 2
fi
echo

# ---------------------------------------------------------------------------
# 3) 组装请求体并触发搜索
#    - 单关键词时也可以用 {"keyword":"美食"};这里统一用 keywords 数组以支持多词。
#    - recentDays / limit / scrollCount 不传则使用服务端默认值。
# ---------------------------------------------------------------------------
payload="$(python3 - "$@" <<'PY'
import json, os, sys
body = {"keywords": sys.argv[1:]}
for env_key, body_key, cast in (
    ("RECENT_DAYS",  "recentDays",      int),
    ("LIMIT",        "limitPerKeyword", int),
    ("SCROLL_COUNT", "scrollCount",     int),
):
    val = os.environ.get(env_key, "").strip()
    if val:
        body[body_key] = cast(val)
print(json.dumps(body, ensure_ascii=False))
PY
)"

echo "==> POST ${BASE_URL}/api/xiaohongshu/search"
echo "    请求体: ${payload}"
echo "    (抓取需要时间,请耐心等待…)"
echo

# ---------------------------------------------------------------------------
# 4) 发送请求并格式化输出结果
#    若搜索时才发现 active session 不可用,自动切换一次备用 session 后重试。
# ---------------------------------------------------------------------------
resp="$(curl -s -m 300 -w $'\n%{http_code}' -X POST \
  "${BASE_URL}/api/xiaohongshu/search" \
  -H "Content-Type: application/json" \
  -d "${payload}" || printf '\n000')"
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [[ "${code}" != "200" ]] && is_failover_http_status "${code}"; then
  active_session_id="$(current_active_session_id)"
  if activate_fallback_session "search_http_${code}" "${active_session_id}"; then
    active_session_id="$(current_active_session_id)"
    resp="$(curl -s -m 300 -w $'\n%{http_code}' -X POST \
      "${BASE_URL}/api/xiaohongshu/search" \
      -H "Content-Type: application/json" \
      -d "${payload}" || printf '\n000')"
    code="${resp##*$'\n'}"
    body="${resp%$'\n'*}"
  fi
fi

if [[ "${code}" != "200" ]]; then
  echo "搜索失败: HTTP ${code}" >&2
  printf '%s\n' "${body}" >&2
  exit 3
fi

printf '%s' "${body}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
task = d.get('task', {})
print(f\"任务状态: {task.get('state')}  命中条数: {task.get('resultSummary', {}).get('itemCount')}\")
for r in d.get('data', {}).get('results', []):
    print(f\"\n关键词「{r.get('keyword')}」 采集 {r.get('collectedCount')} / 范围内 {r.get('inRangeCount')}\")
    for i, it in enumerate(r.get('matchedItems', []), 1):
        title = it.get('title') or it.get('desc') or '(无标题)'
        author = (it.get('author') or {}).get('nickname', '') if isinstance(it.get('author'), dict) else it.get('author', '')
        pub = (it.get('publishedAt') or it.get('publishTime') or '')[:10]
        url = it.get('noteUrl') or it.get('url') or ''
        print(f\"  {i}. {str(title)[:40]} | 作者:{author} | {pub}\")
        if url:
            print(f\"     {url}\")
"
