# Playwright Data Collection Framework Architecture

## Current Step

Step 6: Multi web-session API service.

This document defines the architecture, module responsibilities, data flow, and
key design decisions for the current project phase.

## Overall System Architecture

The framework is organized around a reusable Playwright core, a web-session
manager, and thin site adapters. Configuration is loaded first, the API process
starts a session manager, the manager owns one or more web sessions, API tasks
default to the API-active web session, active noVNC shows the API-active
session for observation, idle noVNC shows an independently selected login target
session, generic workflows operate on the selected page session, and site
adapters provide URLs, selectors, account parsing, session inspection, and
visible date parsing.

A web session is a first-class runtime record with a stable `id`. Each web
session owns its browser resources, page session, status, last inspection
result, and task snapshots. The HTTP API can create sessions, delete sessions,
list sessions, switch the API-active session, switch the idle noVNC login
target, and update a session state. Search and session-check APIs default to the
API-active session unless a route explicitly targets another session. Manual
login and verification through idle noVNC apply to the idle login target, which
can be different from the API-active session.

```text
Configuration Layer
        |
        v
API / Runtime Layer
        |
        v
Web Session Manager
        |
        +--> API-Active Web Session --> Session Task Service
        |                              |
        |                              +--> ACTIVE_NOVNC_PORT
        |
        +--> Idle noVNC Login Target --> IDLE_NOVNC_PORT
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
Start web-session manager
        |
        v
Create or restore web sessions
        |
        v
Select API-active session
        |
        v
Expose API-active session through active noVNC
        |
        v
Select idle noVNC login target session
        |
        v
Bind idle noVNC desktop to login target session
        |
        v
Open configured start URL for managed sessions
        |
        v
Inspect session login / verification state
        |
        v
Wait for API requests
        |
        v
Manage session lifecycle, target pointers, and session state by API
        |
        v
Run session-scoped search or session-check tasks
        |
        v
Return result, busy status, not-found status, or account-attention status
        |
        v
Keep managed sessions open until deletion or service shutdown
```

Docker deployment scope:

```text
Docker container
        |
        v
Xvfb desktop + fluxbox
        |
        v
Visible Chrome for active and idle noVNC targets
        |
        v
active noVNC mirrors the API-active session
        |
        v
idle noVNC mirrors the login target session
        |
        v
HTTP API service
        |
        v
Caller manages API-active and idle noVNC login target sessions
```

### Session Target Model

The session manager owns two independent target pointers and exposes two named
noVNC ports:

- `apiActiveSessionId`: default target for API task routes such as search and
  session check; also mirrored by active noVNC on `ACTIVE_NOVNC_PORT`.
- `idleNovncSessionId`: target browser/page shown through idle noVNC on
  `IDLE_NOVNC_PORT` for manual login, captcha handling, and account
  verification.

Changing one pointer must not implicitly change the other. They may point to the
same session, but that is an explicit state, not an architectural requirement.
This lets operators keep idle noVNC on a session that needs login while the API
keeps using a different already-ready session.

API responses that expose session manager status should include both ids so a
caller can tell which session is being used for automation and which session is
currently visible for manual login.

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
    session/
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

Core modules contain reusable browser lifecycle, page lifecycle, web-session
state, config, logging, and search workflow logic. Site modules contain URLs,
selectors, site-specific authentication, site-specific notices, and visible date
parsing. `src/core/` must remain reusable for other browser automation
projects.

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
- expose web-session lifecycle operations
- keep the web-session manager alive for the process lifetime
- route task requests to the API-active or explicitly targeted web session
- route idle noVNC to an independently selected login target session
- return explicit busy, not-found, inactive, or account-attention responses
  instead of queueing unbounded work

Input:

- HTTP requests
- validated API configuration
- web-session ids
- requested session state updates
- web-session manager status

Output:

- JSON API responses
- web-session list payloads
- API-active web-session payloads
- idle noVNC login target payloads
- task result payloads
- session status payloads

Dependencies:

- Node HTTP server
- API configuration
- web-session manager
- logger

Rules:

- API routes must not create browser contexts directly
- API routes must call the web-session manager for create, delete, list,
  API activation, idle noVNC target switching, state-update, and task-dispatch
  operations
- every session operation must validate the requested `sessionId`
- the API-active session is the default target for task routes
- active noVNC follows the API-active session for observation
- the idle noVNC login target is the only session that operator login actions
  should affect
- switching the API-active session must not change the idle noVNC login target
  unless the request explicitly asks for both changes
- switching the idle noVNC login target must not change the API-active session
  unless the request explicitly asks for both changes
- deleting the API-active session must either select another API-active session
  explicitly or leave the service with no API-active session; the API response
  must report the resulting API-active session
