#!/usr/bin/env bash
# web-session-collector 常用命令和 API 快捷函数。
#
# 先加载到当前 shell:
#   source ./cmd
#
# 常规 curl 示例:
#   curl -s "$BASE_URL/health"
#   curl -s "$BASE_URL/api/status"
#   curl -s "$BASE_URL/api/sessions"
#   curl -s "$BASE_URL/api/sites/search"
#
# 添加指定 id 的 session，并自动切到 API active + idle noVNC:
#   SESSION_ID=xhs_2
#   curl -s -X POST "$BASE_URL/api/sessions" \
#     -H "content-type: application/json" \
#     -d "{\"id\":\"$SESSION_ID\",\"activate\":true,\"idleNovnc\":true}"
#
# 切 API active session，active noVNC 会跟着显示这个 session:
#   curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/activate"
#
# 切 idle/login noVNC 到指定 session，然后打开 IDLE_NOVNC:
#   curl -s -X POST "$BASE_URL/api/sessions/$SESSION_ID/idle-novnc"
#   xdg-open "$IDLE_NOVNC"
#
# 检查/手动设置 session 状态:
#   curl -s -X POST "$BASE_URL/api/session/check?sessionId=$SESSION_ID"
#   curl -s -X PATCH "$BASE_URL/api/sessions/$SESSION_ID/state" \
#     -H "content-type: application/json" \
#     -d '{"state":"logged_in","updatedBy":"cmd"}'
#
# 搜索:
#   curl -s -X POST "$BASE_URL/api/xiaohongshu/search" \
#     -H "content-type: application/json" \
#     -d '{"keyword":"咖啡 成都","scrollCount":8,"fetchContent":true}'
#
# 快捷函数示例:
#   api health
#   api sessions
#   api session add xhs_2
#   api session activate xhs_2
#   api session novnc xhs_2
#   api novnc active
#   api novnc idle
#   api login xiaohongshu
#   api login xiaohongshu xhs_2
#   api search "咖啡 成都" xhs_2
#
# 旧 CLI:
#   pnpm run collect:xiaohongshu -- 咖啡 成都

export API_HOST="${API_HOST:-100.90.168.1}"
export BASE_URL="${BASE_URL:-http://${API_HOST}:10085}"
export ACTIVE_NOVNC="${ACTIVE_NOVNC:-http://${API_HOST}:10086/vnc.html}"
export IDLE_NOVNC="${IDLE_NOVNC:-http://${API_HOST}:10087/vnc.html}"

_api_help() {
  cat <<'EOF'
web-session-collector shortcuts

Usage:
  api health
  api status
  api sessions
  api sites
  api check [session_id]
  api session add <session_id>       # create and switch API active + idle noVNC
  api session activate <session_id>  # switch API active; active noVNC follows
  api session novnc <session_id>     # switch idle/login noVNC and open it
  api session state <session_id> <unknown|logged_in|logged_out|challenge_required|browser_closed|error>
  api session delete <session_id>
  api novnc active
  api novnc idle
  api login xiaohongshu [session_id] # open idle noVNC for manual login
  api search <keyword> [session_id]

Environment:
  API_HOST      default: 100.90.168.1
  BASE_URL      default: http://$API_HOST:10085
  ACTIVE_NOVNC  default: http://$API_HOST:10086/vnc.html
  IDLE_NOVNC    default: http://$API_HOST:10087/vnc.html
EOF
}

_api_curl() {
  curl -fsS "$@"
  printf '\n'
}

_api_open_url() {
  local url="$1"

  printf 'open: %s\n' "$url"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  else
    printf 'No browser opener found. Open this URL manually: %s\n' "$url" >&2
  fi
}

_api_require_session_id() {
  local session_id="${1:-}"

  if [[ ! "$session_id" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
    printf 'session id must be 1-64 chars: letters, numbers, _ or -\n' >&2
    return 2
  fi
}

_api_require_state() {
  case "${1:-}" in
    unknown|logged_in|logged_out|challenge_required|browser_closed|error)
      return 0
      ;;
    *)
      printf 'state must be one of: unknown logged_in logged_out challenge_required browser_closed error\n' >&2
      return 2
      ;;
  esac
}

_api_session_exists() {
  local session_id="$1"

  curl -fsS "$BASE_URL/api/sessions" | grep -q "\"id\": \"${session_id}\""
}

_api_session_add() {
  local session_id="$1"

  _api_require_session_id "$session_id" || return
  _api_curl -X POST "$BASE_URL/api/sessions" \
    -H "content-type: application/json" \
    -d "{\"id\":\"$session_id\",\"activate\":true,\"idleNovnc\":true}"
}

