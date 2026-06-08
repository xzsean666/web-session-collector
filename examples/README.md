# API 调用案例

`web-session-collector`(小红书)对外暴露一个 HTTP API。下面是各端点的调用示例。
完整 API 文档见:[`docs/API_USAGE.md`](../docs/API_USAGE.md)

- **基础地址**:`http://100.90.168.1:10085`(Tailscale 内网)
- **active noVNC(API session 观察)**:`http://100.90.168.1:10086/vnc.html`
- **idle noVNC(人工登录/过验证码)**:`http://100.90.168.1:10087/vnc.html`

一键示例脚本:[`call-search-api.sh`](./call-search-api.sh)

```bash
./examples/call-search-api.sh "美食"
./examples/call-search-api.sh "美食" "旅行" "穿搭"
RECENT_DAYS=180 LIMIT=50 SCROLL_COUNT=8 ./examples/call-search-api.sh "美食"
```

---

## 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health` | 健康检查 |
| GET  | `/api/status` | 浏览器/会话/账号当前状态 |
| GET  | `/api/sites/search` | 支持搜索的站点列表 |
| POST | `/api/session/check` | 主动触发一次登录态检查 |
| POST | `/api/xiaohongshu/search` | 触发小红书搜索采集 |

---

## 1. 健康检查

```bash
curl http://100.90.168.1:10085/health
# => {"ok":true,"lifecycle":"running"}
```

## 2. 状态 / 登录态

```bash
curl http://100.90.168.1:10085/api/status
```

关注 `status.session.state`:
- `logged_in` —— 已登录,可以搜索
- `challenge_required` —— 有验证码,需打开 idle noVNC 人工处理
- `logged_out` —— 未登录,需打开 idle noVNC 登录

## 3. 主动检查登录态

```bash
curl -X POST http://100.90.168.1:10085/api/session/check
```

## 4. 触发搜索

请求体字段(全部可选,留空用服务端默认值):

| 字段 | 类型 | 说明 |
|------|------|------|
| `keyword` / `q` | string | 单个关键词 |
| `keywords` | string[] | 多个关键词(最多 20) |
| `recentDays` | int | 只保留最近 N 天;`0` = 不过滤(0–3650) |
| `limitPerKeyword` / `limit` | int | 每个关键词最多返回条数(1–100) |
| `scrollCount` | int | 结果页滚动加载次数,越大抓越多越慢(0–20) |

> 当前服务端默认值:`recentDays=90`、`limitPerKeyword=30`、`scrollCount=5`。

**单关键词:**

```bash
curl -X POST http://100.90.168.1:10085/api/xiaohongshu/search \
  -H "Content-Type: application/json" \
  -d '{"keyword":"美食"}'
```

**多关键词 + 自定义参数:**

```bash
curl -X POST http://100.90.168.1:10085/api/xiaohongshu/search \
  -H "Content-Type: application/json" \
  -d '{
        "keywords": ["美食", "旅行"],
        "recentDays": 180,
        "limitPerKeyword": 50,
        "scrollCount": 8
      }'
```

**响应结构(节选):**

```jsonc
{
  "ok": true,
  "task": {
    "state": "completed",
    "resultSummary": { "keywordCount": 1, "itemCount": 5 }
  },
  "data": {
    "results": [
      {
        "keyword": "美食",
        "collectedCount": 18,   // 实际从页面采集到的条数
        "inRangeCount": 5,      // recentDays 过滤后保留的条数
        "matchedItems": [
          { "title": "...", "author": { "nickname": "..." },
            "publishedAt": "2026-05-22", "noteUrl": "https://www.xiaohongshu.com/explore/..." }
        ]
      }
    ]
  }
}
```

> 注意:搜索是同步阻塞调用,会等抓取完成才返回(几十秒级)。同一时间只能跑一个任务,
> 并发调用会得到 `409 { "error": { "code": "task_busy" } }`。

## 5. Node.js 调用示例

```js
const res = await fetch("http://100.90.168.1:10085/api/xiaohongshu/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ keywords: ["美食"], recentDays: 90, limitPerKeyword: 30 }),
});
const data = await res.json();
for (const r of data.data.results) {
  console.log(r.keyword, r.inRangeCount, "条");
  for (const it of r.matchedItems) console.log(" -", it.title, it.noteUrl);
}
```
