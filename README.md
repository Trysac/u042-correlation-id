# correlation-id

[![npm version](https://img.shields.io/npm/v/@trysac/correlation-id.svg)](https://www.npmjs.com/package/@trysac/correlation-id)
[![license: MIT](https://img.shields.io/npm/l/@trysac/correlation-id.svg)](LICENSE)
[![CI](https://github.com/Trysac/u042-correlation-id/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u042-correlation-id/actions/workflows/ci.yml)

Framework-agnostic correlation id middleware for node:http with W3C Trace Context traceparent parsing, AsyncLocalStorage context and Express and Fastify adapters.

## Problem

Logs from one request across services cannot be joined when every service invents its own request id header. W3C Trace Context standardises propagation, but parsing `traceparent` exactly, handling future versions and keeping the ids available across awaits is error-prone, and echoing untrusted ids invites header injection. This package extracts or creates the ids, stores them in AsyncLocalStorage and builds outgoing headers. Developers running node:http services with or without Express or Fastify are the intended users.

## Install

```sh
npm install @trysac/correlation-id
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies.

## Usage

```ts
import { createServer } from "node:http";
import { createCorrelation } from "@trysac/correlation-id";

const correlation = createCorrelation();
createServer((req, res) => {
  correlation.run(req, res, () => {
    res.end(JSON.stringify(correlation.outgoingHeaders()));
  });
}).listen(3000);
```

## API

| Export | Signature | Description |
|---|---|---|
| `createCorrelation` | `(options?: CorrelationOptions) => Correlation` | Creates a handle with `run`, `getCorrelation` and `outgoingHeaders`. Throws `CorrelationError` (`invalid_option`) for bad options. |
| `Correlation.run` | `<T>(req, res, next: () => T) => T` | Builds the context, sets the `x-request-id` response header and runs `next` inside the AsyncLocalStorage scope. Throws `invalid_generator` if a generator returns a malformed id. |
| `Correlation.getCorrelation` | `() => CorrelationContext \| undefined` | Frozen copy of the current context; undefined outside `run()`. |
| `Correlation.outgoingHeaders` | `() => Record<string, string>` | `traceparent` (version 00), the request id header and `tracestate` when present; empty outside `run()`. |
| `parseTraceparent` | `(value: string \| undefined) => Traceparent \| null` | Strict W3C Level 1 parser, including the future-version rule. |
| `formatTraceparent` | `(ctx) => string` | Formats a version 00 `traceparent`. Throws `invalid_option` for malformed ids. |
| `expressMiddleware` | `(c: Correlation) => ExpressMiddleware` | Express-compatible middleware. |
| `fastifyHook` | `(c: Correlation) => FastifyHook` | Register with `addHook("onRequest", hook)`. |
| `CorrelationError` | `class extends Error` | Field `code`: `"invalid_option"` or `"invalid_generator"`. Messages are static and never echo input. |

Options of `createCorrelation`:

- `requestIdHeader`: lowercase header token, default `x-request-id`. `traceparent` and `tracestate` are rejected.
- `trustIncomingRequestId`: default `true`. When `false`, incoming request ids are never echoed.
- `idGenerator`: `{ traceId(), spanId() }`, default uses `node:crypto` random bytes and regenerates all-zero ids.
- `onEvent`: receives `{ type }` where type is `invalid_traceparent`, `invalid_request_id` or `invalid_tracestate`. It never receives header values, and errors thrown by it are ignored.

Limits:

- Header values longer than 512 characters are never parsed.
- Request ids are at most 128 characters from `A-Za-z0-9._:~+/=-`.
- `tracestate` is limited to 32 list members and must contain no control characters.
- A new trace without a valid incoming `traceparent` is not sampled.
- Array values use the first element, except `traceparent`, where more than one value is invalid.
- Span export, baggage and `traceresponse` are not provided.

## Why not cls-rtracer or express-request-id

`cls-rtracer` and `express-request-id` are Express-specific and predate the W3C `traceparent` header. This package works with plain node:http, provides the Fastify hook and validates incoming values.

## Security

The threat model and its limits are described in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
