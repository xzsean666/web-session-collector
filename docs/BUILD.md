# Build And Usage Guide

## Current Status

Step 4 MVP implementation is complete.

This guide describes how to install, check, test, and run the current MVP.

## Prerequisites

Required:

- Node.js LTS
- pnpm
- Chrome installed locally when using the default `APP_BROWSER_CHANNEL=chrome`
- Chrome installed locally, or Playwright bundled Chromium
- an isolated automation browser profile directory

The project must use pnpm only. Do not use npm or yarn for install, run, or
workspace commands.

## Current Repository State

Current state:

- architecture documentation exists
- system specification exists
- pnpm TypeScript project exists
- MVP runtime implementation exists
- configuration tests exist

## Installation

Install dependencies:

```text
pnpm install
```

The default browser channel is branded Chrome:

```text
APP_BROWSER_CHANNEL=chrome
```

If you want to use Playwright bundled Chromium instead:

```text
pnpm exec playwright install chromium
APP_BROWSER_CHANNEL=bundled
```

## Environment Variables

Minimum environment:

```text
APP_SITE=xiaohongshu
APP_USER_DATA_DIR=/home/sean/.cache/web-session-collector/chrome-user-data
APP_PROFILE_NAME=isolated-automation
APP_BROWSER_MODE=launch
APP_CDP_URL=
APP_HEADLESS=true
APP_BROWSER_CHANNEL=chrome
APP_EXECUTABLE_PATH=/opt/google/chrome/google-chrome
APP_PROFILE_DIRECTORY=Default
APP_LOCALE=zh-CN
APP_TIMEZONE_ID=Asia/Shanghai
APP_VIEWPORT_WIDTH=1366
APP_VIEWPORT_HEIGHT=768
APP_DEVICE_SCALE_FACTOR=1
APP_START_URL=https://www.xiaohongshu.com/
APP_LOG_LEVEL=info
APP_KEEP_BROWSER_ALIVE=false
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true
APP_BROWSER_FLAGS='["--no-first-run","--no-default-browser-check"]'
APP_IGNORE_DEFAULT_ARGS='[]'
APP_TASK=search
APP_SEARCH_RECENT_DAYS=30
APP_SEARCH_LIMIT=10
APP_SEARCH_SCROLLS=2
APP_SEARCH_LOG_LEVEL=warn
APP_SEARCH_SITE=xiaohongshu
```

Defaults:

| Name | Default |
| --- | --- |
| `APP_SITE` | `xiaohongshu` |
| `APP_HEADLESS` | `false` |
| `APP_BROWSER_MODE` | `launch` |
| `APP_CDP_URL` | unset |
| `APP_BROWSER_CHANNEL` | `chrome` |
| `APP_EXECUTABLE_PATH` | unset |
| `APP_PROFILE_DIRECTORY` | unset |
| `APP_LOCALE` | `zh-CN` |
| `APP_TIMEZONE_ID` | `Asia/Shanghai` |
| `APP_VIEWPORT_WIDTH` | `1366` |
| `APP_VIEWPORT_HEIGHT` | `768` |
| `APP_DEVICE_SCALE_FACTOR` | `1` |
| `APP_START_URL` | selected runtime site adapter default |
| `APP_BROWSER_FLAGS` | empty list |
| `APP_IGNORE_DEFAULT_ARGS` | empty list |
| `APP_LOG_LEVEL` | `info` |
| `APP_KEEP_BROWSER_ALIVE` | `false` |
| `APP_INTERACTIVE_LOGIN_ON_MISSING_USER` | `false` |
| `APP_TASK` | `search` |
| `APP_SEARCH_RECENT_DAYS` | `30` |
| `APP_SEARCH_LIMIT` | `10` |
| `APP_SEARCH_SCROLLS` | `2` |
| `APP_SEARCH_LOG_LEVEL` | `warn` |
| `APP_SEARCH_SITE` | `APP_SITE`, then `xiaohongshu` |

Notes:

- `APP_USER_DATA_DIR` must point to a user data directory that is not in active
  use by another Chrome or Playwright process.
- The recommended default is an isolated automation directory under
  `/home/sean/.cache/web-session-collector/` so the framework does not lock or
  mutate the user's daily Chrome profile.
