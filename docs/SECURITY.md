# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in [../SECURITY.md](../SECURITY.md).

## Threat model

Defended:

- Header injection through request ids: the id must match `^[A-Za-z0-9._:~+/=-]+$`, so CR, LF and spaces never reach a response header. Invalid ids are replaced by the trace id.
- Oversized input: header values over 512 characters are never parsed; request ids are capped at 128 characters.
- Malformed trace context: invalid `traceparent` values are ignored, and `tracestate` is dropped with them.
- `tracestate` abuse: more than 32 members, values over 512 characters and control characters are rejected.
- Leakage through observers: `onEvent` receives only the event type, never a header value.
- Observer failures: exceptions thrown by `onEvent` are swallowed and do not affect request handling.
- Context leakage between requests: AsyncLocalStorage isolates the context per request, and `getCorrelation()` returns a frozen copy.

Not defended:

- Trust in upstream callers: incoming trace ids and request ids are accepted as correlation data, not authenticated. Set `trustIncomingRequestId: false` to avoid echoing incoming request ids.
- Forged trace context: the library cannot tell whether an upstream `traceparent` is genuine. Sampling decisions taken from upstream flags are followed as given.
- Log injection in application code: the library does not sanitise values that the application writes to its own logs.
- Denial of service through request volume: the library does no rate limiting and holds no cross-request state beyond AsyncLocalStorage.
- Custom `idGenerator` quality: the library only checks format and non-zero value; predictability of custom generators is the caller's responsibility.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The package has no runtime dependencies. Development dependencies are limited to the toolchain listed in [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction or shelling out from library code.
- Inputs from callers are validated and rejected with explicit `CorrelationError` codes; request data never throws.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.
