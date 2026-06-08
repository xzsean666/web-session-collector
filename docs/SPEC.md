# Web Session Collector System Specification

## Current Step

Step 5: Background browser API service.

This document defines the system specification for the current project phase.

## Purpose

Web Session Collector is a Node.js and Playwright framework for browser-based
automation and data collection tasks. The reusable browser runtime lives in
`src/core/`; site-specific behavior lives behind adapters under
`src/sites/<site>/`.

The current phase focuses on framework initialization, profile verification,
current account detection, a keyword search MVP, and a local HTTP API that keeps
one visible browser alive across requests.

## Current Phase Scope

The current phase must support:

- reading runtime configuration from environment variables
- validating required configuration before browser startup
- loading a user-provided Chrome user data directory
- launching a Playwright persistent browser context
- verifying that the context and page are usable
- opening the configured start URL after profile verification
- printing the configured profile and current account information
- running keyword search through a selected site adapter
- keeping the browser alive for manual inspection when requested
- running a background API service backed by one long-lived visible browser
- returning `409 task_busy` when a search is already active
- reporting logged-out and verification-required session states
- running in Docker with noVNC for manual login and persistent Chrome user data
- shutting down cleanly when the process exits

The current phase must not include:

- account login
- captcha solving, verification bypass, fingerprint spoofing, or stealth patches
- storage adapters
- proxy support
- queue or scheduler
- distributed execution
- UI beyond noVNC access to the visible browser
- plugin system

## Technology Choices

| Area | Choice | Current Status |
| --- | --- | --- |
| Runtime | Node.js | Required |
| Language | TypeScript | Required |
| Browser automation | Playwright | Required |
| Package manager | pnpm | Required |
| Configuration | Environment variables | Required |
| Schema validation | Zod | Implemented |
| Structured logging | Pino | Implemented |
| HTTP API | Node built-in `http` | Implemented |
| Docker desktop access | Xvfb, x11vnc, noVNC | Implemented |
| Queue layer | TBD | Future phase |
| Storage layer | TBD | Future phase |
| Monitoring | TBD beyond logs | Future phase |

## Non-Functional Requirements

Priority order:

```text
Maintainability
>
Extensibility
>
Performance
```

Requirements:

- modules must be understandable in isolation
- configuration must be explicit and centralized
- runtime lifecycle must be consistent
- browser profile handling must fail fast on invalid input
- logs must be structured
- sensitive browser state must not be logged
- future modules must be added without rewriting core lifecycle code

## Configuration Specification

Minimum configuration:

| Name | Required | Description |
| --- | --- | --- |
| `APP_SITE` | No | Runtime site adapter key, defaults to `xiaohongshu` in this project |
| `APP_USER_DATA_DIR` | Yes | Chrome user data directory used by Playwright persistent context |
| `APP_PROFILE_NAME` | Yes | Human-readable profile name printed in logs |
| `APP_BROWSER_MODE` | No | `launch` starts Chrome, `connect` attaches to an existing Chrome over CDP |
| `APP_CDP_URL` | No | CDP endpoint used in `connect` mode |
| `APP_HEADLESS` | No | Browser headless mode, defaults to `false` |
| `APP_BROWSER_CHANNEL` | No | Browser channel, defaults to `chrome`; use `bundled` for Playwright Chromium |
| `APP_EXECUTABLE_PATH` | No | Explicit Chrome executable path |
| `APP_PROFILE_DIRECTORY` | No | Chrome profile directory name, passed as `--profile-directory` |
| `APP_LOCALE` | No | Browser locale, defaults to `zh-CN` |
| `APP_TIMEZONE_ID` | No | Browser timezone, defaults to `Asia/Shanghai` |
| `APP_VIEWPORT_WIDTH` | No | Browser viewport width, defaults to `1366` |
| `APP_VIEWPORT_HEIGHT` | No | Browser viewport height, defaults to `768` |
| `APP_DEVICE_SCALE_FACTOR` | No | Browser device scale factor, defaults to `1` |
| `APP_BROWSER_FLAGS` | No | JSON string array or comma-separated browser launch flags |
| `APP_IGNORE_DEFAULT_ARGS` | No | Playwright default launch arguments to remove |
| `APP_START_URL` | No | Page opened after profile verification, defaults to selected site adapter start URL |
| `APP_LOG_LEVEL` | No | Structured log level, defaults to `info` |
| `APP_KEEP_BROWSER_ALIVE` | No | Whether to keep browser open for manual inspection, defaults to `false` |
| `APP_INTERACTIVE_LOGIN_ON_MISSING_USER` | No | Legacy one-shot runtime fallback after a headless missing-user result; defaults to `false` and is not used by API mode |

