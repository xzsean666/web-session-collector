# Playwright Data Collection Framework Architecture

## Current Step

Step 1: Architecture Design.

This document defines the architecture, module responsibilities, data flow, and
key design decisions for the current project phase. It intentionally contains no
implementation code.

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
Runtime Layer
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
        v
Storage Layer
        |
        v
Monitoring Layer
```

Current phase scope:

```text
Load configuration
        |
        v
Load existing Chrome profile
        |
        v
Create persistent browser context
        |
        v
Verify context availability
        |
        v
Open configured start URL
        |
        v
Print current profile information
        |
        v
Run adapter search workflow
        |
        v
Keep browser alive
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

Future site actions:

- search
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

Input:

- page session
- keyword for search adapters
- logger

Output:

- current account result
- raw search result items
- parsed visible publish dates

Dependencies:

- core page session type
- core adapter contracts
- logger

Rules:

- no site adapter imports another site adapter
- selectors, URLs, visible UI labels, and site-specific time parsing stay here
- adding a site means adding `src/sites/<site>/` and registering it in
  `src/sites/site-registry.ts`

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
Validated runtime configuration
        |
        v
Selected site adapter
        |
        v
Persistent browser context
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
Current account result
        |
        v
Search workflow result
        |
        v
Structured log output
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
Create browser context
        |
        v
Execute action
        |
        v
Report result
        |
        v
Keep alive or shutdown
```

Browser lifecycle:

```text
Create persistent context
        |
        v
Reuse context for actions
        |
        v
Close context
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
12. Keep `src/core/` free of site names, URLs, selectors, UI text, and legacy
    compatibility environment names.

## Current Phase Acceptance Criteria

- existing profile path can be loaded from configuration
- persistent browser context can be created
- context availability can be verified
- configured start URL can be opened
- current profile information can be printed
- keyword search can run through the registered Xiaohongshu search adapter
- browser can remain open for manual inspection
- failure modes are reported with structured logs

## Out of Scope For Current Phase

- account login flow
- data storage
- proxy management
- distributed runtime
- scheduler or queue
- UI
- platform-specific logic outside `src/sites/<site>/`
- plugin system
