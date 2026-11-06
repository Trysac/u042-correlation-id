# Correlation ids

`@trysac/correlation-id` extracts or creates W3C Trace Context identifiers for
`node:http` servers, keeps them in `AsyncLocalStorage` and builds the headers
for outgoing calls. It has no runtime dependencies and never logs.

## Usage

```ts
import { createServer } from "node:http";
import { createCorrelation, expressMiddleware, fastifyHook } from "@trysac/correlation-id";

const correlation = createCorrelation();

// Plain node:http
createServer((req, res) => {
  correlation.run(req, res, () => {
    res.end(JSON.stringify(correlation.outgoingHeaders()));
  });
});

// Express: app.use(expressMiddleware(correlation));
// Fastify: app.addHook("onRequest", fastifyHook(correlation));
```

Inside the callback, `getCorrelation()` returns a frozen copy of the context
(`traceId`, `spanId`, `parentSpanId`, `requestId`, `sampled`, `tracestate`),
across `await` and timers. Outside `run()` it returns `undefined`.

## Behaviour

- `traceparent` follows W3C Trace Context Level 1, section 3.2: lowercase hex,
  version `ff` invalid, all-zero ids invalid. For versions above `00` the first
  four fields are parsed when the value is 55 characters long or the 56th
  character is `-`.
- Several `traceparent` header values are invalid. For other headers the first
  array element is used.
- A request without a valid `traceparent` starts a new trace that is not
  sampled. Otherwise the incoming parent id becomes `parentSpanId` and a new
  span id is generated.
- `tracestate` is forwarded unchanged only with a valid `traceparent`. It is
  dropped when it has more than 32 members (empty members are ignored), more
  than 512 characters or a control character (U+0000-U+001F, U+007F).
- The request id defaults to the trace id. A valid incoming id (1 to 128
  characters of `A-Za-z0-9._:~+/=-`) is kept unless `trustIncomingRequestId`
  is `false`.
- `run()` sets the request id response header (`x-request-id` by default)
  before calling `next`. It never sets `traceparent` on the response.
- Outgoing headers always use `traceparent` version `00`.
- Invalid incoming headers never throw. They are ignored and reported through
  `onEvent` with a `type` of `invalid_traceparent`, `invalid_request_id` or
  `invalid_tracestate`, never with the header value. When the traceparent is
  invalid only `invalid_traceparent` is reported and the tracestate is dropped.

## Errors

`CorrelationError` has a stable `code`: `invalid_option` for bad options and
`invalid_generator` when a custom id generator returns a malformed id. Messages
are static and never contain input.

## Security notes

- Header injection: no untrusted value reaches a response header unless it
  matched the request id pattern, which excludes CR, LF and spaces.
- Header values longer than 512 characters are never parsed.
- Out of scope: span export, baggage and `traceresponse`.
