# Playwright Data Collection Framework Architecture

## Current Step

Step 5: Background browser API service.

This document defines the architecture, module responsibilities, data flow, and
key design decisions for the current project phase.

## Overall System Architecture

The framework is organized around a reusable Playwright core and thin site
adapters. Configuration is loaded first, the runtime selects a site adapter, the
browser layer opens or connects to a Chrome context, generic workflows operate
on a page session, and site adapters provide URLs, selectors, account parsing,
and visible date parsing.

```text
Configuration Layer
        |
        v
API / Runtime Layer
        |
        v
Background Browser Service
        |
        v
Site Adapter Layer
        |
        v
Browser Layer
        |
        v
Context Layer
        |
        v
Action Layer
        |
        v
Transform Layer
        |
Monitoring Layer
```

Current phase scope:

```text
Load configuration
        |
        v
Start API service
        |
        v
Load persistent Chrome profile
        |
        v
Create visible persistent browser context
        |
        v
Open configured start URL
        |
        v
Inspect login / verification state
        |
        v
Wait for API requests
        |
        v
Run one search task at a time
        |
        v
Return result or busy/account-attention status
        |
        v
Keep browser open until service shutdown
```

Docker deployment scope:

```text
Docker container
        |
        v
Xvfb desktop + fluxbox
        |
        v
Visible Chrome with persistent /data/chrome-user-data
        |
        v
x11vnc + noVNC for manual login
        |
        v
HTTP API service
        |
        v
Caller invokes Xiaohongshu search API
```

## Planned Directory Structure

```text
Agent.md
docs/
  ARCHITECTURE.md
  SPEC.md
  BUILD.md
  INTEGRATION_DOCS.md
  nextsession.md
src/
  api/
  core/
    actions/
    browser/
    config/
    context/
    monitoring/
    search/
    types/
  config/
  runtime/
  sites/
    xiaohongshu/
  transform/
  storage/
  types/
  scripts/
docker/
Dockerfile
docker-compose.yml
```

Core modules contain reusable browser lifecycle, page lifecycle, config,
logging, and search workflow logic. Site modules contain URLs, selectors,
site-specific authentication, site-specific notices, and visible date parsing.
`src/core/` must remain reusable for other browser automation projects.

## Module Breakdown

### Configuration Module

Purpose:

- load environment variables
- validate runtime settings
- produce one explicit runtime configuration object

Input:

- `user_data_dir`
- `profile_name`
- `site`
- `browser_mode`
- `cdp_url`
- `headless`
- `browser_channel`
- `executable_path`
- `profile_directory`
- `browser_flags`
- `ignore_default_args`
- `start_url`
- `log_level`
- optional future runtime flags

Output:

- validated runtime configuration

Dependencies:

- environment variable source
- schema validation library

Rules:

- configuration must be centralized
- invalid configuration is non-recoverable and must fail fast
- modules must receive configuration explicitly

### API Module

Purpose:

- expose a local HTTP API for browser-backed tasks
- keep one background browser service alive for the process lifetime
- return explicit busy or account-attention responses instead of queueing
  unbounded work

Input:

- HTTP requests
- validated API configuration
- background browser service status

Output:

- JSON API responses
- task result payloads
- session status payloads

Dependencies:

- Node HTTP server
- API configuration
- background browser service
- logger

Rules:

- API routes must not create browser contexts directly
- when a search task is running, another search request returns `409`
- when the session monitor reports logged out or verification required, search
  requests return an account-attention response
- API output must not expose cookies, tokens, local storage, or raw session data

### Runtime Module

Purpose:

- orchestrate boot, run, and shutdown
- own top-level error handling
- ensure resources are released

Input:

- validated runtime configuration
- selected runtime site adapter

Output:

- lifecycle result
- process exit status

Dependencies:

- configuration module
- browser module
- monitoring module
- action module
- site registry

Rules:

- runtime coordinates modules but does not contain browser automation details
- runtime depends on the `RuntimeSiteAdapter` contract, not on a concrete site
- runtime does not transform or persist business data

### Browser Module

Purpose:

- create and close Playwright persistent browser context
- connect to an existing Chrome over CDP when configured
- load the configured Chrome user data directory
- apply browser channel, executable path, profile directory, launch options, and
  flags

Input:

- browser-related runtime configuration

Output:

- Playwright persistent browser context

Dependencies:

