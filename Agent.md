# AI Agent Operating Guide

This file defines the operating rules for AI agents working on this repository.
All supporting project documents must live under `docs/`.

## Project

Web Session Collector is a Node.js and Playwright browser automation framework.
The reusable runtime lives in `src/core/`; Xiaohongshu behavior lives in
`src/sites/xiaohongshu/` behind site adapters.

The current phase includes framework initialization and a keyword search MVP:

- load an existing Chrome profile
- create a persistent browser context
- verify the context is usable
- print the active profile information
- run site-adapter keyword search
- keep the browser alive for manual verification when configured

The framework does not implement account login, distributed scheduling, storage,
proxy management, UI, or direct API integration in the current phase.

## Execution Protocol

Agents must follow these steps in order.

### Step 1: Architecture Design

Required before any implementation.
Produce:

- overall system architecture
- module breakdown and responsibilities
- data flow
- key design decisions

Do not write implementation code during this step.

Primary document:

- `docs/ARCHITECTURE.md`

### Step 2: Documentation

Produce:

- `docs/SPEC.md`
- `docs/BUILD.md`
- `docs/INTEGRATION_DOCS.md`
- any reusable operation guide under `docs/`

Do not write implementation code during this step.

### Step 3: Context Handoff

Produce:

- `docs/nextsession.md`

The handoff must include:

- current progress
- architecture summary
- completed parts
- pending tasks
- next actions
- risks and unknowns

### Step 4: Implementation

Only write code after explicit user approval for implementation.

Implementation must follow the architecture and documentation already written.
If implementation reveals that the architecture is wrong or too complex, stop
and update the architecture before continuing.

## Git Workflow

After each major step:

```text
git add .
git commit -m "feat: <describe current step>"
```

Do not push unless explicitly requested.

## Architecture Principles

- Optimize for AI comprehension over cleverness.
- Split modules by cognitive responsibility, not by line count.
- Keep every module understandable in isolation.
- Use explicit names that document intent.
- Avoid hidden state, hidden configuration, and implicit side effects.
- Prefer composition over inheritance.
- Keep control flow simple and predictable.
- Add abstractions only when they reduce real complexity.
- Keep configuration centralized and schema-validated.
- Keep raw collected data separate from transformed structured data.

## Required Module Boundaries

The planned source tree must keep these responsibilities separate:

- `src/core/config/`: reusable `APP_*` environment parsing and validation
- `src/config/`: project runtime defaults layered over core configuration
- `src/runtime/`: boot, run, shutdown lifecycle orchestration
- `src/core/browser/`: Playwright browser and persistent context creation
- `src/core/context/`: page/session abstractions created from the browser context
- `src/core/actions/`: generic browser actions such as profile verification
- `src/core/search/`: reusable search workflow and search adapter contracts
- `src/sites/<site>/`: site URLs, selectors, account detection, and date parsing
- `src/transform/`: raw-to-structured data conversion
- `src/storage/`: output adapters, added only when storage is in scope
- `src/core/monitoring/`: logging, metrics, and error reporting
- `src/core/types/`: reusable TypeScript contracts
- `src/types/`: project-level result contracts
- `src/scripts/`: operational scripts that do not belong in application modules

Core code must not contain Xiaohongshu URLs, selectors, UI labels, or
site-specific configuration names. Add or change site behavior through
`src/sites/<site>/` and `src/sites/site-registry.ts`.

## Dependency Policy

- Use `pnpm` only. Do not mix `npm` or `yarn` commands into project workflow.
- Prefer official documentation when researching dependencies.
- When external systems or dependency docs are needed, record the latest docs
  URLs in `docs/INTEGRATION_DOCS.md`.
- Do not scatter configuration across modules.
- Do not introduce storage, queue, scheduler, monitoring backends, or plugins
  until the corresponding phase is explicitly requested.

## Self-Correction Rule

Stop and revise the design if any of the following appear:

- implementation starts before approval
- browser, business, transform, and storage logic are mixed together
- a module becomes hard to understand without reading many other files
- naming becomes abbreviated or ambiguous
- configuration or state becomes implicit
- complexity increases without a clear current-phase need