- deleting the idle noVNC login target must either select another idle noVNC
  target explicitly or leave idle noVNC with no target; the API response must
  report the resulting idle noVNC target
- when a task is running in the target session, another task for that session
  returns `409`
- when the target session monitor reports logged out or verification required,
  search requests return an account-attention response for that session
- API output must not expose cookies, tokens, local storage, or raw browser
  session data

Current session API surface:

```text
GET    /api/sessions
POST   /api/sessions
DELETE /api/sessions/:sessionId
POST   /api/sessions/:sessionId/activate
POST   /api/sessions/:sessionId/idle-novnc
PATCH  /api/sessions/:sessionId/state
```

`POST /api/sessions/:sessionId/activate` sets `apiActiveSessionId`.
`POST /api/sessions/:sessionId/idle-novnc` sets `idleNovncSessionId` and makes
idle noVNC show that session for manual login.

Existing task routes continue to work against the API-active session unless an
explicit session-scoped variant is added:

```text
GET  /api/status
POST /api/session/check
POST /api/xiaohongshu/search
```

### Web Session Manager

Purpose:

- own the registry of all web sessions in the process
- create web sessions with stable ids
- delete web sessions and release their browser resources
- list all known web sessions
- track and switch the API-active session
- track and switch the idle noVNC login target session
- store API-controlled session state updates
- provide the API-active session used by default task routes
- provide the idle noVNC login target used for manual login and verification

Input:

- validated runtime configuration template
- selected runtime and search adapters
- create-session request
- delete-session request
- API-activation request
- idle-noVNC-target request
- state-update request
- scheduled monitor events and task events

Output:

- web-session registry snapshot
- API-active session id
- idle noVNC login target session id
- session status snapshots
- selected page session for task execution
- lifecycle events for noVNC binding

Dependencies:

- browser module
- context module
- session monitor
- session task service
- logger

Rules:

- every web session has one stable `id`; ids are unique for the service
  lifetime
- every API response that returns a session must include the session `id`
- the manager owns session creation, deletion, API activation, idle noVNC target
  switching, and state mutation
- a session record must include at least `id`, `state`, `isApiActive`,
  `isIdleNovncTarget`, browser/page readiness, active task snapshot, last task
  snapshot, last inspection snapshot, and timestamps
- each web session must use an isolated persistent profile directory unless an
  explicit configuration says otherwise
- the same profile directory must not be used by two live web sessions
- deleting a session closes its page session and persistent browser context
  before removing it from the registry
- persistent profile data deletion is an explicit policy; removing a runtime
  session must not silently erase profile data unless requested by a delete
  option
- switching the API-active session is serialized with task dispatch for default
  task routes; active noVNC follows the new API-active session
- switching the idle noVNC login target is serialized with visible-page
  operations, but it must not change the API-active session by itself
- idle noVNC always reflects `idleNovncSessionId`; after a successful idle
  noVNC target switch, manual login and verification through idle noVNC apply
  to that target session
- when there is no API-active session, default task routes must return a clear
  inactive-session response
- when no target is selected for idle noVNC, idle noVNC may show an empty
  desktop or a closed browser state, but explicit session-scoped API tasks can
  still run

Session state model:

```text
WebSessionManagerState
  apiActiveSessionId
  idleNovncSessionId
  sessions[]

WebSessionRecord
  id
  state
  isApiActive
  isIdleNovncTarget
  createdAt
  updatedAt
  stateUpdatedAt
  stateUpdatedBy
  browser
  page
  activeTask
  lastTask
  lastInspection
```

`state` is the public session state exposed through the API. It can be updated
by the session monitor, by task lifecycle transitions, or by an explicit API
state update. API-controlled updates must record their source and timestamp so
operators can distinguish manual state changes from inspected account state.

### Runtime Module

Purpose:

- orchestrate boot, run, and shutdown
- own top-level error handling
- ensure resources are released
- start and stop the web-session manager

Input:

- validated runtime configuration
- selected runtime site adapter

Output:

- lifecycle result
- process exit status

Dependencies:

- configuration module
- web-session manager
- browser module
- monitoring module
- action module
- site registry

Rules:

- runtime coordinates modules but does not contain browser automation details
- runtime depends on the `RuntimeSiteAdapter` contract, not on a concrete site
- runtime does not transform or persist business data
- runtime does not directly select pages for API tasks; that belongs to the
  web-session manager

### Browser Module

Purpose:

- create and close Playwright persistent browser context
- connect to an existing Chrome over CDP when configured
- load the configured Chrome user data directory
- apply browser channel, executable path, profile directory, launch options, and
  flags
- provide browser resources for one web session at a time

Input:

- browser-related runtime configuration
- session-specific profile configuration

Output:

