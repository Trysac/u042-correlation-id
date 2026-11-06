# Parse traceparent strictly and keep request context in AsyncLocalStorage

Status: accepted (generated, pending human review)

## Context

Services need one id to join logs across a request. W3C Trace Context standardises propagation, but exact traceparent parsing, future-version handling and header injection through echoed request ids are easy to get wrong. Existing request-id middlewares are Express-specific and predate traceparent.

## Decision

Implement a framework-agnostic core around AsyncLocalStorage (createCorrelation().run) using only node:async_hooks and node:crypto, with thin Express and Fastify adapters over minimal local structural types. traceparent is parsed exactly per Level 1 section 3.2 and 3.2.4, tracestate is validated with explicit limits, and any incoming request id must match a restrictive pattern before being echoed. Invalid request data never throws; it is ignored and reported by type only through onEvent. Only configuration and generator errors throw a typed CorrelationError.

## Consequences

Zero runtime dependencies and no framework coupling; context is available across awaits and timers. Invalid headers are silently replaced, so operators must use onEvent to observe them. New traces default to not sampled, and response headers never include traceparent. Baggage, span export and traceresponse are not supported.
