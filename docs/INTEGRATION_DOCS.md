# External Integration And Dependency Docs

## Current Step

Step 2: Documentation.

This file records official documentation addresses for external dependencies,
runtime platforms, and integration targets. It exists so future AI sessions can
quickly find current docs without guessing.

Last checked: 2026-06-03.

## Required Current-Phase Docs

| Area | Official Docs |
| --- | --- |
| Node.js API | https://nodejs.org/api/ |
| Node.js latest API redirect | https://nodejs.org/docs/latest/api/ |
| Node.js process and environment variables | https://nodejs.org/api/process.html |
| Node.js downloads and LTS versions | https://nodejs.org/en/download |
| Playwright docs | https://playwright.dev/docs/intro |
| Playwright BrowserType API | https://playwright.dev/docs/api/class-browsertype |
| Playwright persistent context API | https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context |
| Playwright CDP connect API | https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp |
| Playwright browsers guide | https://playwright.dev/docs/browsers |
| pnpm docs | https://pnpm.io/ |
| pnpm workspace docs | https://pnpm.io/workspaces |
| TypeScript docs | https://www.typescriptlang.org/docs/ |
| TypeScript handbook | https://www.typescriptlang.org/docs/handbook/intro.html |
| tsx docs | https://tsx.is/ |
| Zod docs | https://zod.dev/ |
| Zod GitHub repository | https://github.com/colinhacks/zod |
| Pino docs | https://getpino.io/ |
| Chrome remote debugging policy | https://developer.chrome.com/blog/remote-debugging-port |

## Target Site

| Area | Docs |
| --- | --- |
| Xiaohongshu public website | https://www.xiaohongshu.com/ |
| Xiaohongshu official developer API | No official public collection API is selected for this project phase. |

Notes:

- This project is designed for browser automation with a user-provided logged-in
  profile, not for direct Xiaohongshu API integration.
- If an official Xiaohongshu API or partner integration is later selected, add
  its latest official docs URL here before implementation.
- If a future dependency is added, update this file in the same commit as the
  dependency decision.

## Important Current-Phase Documentation Notes

Playwright persistent context:

- `launchPersistentContext` uses a user data directory and returns one persistent
  browser context.
- Closing that persistent context also closes the browser.
- Browsers do not allow multiple browser instances to use the same user data
  directory at the same time.
- Chromium user data directory is the parent directory of the profile path shown
  in `chrome://version`.

Chrome profile automation:

- Chrome remote debugging behavior changed starting with Chrome 136.
- Automation should use a separate non-standard user data directory.
- Do not automate the everyday default Chrome profile.

pnpm:

- Use pnpm for all dependency and script commands.
- Keep the repository workspace-compatible.

## Update Procedure

When updating this file:

1. Prefer official docs pages.
2. Record the date checked.
3. Include only docs needed by current or approved future work.
4. Remove stale unofficial mirrors if official docs are available.
5. Do not add implementation notes that belong in `docs/SPEC.md` or
   `docs/BUILD.md`.
