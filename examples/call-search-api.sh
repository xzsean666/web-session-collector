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
#   RECENT_DAYS      只保留最近 N 天的笔记(0 = 不过滤)
#   LIMIT            每个关键词最多返回多少条
#   SCROLL_COUNT     搜索结果页向下滚动加载的次数(越大抓得越多、越慢)
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://100.90.168.1:10085}"

if [[ $# -lt 1 ]]; then
  echo "用法: $0 <关键词> [更多关键词...]" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1) 健康检查 —— 确认服务在运行
# ---------------------------------------------------------------------------
echo "==> GET ${BASE_URL}/health"
curl -fsS -m 10 "${BASE_URL}/health"
echo

# ---------------------------------------------------------------------------
# 2) 状态检查 —— 确认浏览器已就绪且账号处于登录态
#    session.state 应为 "logged_in";若是 "challenge_required" / "logged_out",
#    需要先通过 noVNC(http://<host>:10086/vnc.html)人工登录/过验证码。
# ---------------------------------------------------------------------------
echo "==> GET ${BASE_URL}/api/status"
state="$(curl -fsS -m 10 "${BASE_URL}/api/status" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',{}).get('session',{}).get('state','unknown'))")"
echo "session.state = ${state}"
if [[ "${state}" != "logged_in" ]]; then
  echo "⚠️  账号未登录(${state})。请先打开 noVNC 人工登录后再搜索。" >&2
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
# ---------------------------------------------------------------------------
curl -fsS -m 300 -X POST "${BASE_URL}/api/xiaohongshu/search" \
  -H "Content-Type: application/json" \
  -d "${payload}" \
  | python3 -c "
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
