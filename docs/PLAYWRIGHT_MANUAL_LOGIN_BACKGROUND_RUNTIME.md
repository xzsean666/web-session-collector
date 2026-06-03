# Playwright Manual Login Background Runtime Pattern

## Purpose

This document defines a reusable design pattern for projects that need browser
automation with a real logged-in session, while avoiding conflicts with the
user's daily browser.

The pattern is:

```text
Isolated browser profile
        |
        v
Headless background run
        |
        v
Detect missing login
        |
        v
Open headed login window
        |
        v
User logs in manually
        |
        v
Close headed window
        |
        v
Restart headless with same profile
        |
        v
Run authenticated automation
```

The goal is not to bypass platform controls. The goal is to keep browser state
stable, explicit, and maintainable.

This document is intended to be implementation-ready for another engineer or AI
agent. A correct implementation should be able to reproduce the same lifecycle
without reading this project's source code.

## When To Use This Pattern

Use this pattern when:

- a project needs authenticated browser automation
- login requires manual user action, MFA, QR scan, or captcha
- credentials should not be stored in environment variables
- automation should not lock or mutate the user's daily Chrome profile
- most work should run in the background with `headless=true`
- the same login state must survive multiple runs

Do not use this pattern when:

- the target system provides a proper official API
- a short-lived Playwright `storageState` file is enough
- the project needs many parallel accounts on the same host without explicit
  profile isolation
- the user expects automation to share an actively used daily Chrome profile

## Guarantee Boundary

This pattern does not guarantee that a target platform will never apply risk
controls, verification challenges, rate limits, or account restrictions.

What this pattern does provide:

- avoids locking or mutating the user's daily Chrome profile
- preserves login state in an isolated automation profile
- keeps headed login and headless execution on one consistent browser profile
- keeps browser environment settings explicit and repeatable
- avoids storing credentials in config files
- avoids opaque default "stealth" patches as an architecture dependency

What this pattern does not provide:

- no promise that a platform will treat automation as a normal human session
- no bypass of captcha, MFA, bot checks, or platform verification
- no automatic credential entry
- no browser fingerprint spoofing strategy
- no permission to violate the target platform's terms or access controls

Use normal traffic limits, respect user account safety, and prefer official APIs
when they are available.

## Core Constraints

### Headless Cannot Be The Login Surface

Manual login must happen in a visible browser window.

Headless mode is for background work after login state already exists.

For debugging, the same runtime may be launched with `headless=false`. In that
mode, keep the same isolated profile and the same browser environment settings,
but run the full automation in a visible browser so a developer can observe page
state and behavior.

### Use An Isolated Automation Profile

Never use the user's daily Chrome profile as the default automation profile.

Recommended shape:

```text
~/.cache/<project-name>/chrome-user-data/
```

That directory is the Playwright persistent user data directory. It stores
cookies, local storage, IndexedDB, extensions if enabled, and other browser
state for the automation profile.

### Never Open The Same User Data Directory Twice

Chrome user data directories are exclusive. Do not run two browser instances
against the same profile directory at the same time.

Correct:

```text
close headless
open headed login window
close headed login window
open headless again
```

Incorrect:

```text
keep headless open
open headed login window with same user data directory
```

### CDP Connects To A Browser Process, Not A Profile

`connectOverCDP` attaches to an existing browser process. It does not reliably
isolate one Chrome profile when the process has multiple profiles open.

If CDP is used, prefer connecting only to a dedicated browser process or reuse
an already-open target page. Do not blindly create new pages in a shared daily
Chrome process.

## System Architecture

```text
Configuration Layer
        |
        v
Runtime Orchestrator
        |
        v
Browser Session Manager
        |
        v
Page Session Manager
        |
        v
Authentication Detector
        |
        v
Interactive Login Fallback
        |
        v
Authenticated Task Runner
        |
        v
Shutdown And Cleanup
```

## Module Responsibilities

### Configuration Layer

Purpose:

- load environment variables
- validate profile path and browser options
- centralize browser environment parameters
- expose one runtime config object

Input:

- user data directory
- browser mode
- headless flag
- executable path or browser channel
- locale
- timezone
- viewport
- device scale factor
- login fallback flag

Output:

- validated runtime configuration

Rules:

- no module except configuration reads environment variables
- defaults must be explicit
- invalid browser profile paths fail fast

### Browser Session Manager

Purpose:

- launch a Playwright persistent browser context
- connect to an existing browser only when explicitly configured
- close contexts cleanly
- tolerate already-closed windows during manual login

Input:

- profile config
- browser config

Output:

- browser context
- close mode

Rules:

- no business logic
- no login detection
- no data extraction
- close the persistent context to flush profile state before reopening

### Page Session Manager

Purpose:

- select or create a page for the current browser context
- make page lifecycle behavior explicit
- prevent accidental new-page creation in unsafe CDP connect mode

