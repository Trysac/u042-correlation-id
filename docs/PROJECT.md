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
| Tokens (input / output) | 255503 / 59561 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.4407 | factory ledger |

## Factory run u042 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2759 | 45747 | 0 | 4473 | 0.2319 |
| fix-1 | claude-sonnet-5-5 | no | 8 | 3300 | 15360 | 66949 | 0.0781 |
| fix-2 | claude-sonnet-5-5 | no | 6 | 1877 | 11202 | 46403 | 0.0514 |
| fix-3 | claude-sonnet-5-5 | no | 6 | 691 | 9643 | 46054 | 0.0356 |
| fix-4 | claude-sonnet-5-5 | no | 8 | 695 | 9643 | 65034 | 0.0376 |
| docs | claude-haiku-5-5 | no | 23803 | 7251 | 0 | 0 | 0.0060 |

Total: $0.4407. Prices: Anthropic list prices.