API service configuration:

| Name | Required | Description |
| --- | --- | --- |
| `APP_API_HOST` | No | API listen host, defaults to `0.0.0.0` |
| `APP_API_PORT` | No | API listen port, defaults to `10085` |
| `APP_API_REQUEST_BODY_LIMIT_BYTES` | No | Maximum JSON body size, defaults to `1048576` |
| `APP_ACCOUNT_CHECK_INTERVAL_MS` | No | Idle session monitor interval, defaults to `60000`; `0` disables scheduled checks |
| `ACTIVE_NOVNC_PORT` | No | noVNC port for observing the API-active session, defaults to `10086` |
| `IDLE_NOVNC_PORT` | No | noVNC port for manual login on idle/login-target sessions, defaults to `10087` |

Collect CLI search-task configuration:

| Name | Required | Description |
| --- | --- | --- |
| `APP_TASK` | No | Collection task name, defaults to `search`; currently only `search` is implemented |
| `APP_SEARCH_RECENT_DAYS` | No | Search-task recent-day filter, defaults to `30`; `0` disables date filtering |
| `APP_SEARCH_LIMIT` | No | Search-task maximum printed results per keyword, defaults to `10` |
| `APP_SEARCH_SCROLLS` | No | Search-task page scroll count per keyword, defaults to `2` |
| `APP_SEARCH_LOG_LEVEL` | No | Search-task structured log level, defaults to `warn` |
| `APP_SEARCH_SITE` | No | Search-task site adapter key, defaults to `APP_SITE`, then `xiaohongshu` |

Future configuration:

| Name | Phase | Description |
| --- | --- | --- |
| `APP_TIMEOUT_MS` | Phase 2 | Default action timeout |
| `APP_RETRY_COUNT` | Phase 2 | Retry count for recoverable failures |
| `APP_PROXY_SERVER` | Future | Proxy server |
| `APP_CONCURRENCY` | Future | Parallel task limit |
| `APP_STORAGE_TARGET` | Future | Storage adapter target |

Configuration rules:

- all environment values are strings before validation
- parsing and defaulting happen only in the configuration module
- invalid required configuration is non-recoverable
- modules receive a validated configuration object instead of reading
  environment variables directly
- `APP_BROWSER_MODE=connect` attaches to an existing Chrome and must not close
  the user's browser
- `APP_CDP_URL` must use `http`, `https`, `ws`, or `wss`
- `APP_BROWSER_FLAGS` should use JSON when a flag value contains commas
- `APP_EXECUTABLE_PATH` must be an absolute file path when provided
- `APP_PROFILE_DIRECTORY` should be used instead of embedding
  `--profile-directory` inside `APP_BROWSER_FLAGS`
- browser locale, timezone, viewport, and device scale factor must be applied
  through browser context options so manual login, API runs, and Docker noVNC
  share one consistent desktop environment
- `APP_IGNORE_DEFAULT_ARGS` should be used sparingly because removing required
  Playwright defaults can break automation
- `APP_START_URL` must use `http` or `https`
- `APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true` is only for the one-shot runtime
  in `launch` mode; API mode uses the already visible browser instead
- collect CLI search-task configuration is loaded by `src/scripts/collect.ts`
  and must not change the MVP runtime behavior
- API service configuration is loaded by `src/api/api-config.ts`
- background API mode must keep the browser open until service shutdown
- API search execution must be single-flight per background browser service
- reusable core configuration uses generic `APP_*` names; this project applies
  site defaults before passing configuration into the core parser
- site-specific URLs, selectors, notices, and date parsing must live under
  `src/sites/<site>/`, not under `src/core/`

## Module Contracts

### Configuration

Input:

- process environment

Output:

- validated runtime configuration object

Failure mode:

- invalid or missing required configuration fails before browser startup

### Runtime

Input:

- validated runtime configuration
- selected action

Output:

- lifecycle result and structured logs

Failure mode:

- logs top-level failure, closes resources, exits with non-zero status

### API Service

Input:

- validated runtime configuration
- validated API configuration
- HTTP requests

Output:

- JSON responses
- active task and session status

Failure mode:

- invalid request bodies return `400`
- oversized request bodies return `413`
- a second active search returns `409 task_busy`
- logged-out sessions return `428 login_required`
- verification or risk-control states return `423 verification_required`
- service startup failures are logged and exit non-zero

Endpoints:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health` | Returns service lifecycle and active task summary |
| `GET` | `/api/status` | Returns browser, page, active task, last task, monitor, and session status |
| `GET` | `/api/sites/search` | Lists registered search adapters |
| `POST` | `/api/session/check` | Runs an immediate session inspection when the page is idle |
| `POST` | `/api/xiaohongshu/search` | Runs a Xiaohongshu keyword search on the existing browser page |

`POST /api/xiaohongshu/search` request body:

```json
{
  "keyword": "咖啡",
  "keywords": ["咖啡", "成都"],
  "recentDays": 30,
  "limit": 10,
  "scrollCount": 2
}
```

Rules:

- `keyword`, `q`, or `keywords` must provide at least one keyword
- `limit` and `limitPerKeyword` are equivalent; `limitPerKeyword` wins when
  both are provided
- one request runs synchronously and returns the search result when complete
- another search request during an active search returns the current running
  task snapshot instead of starting work
- the API does not store results
- the API does not expose cookies, tokens, local storage, or raw browser state

### Browser

Input:

- profile path
- browser mode
- CDP URL
- headless setting
- browser channel
- executable path
- profile directory
- browser flags
- ignored Playwright default args

Output:

- Playwright persistent browser context

Failure mode:

- profile load or browser startup failure is non-recoverable

Rules:

- default browser mode is visible (`APP_HEADLESS=false`)
- browser contexts in API mode remain open until service shutdown
- Docker mode uses the same persistent user data directory across restarts

### Context

Input:

- persistent browser context

Output:

- page session and context metadata

Failure mode:

- page creation failure is non-recoverable for the current phase

### Profile Verification Action

Input:

- page session
- profile metadata

Output:

- raw verification result

Expected behavior:

- confirms a page can be created or reused
- optionally navigates to a known page only if configured
- prints profile name and user data directory through structured logs

### Open Start Page Action

Input:

- page session
- start URL

Output:

- raw navigation result

Expected behavior:

- navigates to the configured start URL
- waits for `domcontentloaded`
- logs start URL, final URL, page title, and page ready state
- does not inspect cookies, tokens, local storage, or account secrets

### Site Current Account Action

Input:

- page session after start page navigation
- selected runtime site adapter

Output:

- visible current user metadata

Expected behavior:

- adapter owns site-specific account-link selectors and profile parsing
- opens the visible profile page when the selected site requires it
- logs generic account fields: account name, account handle, account ID,
  description, profile URL, and site key
- does not inspect cookies, tokens, local storage, or account secrets

Current adapter:

- `src/sites/xiaohongshu/current-user-action.ts`

### Generic Search Workflow

Input:

- page session
- selected search site adapter
- keyword
- scroll count

Output:

- site key
- keyword
- search URL
- collected card count
- normalized search item list sorted by parsed publish date

Expected behavior:

- opens the URL returned by the selected site adapter
- waits and scrolls through a page using generic browser behavior
- receives visible raw items from the adapter
- deduplicates items by item ID or URL
- asks the adapter to parse visible publish time text
- does not inspect cookies, tokens, local storage, or account secrets
- treats site selector changes as recoverable maintenance work, not a reason to
  scatter scraping logic across modules

### Search Site Adapter

Input:

- keyword
- page session
- current time for date parsing

Output:

- search URL
- raw visible search result items
- parsed publish date for each visible item when possible

Expected behavior:

- owns site URLs and selectors
- owns site-specific dismissible notices
- owns site-specific visible date parsing rules
- exposes results to the generic search workflow through `SearchSiteAdapter`
- must not import from another site adapter

Current adapter:

- `src/sites/xiaohongshu/search-adapter.ts`

Reusable core boundary:

- `src/core/search/search-workflow.ts` must not contain Xiaohongshu URLs,
  selectors, text labels, or date parsing assumptions

### Session Inspection

Input:

- page session
- selected runtime site adapter

Output:

- session state
- current account result when found
- indicator list
- page URL and title

Expected behavior:

- reports `logged_in` when a current account is visible
- reports `logged_out` when login prompts or login URLs are detected
- reports `challenge_required` when verification, captcha, frequent-access, or
  account-risk prompts are detected
- reports `browser_closed` when the page is no longer available
- detects and reports only; it must not solve captcha, automate login, or bypass
  verification

### Transform

Input:

- raw action result

Output:

- structured data object

Current phase:

- no dedicated transform required unless action output becomes structured

### Storage

Input:

- structured data

Output:

- persisted result

Current phase:

- not implemented

### Monitoring

Input:

- lifecycle events
- action events
- errors

Output:

- structured log records

Required current log events:

- configuration loaded
- browser context creation started
- browser context creation completed
- profile verification started
- profile verification completed
- start page navigation started
- start page navigation completed
- current user lookup started
- current user lookup completed
- shutdown started
- shutdown completed

## Data Models

Runtime configuration:

```text
RuntimeConfig
  site.siteKey
  profile.userDataDir
  profile.profileName
  browser.connectionMode
  browser.cdpUrl
  browser.headless
  browser.channel
  browser.executablePath
  browser.profileDirectory
  browser.flags
  browser.ignoredDefaultArgs
  navigation.startUrl
  runtime.keepBrowserAlive
  runtime.interactiveLoginOnMissingUser
  logging.level