_api_session_idle_novnc() {
  local session_id="$1"

  _api_require_session_id "$session_id" || return
  _api_curl -X POST "$BASE_URL/api/sessions/$session_id/idle-novnc"
}

_api_prepare_xiaohongshu_login() {
  local session_id="${1:-default}"

  _api_require_session_id "$session_id" || return
  if _api_session_exists "$session_id"; then
    _api_session_idle_novnc "$session_id" >/dev/null || return
  else
    _api_curl -X POST "$BASE_URL/api/sessions" \
      -H "content-type: application/json" \
      -d "{\"id\":\"$session_id\",\"activate\":false,\"idleNovnc\":true}" >/dev/null || return
  fi

  curl -fsS -X POST "$BASE_URL/api/session/check?sessionId=$session_id" >/dev/null 2>&1 || true
  _api_open_url "$IDLE_NOVNC"
  printf 'login session: %s\n' "$session_id"
  printf 'after login: api check %s\n' "$session_id"
}

_api_search_payload() {
  local keyword="$1"
  local session_id="${2:-}"

  python3 - "$keyword" "$session_id" <<'PY'
import json
import sys

body = {
    "keyword": sys.argv[1],
    "scrollCount": 8,
    "fetchContent": True,
}
if len(sys.argv) > 2 and sys.argv[2]:
    body["sessionId"] = sys.argv[2]
print(json.dumps(body, ensure_ascii=False))
PY
}

api() {
  local command="${1:-help}"

  case "$command" in
    help|-h|--help)
      _api_help
      ;;
    health)
      _api_curl "$BASE_URL/health"
      ;;
    status)
      _api_curl "$BASE_URL/api/status"
      ;;
    sessions)
      _api_curl "$BASE_URL/api/sessions"
      ;;
    sites)
      _api_curl "$BASE_URL/api/sites/search"
      ;;
    check)
      local session_id="${2:-}"
      if [[ -n "$session_id" ]]; then
        _api_require_session_id "$session_id" || return
        _api_curl -X POST "$BASE_URL/api/session/check?sessionId=$session_id"
      else
        _api_curl -X POST "$BASE_URL/api/session/check"
      fi
      ;;
    login)
      local site="${2:-xiaohongshu}"
      local session_id="${3:-default}"

      if [[ "$site" != "xiaohongshu" ]]; then
        printf 'only xiaohongshu login is supported now\n' >&2
        return 2
      fi
      _api_prepare_xiaohongshu_login "$session_id"
      ;;
    novnc)
      local target="${2:-idle}"
      case "$target" in
        active)
          _api_open_url "$ACTIVE_NOVNC"
          ;;
        idle|login)
          _api_open_url "$IDLE_NOVNC"
          ;;
        *)
          _api_session_idle_novnc "$target" || return
          _api_open_url "$IDLE_NOVNC"
          ;;
      esac
      ;;
    session)
      local action="${2:-help}"
      local session_id="${3:-}"

      case "$action" in
        add|create)
          _api_session_add "$session_id"
          ;;
        activate|use)
          _api_require_session_id "$session_id" || return
          _api_curl -X POST "$BASE_URL/api/sessions/$session_id/activate"
          ;;
        novnc|idle)
          _api_session_idle_novnc "$session_id" || return
          _api_open_url "$IDLE_NOVNC"
          ;;
        check)
          _api_require_session_id "$session_id" || return
          _api_curl -X POST "$BASE_URL/api/session/check?sessionId=$session_id"
          ;;
        state)
          local state="${4:-}"
          _api_require_session_id "$session_id" || return
          _api_require_state "$state" || return
          _api_curl -X PATCH "$BASE_URL/api/sessions/$session_id/state" \
            -H "content-type: application/json" \
            -d "{\"state\":\"$state\",\"updatedBy\":\"cmd\"}"
          ;;
        delete|rm)
          _api_require_session_id "$session_id" || return
          _api_curl -X DELETE "$BASE_URL/api/sessions/$session_id"
          ;;
        *)
          _api_help
          return 2
          ;;
      esac
      ;;
    search)
      local keyword="${2:-}"
      local session_id="${3:-}"

      if [[ -z "$keyword" ]]; then
        printf 'usage: api search <keyword> [session_id]\n' >&2
        return 2
      fi
      if [[ -n "$session_id" ]]; then
        _api_require_session_id "$session_id" || return
      fi
      _api_curl -m 300 -X POST "$BASE_URL/api/xiaohongshu/search" \
        -H "content-type: application/json" \
        -d "$(_api_search_payload "$keyword" "$session_id")"
      ;;
    *)
      printf 'unknown api command: %s\n' "$command" >&2
      _api_help
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  api "$@"
fi
