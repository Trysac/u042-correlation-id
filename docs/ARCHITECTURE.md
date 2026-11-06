# Architecture

## Overview

`@trysac/correlation-id` is a small, dependency-free TypeScript library published to npm as ES modules with type declarations. It extracts or creates W3C Trace Context identifiers, keeps them in AsyncLocalStorage and builds outgoing propagation headers for node:http servers, with thin Express and Fastify adapters.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Everything consumers import is exported from here: parsing and formatting of `traceparent`, header validation, id generation, the correlation handle, the adapters and `CorrelationError`. |

The library has a single module. Internal helpers are not re-exported.

## Boundaries

- No runtime dependencies. Only `node:async_hooks` and `node:crypto` are used.
- The library never logs. Observers receive event types through `onEvent` and never header values.
- No I/O at import time. Request handling never throws for invalid request data; invalid headers are ignored.
- Errors are thrown as `CorrelationError` with a stable `code` (`invalid_option`, `invalid_generator`) and static messages.

## Request flow

1. `run(req, res, next)` builds a frozen `CorrelationContext` from the headers.
2. The request id response header is set with `res.setHeader` before `next` runs.
3. `next` runs inside `AsyncLocalStorage.run`, so `getCorrelation()` and `outgoingHeaders()` see the context across awaits and timers.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).