```

API configuration:

```text
ApiConfig
  host
  port
  requestBodyLimitBytes
  accountCheckIntervalMs
  searchDefaults.recentDays
  searchDefaults.limitPerKeyword
  searchDefaults.scrollCount
```

Current account result:

```text
CurrentAccountResult
  siteKey
  displayName
  profileUrl
  accountId
  accountName
  accountHandle
  description
  found
  metadata
  startedAt
  completedAt
```

Session inspection result:

```text
SessionInspectionResult
  siteKey
  state
  checkedAt
  pageUrl
  pageTitle
  currentAccount
  indicators[]
    code
    severity
    message
  errorMessage
```

Session states:

```text
unknown
logged_in
logged_out
challenge_required
browser_closed
error
```

Background task snapshot:

```text
BackgroundTaskSnapshot
  id
  type
  state
  startedAt
  completedAt
  input
  resultSummary
  error
```

Profile verification result:

```text
ProfileVerificationResult
  profileName
  userDataDir
  contextAvailable
  pageAvailable
  startedAt
  completedAt
```

These are conceptual contracts for implementation planning, not code.

## Runtime Lifecycle

```text
Start process
        |
        v
Load and validate configuration
        |
        v
Select runtime site adapter
        |
        v
Create logger
        |
        v
Launch persistent browser context
        |
        v
Create or reuse page session
        |
        v
Run profile verification action
        |
        v
Open configured start URL
        |
        v
Inspect session state
        |
        v
Serve API requests while keeping browser open
        |
        v
Run one task at a time per target session
        |
        v
Run scheduled session inspection while idle
        |
        v
Shutdown signal received
        |
        v
Close browser context
```

## Error Handling Specification

Recoverable errors:

- navigation timeout
- temporary page readiness failure

Current phase behavior:

- log clearly
- no retry unless retry policy is implemented

Non-recoverable errors:

- missing `APP_USER_DATA_DIR`
- missing `APP_PROFILE_NAME`
- profile path does not exist
- profile is already locked by another browser instance
- Playwright cannot launch the persistent context

Current phase behavior:

- fail fast
- log error with module and lifecycle stage
- never log cookies, tokens, or session data
- close any opened resources

## Acceptance Criteria

Step 5 implementation will be accepted when:

- `pnpm install` succeeds
- runtime configuration can be loaded from environment variables
- invalid configuration fails before browser startup
- a valid Chrome user data directory launches through Playwright
- profile name and user data directory are printed through structured logs
- a browser page is available after context creation
- configured start URL can be opened
- API service can keep the visible browser open across requests
- `POST /api/xiaohongshu/search` returns search results
- concurrent search requests return `409 task_busy`
- `/api/status` reports active task, last task, browser page, and session state
- session inspection can report logged-out and verification-required states
- Docker compose starts API, active noVNC, and idle/login noVNC
- Docker compose persists `/data/chrome-user-data`
- resources close cleanly when the API service is interrupted

## Phase Roadmap

Phase 1:

- profile load
- browser initialization
- bootstrap runtime
- profile verification

Phase 2:

- site-adapter search hardening
- user action
- note action
- action-level schemas

Phase 3:

- batch task input
- queue
- scheduler

Phase 4:

- storage adapters
- monitoring
- metrics

Phase 5:

- plugin system
- distributed runtime
