# Next Session Handoff

## Current Step

Step 5: Background browser API service is implemented.

## Current Progress

Completed:

- architecture, specification, build guide, integration docs, and handoff docs
- pnpm TypeScript project with strict compiler settings
- reusable Playwright runtime under `src/core/`
- Xiaohongshu runtime and search adapters under `src/sites/xiaohongshu/`
- site registry for runtime adapters and search adapters
- isolated Chrome profile launch mode
- CDP connect mode that reuses an existing target-site tab
- interactive headed login fallback when a headless run cannot find the current
  account
- keyword search CLI with multi-keyword input, date filtering, limits, scrolls,
  headed debug mode, and JSON output
- shared search task module used by both CLI and API
- background API service that keeps one visible persistent browser open
- single-flight Xiaohongshu search API with `409 task_busy`
- session monitor for logged-out, verification-required, browser-closed, and
  error states
- Dockerfile and compose deployment with Xvfb, x11vnc, noVNC, and persistent
  Chrome user data volume

Not implemented by design:

- official/direct Xiaohongshu API integration
- captcha solving, verification bypass, fingerprint spoofing, or stealth
  patches
- storage adapters
- proxy support
- queue or scheduler
- distributed execution
- UI
- plugin system

Latest known successful validation before this handoff:

- `pnpm run check`

## Architecture Summary

The project is a reusable browser automation framework with one current site
implementation.

Core boundary:

- `src/core/config/`: generic `APP_*` configuration parsing
- `src/core/browser/`: Playwright launch/connect lifecycle
- `src/core/context/`: page session lifecycle
- `src/core/actions/`: generic profile and navigation actions
- `src/core/search/`: generic search workflow and contracts
- `src/core/monitoring/`: structured logging
- `src/core/types/`: reusable contracts
- `src/runtime/search-task.ts`: shared search task execution and result
  filtering
- `src/runtime/background-browser-service.ts`: long-lived browser service for
  API mode
- `src/api/`: API config and HTTP server

Project and site boundary:

- `src/config/runtime-config.ts`: project defaults for runtime configuration
- `src/runtime/runtime.ts`: lifecycle orchestration through
  `RuntimeSiteAdapter`
- `src/sites/site-registry.ts`: runtime and search adapter registration
- `src/sites/xiaohongshu/`: Xiaohongshu URLs, selectors, account detection,
  notices, and visible date parsing
- `src/scripts/collect.ts`: CLI entry point for generic search workflow
- `Dockerfile`, `docker-compose.yml`, `docker/entrypoint.sh`: Docker noVNC API
  deployment

Rule to preserve:

```text
src/core must not contain Xiaohongshu URLs, selectors, UI labels, date parsing,
or site-specific configuration names.
```

## Completed Parts

Root document:

- `Agent.md`: AI agent operating guide, workflow, module boundaries, and
  repository rules

Docs:

- `docs/ARCHITECTURE.md`: reusable core plus site adapter architecture
- `docs/SPEC.md`: system specification, config model, module contracts, data
  models, lifecycle, and acceptance criteria
- `docs/BUILD.md`: install, env examples, run commands, profile preparation,
  search usage, and troubleshooting
- `docs/INTEGRATION_DOCS.md`: official external docs URLs checked on
  2026-06-03
- `docs/PLAYWRIGHT_MANUAL_LOGIN_BACKGROUND_RUNTIME.md`: reusable pattern for
  isolated Playwright profiles, headed manual login, and headless background
  runs

Implementation:

- `.env.example`: `APP_*` primary environment example
- `src/core/types/current-account.ts`: generic current account result
- `src/core/types/site-runtime.ts`: `RuntimeSiteAdapter` contract
- `src/sites/xiaohongshu/runtime-adapter.ts`: Xiaohongshu runtime adapter
- `src/sites/xiaohongshu/current-user-action.ts`: Xiaohongshu current account
  extraction
- `src/sites/xiaohongshu/search-adapter.ts`: Xiaohongshu search adapter
- `tests/runtime-config.test.ts`: config parsing, defaults, and validation tests

## Current Configuration Convention

Prefer generic environment names:

```text
APP_SITE=xiaohongshu
APP_USER_DATA_DIR=/home/sean/.cache/web-session-collector/chrome-user-data
APP_PROFILE_NAME=isolated-automation
APP_BROWSER_MODE=launch
APP_HEADLESS=false
APP_EXECUTABLE_PATH=/opt/google/chrome/google-chrome
APP_PROFILE_DIRECTORY=Default
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=false
APP_API_HOST=0.0.0.0
APP_API_PORT=10085
ACTIVE_NOVNC_PORT=10086
IDLE_NOVNC_PORT=10087
APP_ACCOUNT_CHECK_INTERVAL_MS=60000
APP_TASK=search
APP_SEARCH_SITE=xiaohongshu
```

Only `APP_*` environment names are supported.

## Pending Tasks

Immediate validation for the next session:

1. Run `pnpm run check`.
2. Run `pnpm run test`.
3. Optionally run `pnpm run api` with a prepared visible Chrome environment.
4. Call `GET /api/status`.
5. Call `POST /api/xiaohongshu/search`.
6. Optionally run `docker compose up --build` and open active noVNC at
   `http://127.0.0.1:10086/vnc.html` and idle noVNC at
   `http://127.0.0.1:10087/vnc.html`.

Next feature candidates:

1. Harden Xiaohongshu selectors if the UI changes.
2. Add another site adapter to prove the generic core boundary.
3. Add API auth if the service is exposed beyond localhost.
4. Add transform contracts.
5. Add storage only after a concrete output target is approved.

## Risks And Unknowns

Chrome profile handling:

- launch mode requires exclusive access to `APP_USER_DATA_DIR`
- use the isolated automation profile by default to avoid locking daily Chrome
- `connect` mode attaches to the whole Chrome process over CDP
- in `connect` mode, open the target-site tab yourself first; the framework
  reuses an existing matching tab instead of creating a new tab that may land in
  another Chrome profile
- Chrome remote debugging behavior changed in Chrome 136, so automation should
  use a separate non-standard user data directory when possible
- API mode owns one visible browser and one active page; search and monitoring
  do not run concurrently on that page
- Docker compose persists Chrome user data in a named volume; do not run another
  Chrome process against that same profile directory

Site behavior:

- no official Xiaohongshu collection API is selected
- browser automation can break when site selectors, notices, or visible date
  formats change
- this design cannot guarantee avoidance of platform risk controls
- session monitoring detects login and verification states but does not bypass
  them

Repository rules:

- use pnpm only
- do not push
- do not move site-specific behavior into `src/core/`
- update `docs/INTEGRATION_DOCS.md` whenever a new dependency or external
  integration is introduced
