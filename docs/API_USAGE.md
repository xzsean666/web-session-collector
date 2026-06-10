# API Usage

`web-session-collector` exposes a local HTTP API for managing browser-backed
web sessions and running Xiaohongshu search collection tasks.

Default deployed addresses:

```text
API base URL:        http://100.90.168.1:10085
Active noVNC:        http://100.90.168.1:10086/vnc.html
Idle/login noVNC:    http://100.90.168.1:10087/vnc.html
```

For local Docker:

```text
API base URL:        http://127.0.0.1:10085
Active noVNC:        http://127.0.0.1:10086/vnc.html
Idle/login noVNC:    http://127.0.0.1:10087/vnc.html
```

## Concepts

- `sessionId`: stable id for one managed browser session.
- `apiActiveSessionId`: default session used by API tasks when no `sessionId`
  is provided.
- `idleNovncSessionId`: session selected for manual login and verification.
- Active noVNC observes the API-active session.
- Idle noVNC shows `idleNovncSessionId` for manual login, captcha, and account
  checks.
- If `idleNovncSessionId` is also the API-active session, idle noVNC mirrors
  active noVNC instead of moving or reopening the browser.
- If `idleNovncSessionId` is not the API-active session, the target session runs
  on the idle desktop.

Session states:

```text
unknown
logged_in
logged_out
challenge_required
browser_closed
error
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process health and active session ids |
| `GET` | `/api/status` | Full service, session, page, task, and noVNC status |
| `GET` | `/api/sessions` | List all managed web sessions |
| `POST` | `/api/sessions` | Create a web session |
| `DELETE` | `/api/sessions/:sessionId` | Delete a web session |
| `POST` | `/api/sessions/:sessionId/activate` | Set the API-active session |
| `POST` | `/api/sessions/:sessionId/idle-novnc` | Show the session on idle noVNC |
| `POST` | `/api/sessions/:sessionId/restart` | Restart one session browser with the same profile and desktop role |
| `PATCH` | `/api/sessions/:sessionId/state` | Manually set session state |
| `GET` | `/api/sites/search` | List supported search sites |
| `POST` | `/api/session/check` | Inspect login/session state |
| `POST` | `/api/xiaohongshu/search` | Run Xiaohongshu search collection |

## Health

```bash
curl -s http://100.90.168.1:10085/health
```

Example:

```json
{
  "ok": true,
  "lifecycle": "running",
  "apiActiveSessionId": "default",
  "idleNovncSessionId": "default"
}
```

## Status

```bash
curl -s http://100.90.168.1:10085/api/status
```

Useful fields:

- `status.apiActiveSessionId`
- `status.idleNovncSessionId`
- `status.activeTask`
- `status.page.url`
- `status.session.state`
- `status.sessions[]`
- `noVnc.active.port`
- `noVnc.idle.port`

When `status.session.state` is `logged_out` or `challenge_required`, open idle
noVNC and finish login or verification:

```text
http://100.90.168.1:10087/vnc.html
```

Then refresh state:

```bash
curl -s -X POST http://100.90.168.1:10085/api/session/check
```

## List Sessions

```bash
curl -s http://100.90.168.1:10085/api/sessions
```

Example fields for each session:

```json
{
  "id": "default",
  "state": "logged_in",
  "isApiActive": true,
  "isIdleNovncTarget": true,
	  "browser": {
	    "desktopRole": "active",
	    "display": ":99",
	    "userDataDir": "/data/chrome-user-data",
	    "ready": true
  },
  "page": {
    "closed": false,
    "url": "https://www.xiaohongshu.com/explore"
  }
}
```

## Create Session

```bash
curl -s -X POST http://100.90.168.1:10085/api/sessions \
  -H "content-type: application/json" \
  -d '{
        "id": "account_2",
        "activate": false,
        "idleNovnc": true
      }'
```

Request fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | No | Session id. If omitted, the server generates one. |
| `activate` | boolean | No | Make this session the API-active session after creation. Active sessions open on the active desktop. |
| `idleNovnc` | boolean | No | Make this session the idle noVNC login target after creation. Idle sessions open on the idle desktop. |

Session ids may contain letters, numbers, `_`, and `-`, up to 64 characters.
Additional sessions use profile data under:

```text
APP_USER_DATA_DIR/sessions/<sessionId>
```

## Activate API Session

Set which session API tasks use by default:

```bash
curl -s -X POST http://100.90.168.1:10085/api/sessions/default/activate
```

This sets `apiActiveSessionId` and moves the session to the active noVNC
desktop if needed. If the session was the idle noVNC target, `idleNovncSessionId`
is cleared.

## Select Idle noVNC Login Target

Set which session is shown for manual login:

```bash
curl -s -X POST http://100.90.168.1:10085/api/sessions/account_2/idle-novnc
```

Then open:

```text
http://100.90.168.1:10087/vnc.html
```

This sets `idleNovncSessionId` and moves the session to the idle noVNC desktop
if needed. The API-active session cannot also be selected as the idle noVNC
target; activate another session first.

## Update Session State

```bash
curl -s -X PATCH http://100.90.168.1:10085/api/sessions/account_2/state \
  -H "content-type: application/json" \
  -d '{
        "state": "logged_in",
        "updatedBy": "operator"
      }'