- Use `APP_BROWSER_MODE=connect` to attach to an already-open Chrome instance
  over CDP. This avoids launching a second Chrome with the same user data
  directory.
- To use `connect` mode, Chrome must be started with a remote debugging port
  before the project runs.
- For persistent Playwright contexts, the user data directory is the parent of
  the Chrome profile path shown by `chrome://version`.
- Do not use the everyday default Chrome profile for automation. Use a separate
  automation profile directory.
- Do not put secrets, cookies, or account credentials into environment
  variables unless a future security model explicitly supports them.
- `APP_BROWSER_FLAGS` accepts a JSON string array or a comma-separated list.
  Prefer JSON for flags whose values may contain commas.
- `APP_EXECUTABLE_PATH` can point to the Chrome executable shown by
  `chrome://version`.
- `APP_PROFILE_DIRECTORY` is converted into a `--profile-directory=...` launch
  argument by the browser module.
- `APP_LOCALE`, `APP_TIMEZONE_ID`, `APP_VIEWPORT_WIDTH`,
  `APP_VIEWPORT_HEIGHT`, and `APP_DEVICE_SCALE_FACTOR` define a consistent
  desktop browser environment for both headed login and headless runs.
- `APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true` only works in
  `APP_BROWSER_MODE=launch`. When a headless run cannot find the current user,
  the framework closes headless Chrome, opens a visible login window, waits for
  Enter or browser close, then restarts headless with the same isolated profile.
- `APP_IGNORE_DEFAULT_ARGS` removes selected Playwright default launch
  arguments. For a real Chrome profile, removing `--password-store=basic`,
  `--use-mock-keychain`, and `--disable-sync` is closer to normal Chrome
  profile behavior.
- `APP_START_URL` must be an `http` or `https` URL. It is opened after Profile
  verification so the run can confirm the logged-in browser state reaches the
  target site.
- When `APP_KEEP_BROWSER_ALIVE=true`, press Enter in the terminal to close the
  browser cleanly after inspection.
- `APP_SEARCH_RECENT_DAYS`, `APP_SEARCH_LIMIT`, `APP_SEARCH_SCROLLS`, and
  `APP_SEARCH_LOG_LEVEL` are used by the `search` task in `pnpm run collect`.
  They do not affect the MVP runtime.
- `APP_SEARCH_SITE` selects the site adapter used by `pnpm run collect`.
- Environment configuration uses `APP_*` names only.

## Run Commands

Available commands:

```text
pnpm run dev
pnpm run collect
pnpm run collect:xiaohongshu
pnpm run build
pnpm run start
pnpm run check
pnpm run test
```

Meanings:

- `pnpm run dev`: run the framework in development mode
- `pnpm run collect`: run a selected collection task through a selected site
  adapter; the current implemented task is `search`
- `pnpm run collect:xiaohongshu`: run collection with the Xiaohongshu site
  adapter selected explicitly
- `pnpm run build`: compile TypeScript into `dist/`
- `pnpm run start`: run the compiled framework
- `pnpm run check`: run TypeScript type checking without emit
- `pnpm run test`: compile and run Node built-in tests

Example using `.env`:

```text
cp .env.example .env
set -a
source .env
set +a
pnpm run dev
```

Keyword search examples:

```text
pnpm run collect:xiaohongshu -- 咖啡 成都
pnpm run collect -- --site=xiaohongshu 咖啡 成都
pnpm run collect -- --site=xiaohongshu --task=search 咖啡 成都
pnpm run collect:xiaohongshu -- "咖啡,露营,上海" --days=14 --limit=8
pnpm run collect:xiaohongshu -- 咖啡 --scrolls=4
pnpm run collect:xiaohongshu -- 咖啡 --headed
pnpm run collect:xiaohongshu -- 咖啡 --json
```

Search behavior:

- `--task=search` selects the current keyword search task; it is the default
- if no keyword is passed, the script prompts for keywords in the terminal
- keywords can be separated by spaces, commas, Chinese commas, or Chinese
  enumeration commas
- `--site=xiaohongshu` selects the Xiaohongshu adapter; it is the current
  default adapter
