# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suite in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Test files

- `test/index.test.ts` is the only test file. It imports the public entry point `../src/index.js` and covers:
  - `parseTraceparent`: W3C examples, invalid headers (uppercase, zero ids, bad separators, wrong lengths, `ff` version), future-version handling and the 512-character limit.
  - `formatTraceparent`: version 00 output and rejection of malformed ids.
  - Context creation: continuation of incoming traces, new traces, sampled flag, default random ids, invalid traceparent events without header values, frozen context copies.
  - `tracestate`: forwarding, array handling, member and length limits, control characters.
  - Request id: valid and invalid ids, CR/LF injection, `trustIncomingRequestId: false`, custom header.
  - Async context: `await` and `setTimeout`, and 50 interleaved concurrent requests over node:http on port 0.
  - Adapters: `expressMiddleware` and `fastifyHook` with structural fakes and over node:http.
  - Errors and options: `invalid_option`, `invalid_generator`, message content and ignored `onEvent` errors.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Rules

- Coverage thresholds are set in `vitest.config.ts`. Lowering them is not allowed.
- Tests run through the public entry point and assert observable behavior: return values, thrown errors, messages and emitted events.
- Each bug fix adds a test that fails without the fix.
- Tests use no external network. Concurrency tests use a local server on an ephemeral port.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
