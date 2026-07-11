# Server log schema (C17)

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
| `reqId` | string | per-request id, Fastify's own monotonically-increasing default (`req-1`, `req-2`, ...) — not yet a distributed trace id |
| `req` | object | method, url, version, host, remoteAddress, remotePort (on the "incoming request" line) |
| `res` | object | statusCode (on the "request completed" line) |
| `responseTime` | number | ms, on the "request completed" line |

## Not yet present

`traceId` / `spanId` (OpenTelemetry trace context) arrive with C18 — this
schema covers pino only. Until then, `reqId` is the sole correlation key and
is scoped to a single process, not a distributed trace.