```

Allowed `state` values:

```text
unknown
logged_in
logged_out
challenge_required
browser_closed
error
```

This is an operator override. Normal session checks can later update inspected
state again.

## Delete Session

```bash
curl -s -X DELETE http://100.90.168.1:10085/api/sessions/account_2
```

Deleting a session closes its browser resources. It does not erase profile data
from disk.

## Check Session State

Check the API-active session:

```bash
curl -s -X POST http://100.90.168.1:10085/api/session/check
```

Check a specific session:

```bash
curl -s -X POST \
  'http://100.90.168.1:10085/api/session/check?sessionId=account_2'
```

## Search Sites

```bash
curl -s http://100.90.168.1:10085/api/sites/search
```

Example:

```json
{
  "ok": true,
  "sites": ["xiaohongshu"]
}
```

## Xiaohongshu Search

Search with the API-active session:

```bash
curl -s -X POST http://100.90.168.1:10085/api/xiaohongshu/search \
  -H "content-type: application/json" \
  -d '{
        "keyword": "Bitcoin crypto",
        "recentDays": 30,
        "limit": 30,
        "scrollCount": 8,
        "fetchContent": true
      }'
```

Search with a specific session without changing `apiActiveSessionId`:

```bash
curl -s -X POST http://100.90.168.1:10085/api/xiaohongshu/search \
  -H "content-type: application/json" \
  -d '{
        "sessionId": "account_2",
        "keywords": ["美食", "旅行"],
        "recentDays": 180,
        "limitPerKeyword": 50,
        "scrollCount": 8,
        "fetchContent": false
      }'
```

Request fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | string | No | Target session. Defaults to `apiActiveSessionId`. |
| `keyword` | string | No | Single keyword. |
| `q` | string | No | Alias for `keyword`. |
| `keywords` | string[] | No | Multiple keywords, max 20. |
| `recentDays` | integer | No | Keep notes from the last N days. `0` disables date filtering. |
| `limit` | integer | No | Alias for `limitPerKeyword`. |
| `limitPerKeyword` | integer | No | Max returned notes per keyword, 1-100. |
| `scrollCount` | integer | No | Search result scroll count, 0-20. |
| `fetchContent` | boolean | No | Open detail pages to fetch content, tags, images. |
| `excludeItemIds` | string[] | No | Known note ids to skip before detail fetch. |

At least one of `keyword`, `q`, or `keywords` is required.

Response shape:

```json
{
  "ok": true,
  "task": {
    "id": "2b5f38a4-c46d-40cc-ba51-0d537251eac5",
    "type": "search",
    "state": "completed",
    "resultSummary": {
      "keywordCount": 1,
      "itemCount": 3
    }
  },
  "session": {
    "state": "logged_in"
  },
  "webSession": {
    "id": "default",
    "isApiActive": true
  },
  "data": {
    "siteKey": "xiaohongshu",
    "results": [
      {
        "keyword": "Bitcoin crypto",
        "collectedCount": 15,
        "normalizedCount": 15,
        "inRangeCount": 3,
        "excludedKnownCount": 0,
        "matchedItems": []
      }
    ]
  }
}
```

Search calls are synchronous and can take tens of seconds. A second task for the
same session returns `409 task_busy`.

## Common Errors

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | JSON body is valid JSON but fields are invalid. |
| `400` | `missing_keywords` | Search request did not include `keyword`, `q`, or `keywords`. |
| `404` | `session_not_found` | Requested session id does not exist. |
| `409` | `task_busy` | Target session already has a task or monitor running. |
| `423` | `verification_required` | Account needs manual verification. |
| `428` | `login_required` | Account is logged out. |
| `500` | `search_failed` | Search task failed after being accepted. |
| `503` | `service_not_ready` | API/browser service is not ready. |

## Typical Operator Flow

1. Check health:

```bash
curl -s http://100.90.168.1:10085/health
```

2. List sessions:

```bash
curl -s http://100.90.168.1:10085/api/sessions
```

3. If a session is logged out, select it for idle noVNC:

```bash
curl -s -X POST http://100.90.168.1:10085/api/sessions/default/idle-novnc
```

4. Open idle noVNC and log in:

```text
http://100.90.168.1:10087/vnc.html
```

5. Refresh session state:

```bash
curl -s -X POST http://100.90.168.1:10085/api/session/check
```

6. Activate the session for API tasks:

```bash
curl -s -X POST http://100.90.168.1:10085/api/sessions/default/activate
```

7. Start search:

```bash
curl -s -X POST http://100.90.168.1:10085/api/xiaohongshu/search \
  -H "content-type: application/json" \
  -d '{"keyword":"Bitcoin crypto","scrollCount":8,"fetchContent":true}'
```