Input:

- browser context
- page selection options

Output:

- page session

Rules:

- actions receive a page session, not a raw global page
- connect mode should only use approved existing pages

### Authentication Detector

Purpose:

- determine whether the current browser session is authenticated
- return a minimal user summary when possible

Input:

- page session

Output:

```text
Authenticated:
  found=true
  user summary fields

Unauthenticated:
  found=false
  empty user summary
```

Rules:

- never log cookies, tokens, local storage, or headers
- use visible page state, account menu state, or a stable profile page signal
- a missing user should be a normal result, not always a fatal error

### Interactive Login Fallback

Purpose:

- open a visible browser only when authentication is missing
- let the user complete login manually
- wait for Enter, window close, or process signal
- close the headed browser
- restart headless with the same profile

Input:

- runtime config
- missing-auth result

Output:

- updated persistent profile state

Rules:

- only supported in launch mode
- only run when `headless=true` and login fallback is enabled
- do not attempt to automate credentials or bypass verification challenges

### Authenticated Task Runner

Purpose:

- execute the project's real automation tasks after authentication is confirmed

Input:

- authenticated page session
- task input

Output:

- project-specific task result

Rules:

- tasks should not own browser startup or login fallback
- tasks should fail clearly if authentication is required but missing

## Runtime Lifecycle

### Normal Authenticated Run

```text
Load config
        |
        v
Launch isolated profile with headless=true
        |
        v
Open start URL
        |
        v
Detect authentication
        |
        v
Run authenticated tasks
        |
        v
Close browser context
```

### Visible Debug Run

Use this lifecycle when the developer wants to watch automation behavior:

```text
Load config
        |
        v
Launch isolated profile with headless=false
        |
        v
Open start URL
        |
        v
Detect authentication
        |
        v
Run tasks visibly
        |
        v
Close browser context
```

The debug run should not switch to the user's daily Chrome profile. The only
change from a background run should be the headless flag.

### First Run Or Expired Login

```text
Load config
        |
        v
Launch isolated profile with headless=true
        |
        v
Open start URL
        |
        v
Detect authentication missing
        |
        v
Close headless context
        |
        v
Launch same isolated profile with headless=false
        |
        v
Open start URL
        |
        v
User logs in manually
        |
        v
User presses Enter or closes login window
        |
        v
Close headed context
        |
        v
Launch same isolated profile with headless=true
        |
        v
Detect authentication again
        |
        v
Run authenticated tasks
        |
        v
Close browser context
```

## Data Flow

```text
Environment variables
        |
        v
Runtime config
        |
        v
Browser launch options
        |
        v
Persistent profile state
        |
        v
Page session
        |
        v
Authentication result
        |
        v
Task execution decision
```

Sensitive data flow:

```text
Cookies / local storage / login tokens
        |
        v
Browser profile directory only
```

Sensitive data must not flow into:

- logs
- environment variables
- test snapshots
- task results
- handoff documents

## Recommended Configuration Model

Generic variable names for new projects:

```text
APP_USER_DATA_DIR=~/.cache/<project-name>/chrome-user-data
APP_PROFILE_NAME=isolated-automation
APP_BROWSER_MODE=launch
APP_HEADLESS=true
APP_BROWSER_CHANNEL=chrome
APP_EXECUTABLE_PATH=/opt/google/chrome/google-chrome
APP_PROFILE_DIRECTORY=Default
APP_LOCALE=zh-CN
APP_TIMEZONE_ID=Asia/Shanghai
APP_VIEWPORT_WIDTH=1366
APP_VIEWPORT_HEIGHT=768
APP_DEVICE_SCALE_FACTOR=1
APP_START_URL=https://example.com/
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=true
APP_BROWSER_FLAGS='["--no-first-run","--no-default-browser-check"]'
APP_IGNORE_DEFAULT_ARGS='[]'
```

Project-specific names can be used, but keep the same structure.

For visible debugging:

```text
APP_HEADLESS=false
APP_INTERACTIVE_LOGIN_ON_MISSING_USER=false
```

Set `APP_INTERACTIVE_LOGIN_ON_MISSING_USER=false` during a fully visible debug
run because the whole browser is already visible. Keep it enabled for normal
headless background runs that need an automatic login fallback.

## Browser Environment Parameters

Use normal, consistent desktop browser parameters:

- branded Chrome executable when the target site is Chrome-oriented
- stable locale
- stable timezone
- stable viewport
- stable device scale factor
- explicit profile directory
- isolated user data directory

Avoid:

- randomizing browser identity on every run
- mixing mobile and desktop signals accidentally
- changing locale, timezone, and viewport between login and headless runs
- injecting opaque stealth scripts as a default architecture decision
- assuming a browser parameter set can eliminate all platform risk controls

The same environment parameters must apply to:

- first headless check
- headed login fallback
- second headless run

## Login Detection Strategy