- `--days=30` keeps only notes with parsed publish dates from the last 30 days
- `--days=0` disables date filtering
- `--limit=10` limits output per keyword
- `--scrolls=2` controls how many times each search page scrolls before
  extraction
- `--headed` runs with a visible browser for debugging
- results are sorted by parsed publish date descending after collection
- shared browser lifecycle, page lifecycle, scrolling, date sorting, and output
  formatting live in `src/core`; site URLs and selectors live under
  `src/sites/<site>/`

Example using inline environment variables with the isolated automation
profile:

```text
APP_SITE=xiaohongshu \
APP_USER_DATA_DIR=/home/sean/.cache/web-session-collector/chrome-user-data \
APP_PROFILE_NAME=isolated-automation \
APP_BROWSER_MODE=launch \
APP_HEADLESS=true \
APP_EXECUTABLE_PATH=/opt/google/chrome/google-chrome \
APP_PROFILE_DIRECTORY=Default \
APP_LOCALE=zh-CN \
APP_TIMEZONE_ID=Asia/Shanghai \
APP_VIEWPORT_WIDTH=1366 \
APP_VIEWPORT_HEIGHT=768 \
APP_DEVICE_SCALE_FACTOR=1 \
APP_START_URL=https://www.xiaohongshu.com/ \
APP_KEEP_BROWSER_ALIVE=false \
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true \
APP_BROWSER_FLAGS='["--no-first-run","--no-default-browser-check"]' \
APP_IGNORE_DEFAULT_ARGS='[]' \
APP_TASK=search \
pnpm run dev
```

Advanced example using the user's original `Profile 7` through `connect` mode:

```text
/opt/google/chrome/google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/home/sean/.config/google-chrome \
  --profile-directory="Profile 7"
```

Chrome must not already be running with the same user data directory when this
command starts. After it starts this way, use that Chrome normally and open a
dedicated Xiaohongshu tab in `Profile 7`.

In `connect` mode the framework connects to the existing Chrome process and
does not launch another Chrome. To avoid accidentally opening a page in another
profile inside the same Chrome process, the framework only reuses an already
open `xiaohongshu.com` page. If no such page exists, the run fails fast.

## Profile Preparation

The framework does not log in to Xiaohongshu accounts.

User responsibilities:

- log in to Xiaohongshu inside the isolated automation profile if the run needs
  authenticated user information
- when the interactive login window opens, finish login and then press Enter in
  the terminal or close the browser window
- start Chrome with the intended profile and remote debugging port when using
  `connect` mode
- open a dedicated Xiaohongshu tab in the intended profile before running the
  framework in `connect` mode
- log in manually outside the framework
- keep that Chrome open while the framework runs
- maintain account and session lifecycle

Framework responsibilities:

- load the provided profile directory
- create a persistent context in `launch` mode or connect to the existing
  default context in `connect` mode
- reuse an existing Xiaohongshu page in `connect` mode instead of creating a
  new page
- verify that a page can be used
- print profile metadata without exposing sensitive session data

## Expected Phase 1 Verification

A successful run should show structured logs for:

- configuration loaded
- browser context creation started
- browser context creation completed
- profile verification started
- start page navigation started
- final URL and page title after navigation
- current account name, account handle, account ID, site key, and profile URL
- active profile name
- active user data directory
- page availability
- keep-alive mode or shutdown
- clean shutdown after Enter when keep-alive mode is enabled

## Troubleshooting Rules

Invalid profile path:

- check `APP_USER_DATA_DIR`
- use an absolute path
- confirm the directory exists

Profile already in use:

- close Chrome and other Playwright processes using the same directory
- use a separate automation profile directory

Browser exits immediately:

- confirm the profile is not the everyday default Chrome profile
- check Chrome policy limitations for remote debugging and profile automation
- review Playwright browser launch options

Missing Playwright browser:

- install browser binaries with pnpm-compatible commands
- do not mix npm or yarn commands

## Documentation Maintenance

When dependencies or external systems are added:

- update `docs/INTEGRATION_DOCS.md`
- record official docs URLs
- record the date the links were checked
- avoid relying on unofficial mirrors unless there is no official source

When implementation changes architecture:

- update `docs/ARCHITECTURE.md`
- update `docs/SPEC.md`
- update `docs/nextsession.md`
