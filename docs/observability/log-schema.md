# Server log schema (C17, C18)

The server logs structured JSON lines via Fastify's built-in pino integration
(`fastify` bundles `pino` — no separate dependency), configured from
`serverEnvSchema.LOG_LEVEL` (`@irlo/contracts`, see `server/src/config.ts`).
`server/src/app.ts`'s `buildApp()` wires the level and requires an explicit
`loggerStream` destination — tests pass an in-memory stream to capture lines
instead of writing to stdout (`server/test/support/memory-log-stream.ts`); a
future server-bootstrap entrypoint passes `process.stdout`.

## Base fields (every line)

| Field | Type | Meaning |
|---|---|---|
| `level` | number | pino numeric level (`debug`=20, `info`=30, `warn`=40, `error`=50, `fatal`=60) |
| `time` | number | epoch ms |
| `pid` | number | process id |
| `hostname` | string | process host |
| `msg` | string | human-readable summary |

## Request-lifecycle fields (added by Fastify per request)

| Field | Type | Meaning |
|---|---|---|
| `reqId` | string | per-request id, Fastify's own monotonically-increasing default (`req-1`, `req-2`, ...) — scoped to a single process, not a distributed trace |
| `req` | object | method, url, version, host, remoteAddress, remotePort (on the "incoming request" line) |
| `res` | object | statusCode (on the "request completed" line) |
| `responseTime` | number | ms, on the "request completed" line |

## Trace-context fields (C18, when `buildApp`'s `tracing` option is set)

| Field | Type | Meaning |
|---|---|---|
| `traceId` | string | OpenTelemetry trace id for the request's span, on the "request completed" line onward |
| `spanId` | string | OpenTelemetry span id for the per-request span |

`server/src/observability/tracing.ts`'s `startTracing` bootstraps the
`NodeTracerProvider`; `buildApp` starts a span per request in an `onRequest`
hook and reassigns both `request.log` and `reply.log` to a child logger
carrying `traceId`/`spanId` — Fastify's own "request completed" line reads
`reply.log`, a separate snapshot taken at `Reply` construction, not
`request.log`. Absent by default: existing callers that don't pass a
`tracing` option see no trace-context fields, matching the "Not yet present"
behavior this schema previously documented.