- Playwright persistent browser context
- browser metadata for the owning web session

Dependencies:

- Playwright
- browser configuration
- logger

Rules:

- no business logic
- no storage logic
- profile path handling must be explicit
- same profile directory must not be used by multiple browser instances
- each live web session must have an isolated browser context/profile
- connect mode must disconnect from Chrome without closing the user's browser
- launch mode defaults to a visible browser, not headless
- do not add fingerprint spoofing or verification-bypass launch behavior

### Context Module

Purpose:

- provide page and session abstractions over the persistent browser context
- keep page lifecycle behavior explicit
- expose only the browser state needed by actions
- attach page sessions to a specific web-session id

Input:

- persistent browser context
- web-session id

Output:

- page session object
- context metadata

Dependencies:

- browser module output
- logger

Rules:

- actions should not create browser contexts directly
- page creation and cleanup must be visible
- page-session logs and errors must include the owning web-session id when
  available

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

### Session Task Service

Purpose:

- run task workflows for one web session
- serialize search and session-check tasks within the target session
- keep task state scoped to the owning web-session id
- run scheduled session inspection when the target session has no active task

Input:

- validated runtime configuration
- task options from the API layer
- selected runtime and search adapters
- target web-session record

Output:

- service status
- active and last task snapshots
- session inspection state
- search task results

Rules:

- a task service operates on one web session at a time
- API search tasks reuse the target web session's existing page session
- no second task starts in the same web session while a search or session
  monitor is using that page
- scheduled monitoring skips while the same session has an active task
- one session being busy must not make unrelated idle sessions look busy
- session deletion cancels or rejects new work, waits for in-flight cleanup when
  possible, then closes browser resources
- service shutdown closes every managed persistent context so profile state is
  flushed

### Session Monitor

Purpose:

- detect whether a web session appears usable
- expose logged-in, logged-out, verification-required, browser-closed, and error
  states
- update the target web session's inspection snapshot

Input:

- page session
- web-session id
- selected runtime site adapter
- visible page URL, title, and body text
- current account action result when safe to query

Output:

- `SessionInspectionResult`
- structured indicators with severity and message
- session state update event

Rules:

- monitoring detects and reports state only
- monitoring must not solve captcha, automate login, or bypass verification
- indicators must be explainable and site-specific
- scheduled monitoring must not run concurrently with tasks in the same session
- monitor results update `lastInspection` for the target session
- monitor-driven state updates must not erase the audit fields from an explicit
  API state update; the session record must keep enough timestamps/source fields
  to explain the latest state transition

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
Web-session manager
        |
        v
Session registry
        |
        v
API-active session id
        |
        v
idle noVNC login target session id
        |
        v
HTTP session request
        |
        v
Create / delete / list / activate API target / switch idle noVNC target
        |
        v
Update explicit session state when requested
        |
        v
Session registry snapshot
        |
        v
JSON API response and structured logs
```

Session-scoped task flow:

```text
HTTP task request
        |
        v
Resolve target session id
        |
        v
Load target WebSessionRecord
        |
        v
Target persistent browser context
        |
        v
Target page session
        |
        v
Profile verification or start-page navigation when needed
        |
        v
Session inspection result
        |
        v
Search workflow result
        |
        v
Update target session activeTask / lastTask / state
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
Start web-session manager
        |
        v
Create or restore initial web session
        |
        v
Set API-active session
        |
        v
Set idle noVNC login target session
        |
        v
Bind idle noVNC to login target session
        |
        v
Start HTTP API server
        |
        v
Accept session management and task requests
        |
        v
Run scheduled session monitors while sessions are idle
        |
        v
Execute one task at a time per target session
        |
        v
Report task result, busy state, not-found state, or account-attention state
        |
        v
Shutdown service
```

Web-session lifecycle:

```text
Create session request
        |
        v
Allocate session id
        |
        v
Create isolated persistent profile/context
        |
        v
Create page session
        |
        v
Open start URL and inspect state
        |
        v
Use session for API tasks when API-active
        |
        v
Use session for manual login when selected as idle noVNC target
        |
        v
Switch API-active or idle noVNC target pointers when requested
        |
        v
Close page/context on delete or process shutdown
```

API-active session switch lifecycle:

```text
Switch request with session id
        |
        v
Validate target session exists
        |
        v
Serialize with default task dispatch
        |
        v
Set apiActiveSessionId
        |
        v
Leave idleNovncSessionId unchanged unless explicitly requested
        |
        v
Return API-active session snapshot and manager targets
```

idle noVNC login target switch lifecycle:

```text
idle noVNC target request with session id
        |
        v
Validate target session exists
        |
        v
Serialize with visible-page operations
        |
        v
Set idleNovncSessionId
        |
        v
