# Project record: correlation-id

## Objective

Provide framework-agnostic correlation ids for node:http services. The library parses W3C Trace Context `traceparent` headers strictly, validates `tracestate` and request ids, keeps the context in AsyncLocalStorage and builds outgoing propagation headers, so that logs of one request can be joined across services. It is intended for Node.js developers running node:http, Express or Fastify services.

## Scope

In scope:

- The public API documented in the README: `createCorrelation`, `parseTraceparent`, `formatTraceparent`, `expressMiddleware`, `fastifyHook` and `CorrelationError`.
- W3C Trace Context Level 1 parsing and version 00 formatting, including the future-version rule of section 3.2.4.
- Sanitising of incoming request ids and tracestate values.

Out of scope:

- Span export, baggage and the `traceresponse` header.
- Logging. The library never logs.
- Echoing the `traceparent` header on responses.
- Runtime dependencies beyond `node:async_hooks` and `node:crypto`.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Figures are recorded by the factory ledger and time log. Until then the values remain as shown below.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | pending measurement | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | pending measurement | factory ledger |