- Playwright
- browser configuration
- logger

Rules:

- no business logic
- no storage logic
- profile path handling must be explicit
- same profile directory must not be used by multiple browser instances
- connect mode must disconnect from Chrome without closing the user's browser
- launch mode defaults to a visible browser, not headless
- do not add fingerprint spoofing or verification-bypass launch behavior

### Context Module

Purpose:

- provide page and session abstractions over the persistent browser context
- keep page lifecycle behavior explicit
- expose only the browser state needed by actions

Input:

- persistent browser context

Output:

- page session object
- context metadata

Dependencies:

- browser module output
- logger

Rules:

- actions should not create browser contexts directly
- page creation and cleanup must be visible

### Action Module

Purpose:

- execute isolated browser tasks and site-specific adapters
- interact with pages
- collect raw outputs

Current core actions:

- verify profile context availability
- open configured start URL

Current site actions and adapters:

- print current account information through the selected runtime adapter
- collect search cards through the selected search adapter
- inspect login and verification state through the selected runtime adapter

Future site actions:

- feed
- user
- note
- comment
- export

Input:

- page session
- action-specific input

Output:

- raw action result

Dependencies:

- context module output
- logger
- action input schema

Rules:

- `src/core` must not contain Xiaohongshu URLs, CSS selectors, UI labels, or
  date parsing assumptions
- new sites should be added under `src/sites/<site>/`
- generic search flow belongs in `src/core/search`
- site-specific search URL construction and extraction belongs in the site
  adapter
- each action must be understandable in isolation
- actions must not write directly to storage
- actions must not mutate global configuration

### Site Adapter Module

Purpose:

- isolate all site-specific behavior behind explicit contracts
- provide runtime account detection and search extraction for each supported site
- provide site-specific login and verification-state indicators when available

Input:

- page session
- keyword for search adapters
- logger

Output:

- current account result
- raw search result items
- parsed visible publish dates
- session inspection result

Dependencies:

- core page session type
- core adapter contracts
- logger

Rules:

- no site adapter imports another site adapter
- selectors, URLs, visible UI labels, and site-specific time parsing stay here
- login, logout, captcha, verification, and rate-limit text indicators stay here
- adding a site means adding `src/sites/<site>/` and registering it in
  `src/sites/site-registry.ts`

### Background Browser Service

Purpose:

- own the long-lived browser and page session used by the API server
- run one search task at a time on the shared page
- keep the browser open until process shutdown
- run scheduled session inspection when no task is active

Input:

- validated runtime configuration
- task options from the API layer
- selected runtime and search adapters

Output:

- service status
- active and last task snapshots
- session inspection state
- search task results

Rules:

- the service starts the browser once during process startup
- API search tasks reuse the existing page session
- no second search starts while a search or session monitor is using the page
- scheduled monitoring skips while a task is running
- service shutdown closes the persistent context so profile state is flushed

### Session Monitor

Purpose:

- detect whether the visible browser session appears usable
- expose logged-in, logged-out, verification-required, browser-closed, and error
  states

Input:

- page session
- selected runtime site adapter
- visible page URL, title, and body text
- current account action result when safe to query

Output:

- `SessionInspectionResult`
- structured indicators with severity and message

Rules:

- monitoring detects and reports state only
- monitoring must not solve captcha, automate login, or bypass verification
- indicators must be explainable and site-specific
- scheduled monitoring must not run concurrently with search tasks

### Transform Module

Purpose:

- convert raw action output into structured data
- normalize fields and schemas

Input:

- raw action result

Output:

- structured data object

Dependencies:

- type definitions
- schema validation

Rules:

- raw data and structured data must remain separate
- no browser automation code belongs here

### Storage Module

Purpose:

- persist or export structured data

Input:

- structured data
- storage configuration

Output:

- storage result

Dependencies:

- future storage adapter
- logger

Rules:

- not in current phase scope
- storage adapters must be added by composition

Future adapters:

- JSON file
- CSV file
- database
- message queue

### Monitoring Module

Purpose:

- provide structured logs
- later support metrics and error tracking

Input:

- lifecycle events
- action events
- errors

Output:

- structured log records
- future metrics records

Dependencies:

- structured logging library

Rules:

- logs must include module name and lifecycle stage
- secrets, cookies, tokens, and account data must not be logged

### Types Module

Purpose:

- define shared TypeScript contracts
- keep module input and output shapes explicit