The authentication detector should be project-specific but structurally simple.

Good detection signals:

- visible account menu or profile link
- current user's profile page loads with expected account fields
- a stable page element appears only for authenticated users
- an unauthenticated login prompt appears

Avoid:

- reading raw cookies just to decide whether login exists
- logging token-like values
- relying on one brittle CSS selector without fallback
- treating slow page loading as login failure without timeout handling

Recommended result shape:

```text
AuthResult
  found: boolean
  accountName: string
  accountId: string
  accountHandle: string
  profileUrl: string
  detectedAt: string
```

## User Experience Contract

When login fallback opens:

```text
Interactive login window is open.
Finish login in the browser.
Then press Enter in the terminal or close the browser window.
```

The runtime should accept:

- Enter in terminal
- login window close
- page close
- SIGINT
- SIGTERM

After release:

- close the headed context
- reopen headless with the same profile
- rerun auth detection
- proceed only if authentication is found

For visible debug mode:

```text
APP_HEADLESS=false
```

The runtime should open the normal automation window immediately and let the
developer watch the full run. This is useful while building selectors, observing
navigation, diagnosing login state, and understanding site UI changes.

## Error Handling

Recoverable:

- missing login
- login window closed by user
- page closed after login
- temporary navigation timeout

Non-recoverable:

- invalid profile directory
- profile directory locked by another browser
- executable path missing
- invalid config
- auth still missing after interactive login when authenticated work is required

## Testing Strategy

Unit tests:

- config parsing
- default values
- invalid viewport and scale values
- login fallback decision logic

Integration tests:

- headless opens start URL with isolated profile
- missing auth opens headed login fallback
- headed close restarts headless
- authenticated profile skips headed login
- headless=false visible debug mode uses the same isolated profile and does not
  open a second browser with the same user data directory
- no automation process remains after shutdown

Manual validation:

```text
1. Ensure daily Chrome is open.
2. Run automation with isolated profile.
3. Confirm daily Chrome is not locked or closed.
4. If login is missing, complete login in the headed automation window.
5. Close headed automation window.
6. Confirm headless run resumes and prints authenticated user summary.
7. Run once with `headless=false` for visible debugging and confirm it still
   uses the isolated profile.
8. Confirm no automation Chrome process remains.
```

## Security Rules

- do not store passwords in `.env`
- do not print cookies, local storage, request headers, or tokens
- do not commit the browser profile directory
- do not archive the profile directory in handoff files
- do not share the isolated profile across unrelated projects
- document exactly where profile state is stored

## Anti-Patterns

Avoid:

- using the daily Chrome profile as the automation default
- opening the same user data directory in two Chrome instances at once
- logging in through headless mode
- mixing login, browser lifecycle, and business scraping in one module
- silently falling back from isolated profile to daily profile
- creating new pages in a shared CDP-connected daily Chrome process
- making task modules responsible for browser startup
- scattering environment variable reads across the codebase
- documenting or promising that the pattern will never trigger platform risk
  controls
- changing the user data directory when switching between headless and visible
  debug mode

## Reusable Implementation Checklist

1. Create an isolated user data directory under `~/.cache/<project-name>/`.
2. Centralize browser config parsing.
3. Launch with `launchPersistentContext`.
4. Apply locale, timezone, viewport, and device scale factor in context options.
5. Run an auth detector before authenticated tasks.
6. If auth is missing, close headless before opening headed login.
7. Open headed login with the same profile directory.
8. Wait for Enter, page close, context close, or signal.
9. Close headed context.
10. Reopen headless with the same profile directory.
11. Run auth detector again.
12. Continue only when authentication is confirmed.
13. Close browser context in `finally`.
14. Support `headless=false` visible debug mode through config only.
15. Check for residual browser processes during validation.
16. Document the risk-control boundary and avoid making no-risk guarantees.
17. Commit docs and config examples with the implementation.

## Environment Contract

Recommended generic names for projects using this pattern:

```text
APP_USER_DATA_DIR
APP_PROFILE_NAME
APP_BROWSER_MODE
APP_HEADLESS
APP_BROWSER_CHANNEL
APP_EXECUTABLE_PATH
APP_PROFILE_DIRECTORY
APP_LOCALE
APP_TIMEZONE_ID
APP_VIEWPORT_WIDTH
APP_VIEWPORT_HEIGHT
APP_DEVICE_SCALE_FACTOR
APP_START_URL
APP_INTERACTIVE_LOGIN_ON_MISSING_USER
```

Projects may add compatibility aliases, but the reusable runtime should keep
one generic configuration contract internally.

Example isolated profile path:

```text
~/.cache/<project-name>/chrome-user-data
```

Current proven lifecycle:

```text
headless isolated profile
        |
        v
missing user detected
        |
        v
headed login window
        |
        v
user closes window after login
        |
        v
headless isolated profile
        |
        v
current user printed successfully
```
