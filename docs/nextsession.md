# Next Session Handoff

## Current Step

Step 4: MVP Implementation and decoupling are complete.

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

Not implemented by design:

- direct Xiaohongshu API integration
- storage adapters
- proxy support
- queue or scheduler
- distributed execution
- UI
- plugin system

Latest known successful validation before this handoff:

- `pnpm run check`
- `pnpm run test`
- `pnpm run collect:xiaohongshu -- 咖啡 --days=30 --limit=2 --scrolls=1`
- `pnpm run dev` with the isolated automation profile
- current account was found in the isolated profile

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

Project and site boundary:

- `src/config/runtime-config.ts`: project defaults for runtime configuration
- `src/runtime/runtime.ts`: lifecycle orchestration through
  `RuntimeSiteAdapter`
- `src/sites/site-registry.ts`: runtime and search adapter registration
- `src/sites/xiaohongshu/`: Xiaohongshu URLs, selectors, account detection,
  notices, and visible date parsing
- `src/scripts/collect.ts`: CLI entry point for generic search workflow

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
APP_HEADLESS=true
APP_EXECUTABLE_PATH=/opt/google/chrome/google-chrome
APP_PROFILE_DIRECTORY=Default
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true
APP_TASK=search
APP_SEARCH_SITE=xiaohongshu
```

Only `APP_*` environment names are supported.

## Pending Tasks

Immediate validation for the next session:

1. Run `pnpm run check`.
2. Run `pnpm run test`.
3. Run `pnpm run collect:xiaohongshu -- 咖啡 --days=30 --limit=2 --scrolls=1`.
4. Optionally run `pnpm run dev` if browser validation is needed.
5. Confirm no automation Chrome process remains after validation.

Next feature candidates:

1. Harden Xiaohongshu selectors if the UI changes.
2. Add another site adapter to prove the generic core boundary.
3. Add action input schemas.
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

Site behavior:

- no official Xiaohongshu collection API is selected
- browser automation can break when site selectors, notices, or visible date
  formats change
- this design cannot guarantee avoidance of platform risk controls

Repository rules:

- use pnpm only
- do not push
- do not move site-specific behavior into `src/core/`
- update `docs/INTEGRATION_DOCS.md` whenever a new dependency or external
  integration is introduced