Bring target browser/page to the idle noVNC-visible desktop
        |
        v
Leave apiActiveSessionId unchanged unless explicitly requested
        |
        v
Return idle noVNC target snapshot and manager targets
```

Browser lifecycle:

```text
Create persistent context for a web session
        |
        v
Reuse context for that session's tasks and idle monitoring
        |
        v
Close context on session delete or process shutdown
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
- requested session id not found
- no API-active session selected
- no login target selected for noVNC
- target session is busy
- target session is not ready for task execution

Strategy:

- retry only when a retry policy exists
- log the failed stage and retry count
- return explicit HTTP error payloads for API-level session errors
- include `sessionId` in structured logs when the error is session-scoped

Non-recoverable errors:

- invalid configuration
- profile path missing
- profile load failure
- Playwright persistent context creation failure
- duplicate live profile directory assigned to multiple sessions

Strategy:

- fail fast
- log structured error details without secrets
- release opened resources
- mark the affected session as failed when the process can continue safely

## Key Design Decisions

1. Treat web sessions as first-class runtime resources. A session is addressed
   by `id`, not by an implicit global page.
2. Keep two independent session pointers: `apiActiveSessionId` for default API
   tasks and active noVNC on `ACTIVE_NOVNC_PORT`, plus `idleNovncSessionId` for
   idle noVNC on `IDLE_NOVNC_PORT`.
3. Use one isolated persistent Playwright context/profile per live web session
   so account state, cookies, and local storage do not bleed across sessions.
4. Keep login outside the framework. The caller operates login and manual
   verification through idle noVNC after switching the idle noVNC login target
   to the intended session.
5. Let the API manage session lifecycle: create, delete, list, activate the API
   session, switch idle noVNC login target, and update session state.
6. Keep API state updates auditable. A state set by API must record source and
   timestamp separately from monitor inspection details.
7. Keep configuration centralized and schema-validated so browser behavior is
   visible from one module.
8. Keep runtime orchestration separate from browser automation so lifecycle
   behavior remains readable.
9. Keep actions independent and composable. New collection tasks should be added
   as new workflows or site adapter methods rather than changing the browser
   layer.
10. Keep raw data separate from transformed data to prevent action modules from
    becoming mixed browser and data-normalization modules.
11. Defer storage, distributed scheduling, proxy management, metrics, and plugin
    systems until their phases are explicitly requested.
12. Use structured logging from the first implementation phase because profile,
    session, and browser failures need clear operational visibility.
13. Prefer TypeScript for explicit contracts and local understandability.
14. Use pnpm only and keep the project workspace-compatible from the start.
15. Default to the branded Chrome channel for Chrome profile reuse. Use the
    `bundled` channel only for Playwright-managed Chromium profiles.
16. Keep `src/core/` free of site names, URLs, selectors, UI text, and
    site-specific configuration names.
17. Run the idle noVNC login target browser visibly by default. Manual login
    and account checks happen in the persistent profile selected by
    `idleNovncSessionId` in Docker.
18. Keep task concurrency serialized per web session. A second task for the same
    session returns `409 task_busy` instead of queueing; unrelated idle sessions
    can remain available.
19. Serialize API-active switching with default task dispatch, and serialize
    idle noVNC target switching with operations that depend on the visible page.
20. Treat logout, captcha, verification, and risk-control prompts as
    account-attention states. The system reports them and waits for manual
    intervention; it does not bypass them.

## Current Phase Acceptance Criteria

- session manager can create more than one web session
- every web session has a stable id returned by the API
- API can list all web sessions
- API can delete a web session and release its browser resources
- API can switch the API-active web session by id
- API-active switching does not implicitly change the idle noVNC login target
- API can switch the idle noVNC login target session by id
- active noVNC mirrors the API-active session
- idle noVNC shows the idle login target session after a successful target
  switch
- idle noVNC target switching does not implicitly change the API-active session
- API can update a web session state and return the updated snapshot
- existing or session-specific profile paths can be loaded from configuration
- persistent browser contexts can be created per web session
- context availability can be verified
- configured start URL can be opened
- current profile information can be printed
- keyword search can run through the registered Xiaohongshu search adapter
- API service can keep managed sessions open across requests
- concurrent task requests for the same session return busy status
- session monitor can report logged-out or verification-required states per
  session
- Docker noVNC deployment can preserve Chrome user data across restarts
- failure modes are reported with structured logs

## Out of Scope For Current Phase

- account login flow
- captcha solving, risk-control bypass, fingerprint spoofing, or stealth patches
- data storage
- proxy management
- distributed runtime
- scheduler or queue
- web UI beyond noVNC
- cross-process session migration
- platform-specific logic outside `src/sites/<site>/`
- plugin system
