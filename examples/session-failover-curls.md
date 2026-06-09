# Session Failover Curl Commands

这些命令用于外部控制 session 切换:

- 当前 active session 正常时,搜索请求不传 `sessionId`。
- 备用 session 先创建出来,通过 idle noVNC 人工登录。
- 当前 active session 失效后,外部脚本再把某个备用 session 切成 active。
- active noVNC 和 idle noVNC 是两个独立桌面;切换 session 角色时,
  服务会用同一个 profile 在目标桌面重开浏览器。

默认 API 地址:

```bash
BASE_URL="http://100.90.168.1:10085"
```

本地 Docker 可改成:

```bash
BASE_URL="http://127.0.0.1:10085"
```

## 1. 查看服务状态

```bash
curl -s "${BASE_URL}/health"
```

```bash
curl -s "${BASE_URL}/api/status"
```

## 2. 查看所有 session

```bash
curl -s "${BASE_URL}/api/sessions"
```

## 3. 创建备用 session

这里创建一个备用 session `account_2`,不影响当前 active session。

```bash
curl -s -X POST "${BASE_URL}/api/sessions" \
  -H "content-type: application/json" \
  -d '{
        "id": "account_2",
        "activate": false,
        "idleNovnc": true
      }'
```

`idleNovnc: true` 会把这个备用 session 放到 idle noVNC,方便你人工登录:

```text
http://100.90.168.1:10087/vnc.html
```

本地 Docker:

```text
http://127.0.0.1:10087/vnc.html
```

## 4. 检查指定备用 session

登录备用 session 后,检查它是不是 `logged_in`:

```bash
curl -s -X POST "${BASE_URL}/api/session/check?sessionId=account_2"
```

## 5. 平时用当前 active session 搜索

不传 `sessionId`,服务就用当前 `apiActiveSessionId`。

```bash
curl -s -X POST "${BASE_URL}/api/xiaohongshu/search" \
  -H "content-type: application/json" \
  -d '{
        "keyword": "美食",
        "recentDays": 30,
        "limit": 30,
        "scrollCount": 8,
        "fetchContent": false
      }'
```

## 6. 当前 active session 失效时,切换到备用 session

当当前 active session 变成 `logged_out`、`challenge_required`、`browser_closed`
或 `error` 时,外部脚本可以执行:

```bash
curl -s -X POST "${BASE_URL}/api/sessions/account_2/activate"
```

这会把 `account_2` 从 idle 桌面移到 active 桌面。它使用同一个
`APP_USER_DATA_DIR/sessions/account_2` profile,所以登录态会保留。
如果 `account_2` 原本是 `idleNovncSessionId`,切换后 idle target 会被清空。

切换后再次确认状态:

```bash
curl -s "${BASE_URL}/api/status"
```

然后重试搜索:

```bash
curl -s -X POST "${BASE_URL}/api/xiaohongshu/search" \
  -H "content-type: application/json" \
  -d '{
        "keyword": "美食",
        "recentDays": 30,
        "limit": 30,
        "scrollCount": 8,
        "fetchContent": false
      }'
```

## 7. 如果想用指定 session 搜索,但不切 active

这种方式只针对本次请求使用 `account_2`,不会改变 `apiActiveSessionId`。

```bash
curl -s -X POST "${BASE_URL}/api/xiaohongshu/search" \
  -H "content-type: application/json" \
  -d '{
        "sessionId": "account_2",
        "keyword": "美食",
        "recentDays": 30,
        "limit": 30,
        "scrollCount": 8,
        "fetchContent": false
      }'
```

## 8. 外部 failover 判断逻辑

`examples/call-search-api.sh` 和 `examples/collect-loop.sh` 默认已经按这个逻辑
执行。可用 `FAILOVER=0` 关闭自动切换。

如果有多个 session 失效,10087 一次只能显示一个 idle/login session。处理方式是:

```text
1. 执行某一个失效 session 的 idle-novnc 命令
2. 打开 10087 登录这个 session
3. 检查这个 session 是否 logged_in
4. 再执行下一个失效 session 的 idle-novnc 命令
```

命令格式:

```bash
curl -s -X POST "${BASE_URL}/api/sessions/<sessionId>/idle-novnc"
```

登录后检查:

```bash
curl -s -X POST "${BASE_URL}/api/session/check?sessionId=<sessionId>"
```

```text
1. POST /api/session/check 检查当前 active session
2. state=logged_in 时继续采集
3. state=logged_out/challenge_required/browser_closed/error 时暂停当前 active
4. GET /api/sessions 找一个 state=logged_in 的备用 session
5. POST /api/sessions/<备用id>/activate
6. 如需重新登录旧 active session,POST /api/sessions/<旧active>/idle-novnc
7. 重试采集
```