Input:

- none at runtime

Output:

- shared type definitions

Dependencies:

- TypeScript

Rules:

- types must describe data contracts, not hide behavior
- avoid large catch-all type files

## Data Flow

Current phase:

```text
Environment variables
        |
        v
Validated runtime and API configuration
        |
        v
Selected site adapter
        |
        v
Background browser service
        |
        v
Visible persistent browser context
        |
        v
Page session
        |
        v
Profile verification action
        |
        v
Raw profile verification result
        |
        v
Open start page result
        |
        v
Session inspection result
        |
        v
HTTP search request
        |
        v
Search workflow result
        |
        v
JSON API response and structured logs
```

Future collection flow:

```text
Task input
        |
        v
Action execution
        |
        v
Browser interaction
        |
        v
Raw data
        |
        v
Transform
        |
        v
Structured data
        |
        v
Storage
        |
        v
Monitoring
```

## Lifecycle Design

System lifecycle:

```text
Initialize
        |
        v
Load configuration
        |
        v
Select site adapter
        |
        v
Load profile
        |
        v
Create visible persistent browser context
        |
        v
Start HTTP API server
        |
        v
Run scheduled session monitor while idle
        |
        v
Execute one API task at a time
        |
        v
Report task result, busy state, or account-attention state
        |
        v
Shutdown service
```

Browser lifecycle:

```text
Create persistent context
        |
        v
Reuse context for API tasks and idle monitoring
        |
        v
Close context on process shutdown
```

Action lifecycle:

```text
Input
        |
        v
Validate
        |
        v
Execute
        |
        v
Collect
        |
        v
Return
```

## Error Handling

Recoverable errors:

- navigation timeout
- transient page load failure
- temporary browser interaction failure

Strategy:

- retry only when a retry policy exists
- log the failed stage and retry count

Non-recoverable errors:

- invalid configuration
- profile path missing
- profile load failure
- Playwright persistent context creation failure

Strategy:

- fail fast
- log structured error details without secrets
- release opened resources

## Key Design Decisions

1. Use a persistent Playwright context instead of creating a fresh browser
   context, because the current phase depends on reusing an existing profile
   and session state.
2. Keep login outside the framework. The caller owns account login, profile
   creation, and session lifecycle.
3. Keep configuration centralized and schema-validated so browser behavior is
   visible from one module.
4. Keep runtime orchestration separate from browser automation so lifecycle
   behavior remains readable.
5. Keep actions independent and composable. New collection tasks should be added
   as new workflows or site adapter methods rather than changing the browser
   layer.
6. Keep raw data separate from transformed data to prevent action modules from
   becoming mixed browser and data-normalization modules.
7. Defer storage, queueing, scheduling, proxy management, metrics, and plugin
   systems until their phases are explicitly requested.
8. Use structured logging from the first implementation phase because profile
   and browser failures need clear operational visibility.
9. Prefer TypeScript for explicit contracts and local understandability.
10. Use pnpm only and keep the project workspace-compatible from the start.
11. Default to the branded Chrome channel for Chrome profile reuse. Use the
    `bundled` channel only for Playwright-managed Chromium profiles.
12. Keep `src/core/` free of site names, URLs, selectors, UI text, and
    site-specific configuration names.
13. Run the browser visibly by default. Manual login and account checks happen
    in the same persistent profile visible through noVNC in Docker.
14. Keep API task concurrency at one active search per browser profile. A
    second search request returns `409 task_busy` instead of queueing.
15. Treat logout, captcha, verification, and risk-control prompts as
    account-attention states. The system reports them and waits for manual
    intervention; it does not bypass them.

## Current Phase Acceptance Criteria

- existing profile path can be loaded from configuration
- persistent browser context can be created
- context availability can be verified
- configured start URL can be opened
- current profile information can be printed
- keyword search can run through the registered Xiaohongshu search adapter
- API service can keep the browser open across requests
- concurrent search requests return busy status
- session monitor can report logged-out or verification-required states
- Docker noVNC deployment can preserve Chrome user data across restarts
- failure modes are reported with structured logs

## Out of Scope For Current Phase

- account login flow
- captcha solving, risk-control bypass, fingerprint spoofing, or stealth patches
- data storage
- proxy management
- distributed runtime
- scheduler or queue
- UI
- platform-specific logic outside `src/sites/<site>/`
- plugin system
