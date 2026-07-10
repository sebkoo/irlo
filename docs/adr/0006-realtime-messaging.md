# 0006 — Realtime messaging

- Status: accepted
- Date: 2026-07-10
- Deciders: Ben Koo

## Context and problem statement

US-06 requires realtime group chat per crew/activity: message fan-out to a room, presence,
typing indicators, an offline send queue, and backlog sync after reconnect (paired with the
CoreData client cache in [ADR-0008](0008-ios-demo-client.md), US-12). US-13 deep-links a push
notification into a chat room. Nothing here is built today — this ADR records the planned design.
The question: which realtime transport and topology, and what delivery semantics do we promise?

## Decision drivers

- **D1 — JD evidence**: this repo exists to demonstrate designing and scaling realtime backend
  systems; the gateway itself is the exhibit.
- **D2 — Control over semantics**: ordering, dedupe, backlog, and room authorization must be
  ours to define, test, and defend in a design interview.
- **D3 — Protocol fit**: chat is bidirectional and chatty (typing indicators are client→server);
  the transport must be full-duplex and low-latency.
- **D4 — Operational cost at demo scale**: one region, small nodes, near-zero idle cost.
- **D5 — Credible scale path**: staged evolution with explicit triggers, not hand-waving.
- **D6 — Stack fit**: reuse Fastify, Redis, Postgres, and zod contracts per [ADR-0003](0003-backend-platform.md).

## Considered options

1. **Self-built WebSocket gateway on Fastify** (`@fastify/websocket`, `ws` underneath) — chosen
2. Socket.IO
3. Server-Sent Events (SSE) + HTTP POST for sends
4. HTTP long-polling
5. Managed realtime service (Pusher, Ably)

## Decision outcome

**A self-built WebSocket gateway running as a Fastify plugin**, sharing auth, pino logging,
OpenTelemetry, and zod-validated message envelopes (`@irlo/contracts`) with the HTTP API.
All of the following is planned (Stage 1+):

- **Rooms**: one room per crew/activity chat. Join is authorized against admission and
  entitlement state ([ADR-0005](0005-member-experience-core.md)) at upgrade time and on rejoin.
- **Fan-out**: write-then-publish. A message is persisted to Postgres first, assigned a
  server-side ID plus a per-room monotonic sequence number, then fanned out to room sockets.
- **Presence**: Redis keys with TTL heartbeats (`presence:{room}:{user}`), refreshed by pings;
  key expiry doubles as crash-safe disconnect detection.
- **Typing indicators**: ephemeral events — throttled per user, never persisted, first to be
  dropped under pressure.
- **Offline queue + backlog sync**: clients queue outbound sends with a client-generated
  idempotency ID; the server dedupes on `(roomId, clientMessageId)`. On reconnect the client
  sends `sync { roomId, afterSeq }`; the server streams the backlog from Postgres; the client
  merges it into CoreData ([ADR-0008](0008-ios-demo-client.md)).
- **Delivery semantics**: at-least-once server→client, ordered per room by sequence number;
  clients dedupe by message ID. We do not promise exactly-once transport — dedupe yields
  effectively-once presentation, which is the honest, testable contract.
- **Back-pressure / slow consumers**: each socket gets a bounded send buffer. Under pressure,
  ephemeral events (typing, presence) are coalesced or dropped first; if the buffer still
  overflows, the socket is closed with a `resync-required` code. Reconnect + backlog sync
  restores state. The gateway never buffers unboundedly on behalf of a slow client.

**Scale path, in stages with triggers:**

1. **Single gateway node** (sticky sessions once behind a load balancer). Room→socket map is
   in-process. Trigger to leave: connection count or CPU saturates one node.
2. **Redis pub/sub fan-out**: N gateway nodes subscribe to per-room channels; a message is
   published once and each node forwards to its local sockets. Presence already lives in Redis,
   so it needs no change. Trigger to leave: cross-node publish traffic (every message reaching
   every node) dominates network/CPU.
3. **Sharded gateways by room hash**: consistent hashing assigns rooms to gateway shards;
   clients receive a routed connect token. This caps fan-out blast radius per shard and allows
   per-shard Redis.

### Positive consequences

- The full realtime design surface — semantics, back-pressure, sharding — is ours to implement,
  test (Vitest + contract tests), load-test (k6, [ADR-0007](0007-sdlc-and-operational-excellence.md)), and narrate (D1, D2).
- One process, one deploy, shared middleware: no second service to operate at demo scale (D4, D6).
- Message envelopes are zod contracts, so client and server cannot drift silently.

### Negative consequences

- We own every hard problem managed vendors solve: reconnect storms, fan-out hotspots, buffer
  tuning, and the on-call burden implied by all three. That is the point, but it is real cost.
- `ws` gives no rooms/reconnect/fallback for free; we write and maintain that layer.
- At-least-once + client dedupe pushes complexity into every client (iOS now, web/RN later).
- **Honest production note**: for a real startup at this stage, Ably or Pusher is often the
  pragmatic choice — faster to ship, someone else's pager. We reject it here because outsourcing
  fan-out would erase precisely the evidence this repo exists to produce.

## Pros and cons of the options

Scores: `++` strong fit · `+` fit · `o` neutral · `–` poor · `––` disqualifying.

| Option | D1 JD evidence | D2 semantic control | D3 protocol fit | D4 cost @ demo | D5 scale path |
|---|---|---|---|---|---|
| **Self-built ws gateway (chosen)** | ++ (the exhibit itself) | ++ | ++ (full-duplex) | + (in-process) | ++ (stages above, ours) |
| Socket.IO | o (framework does the interesting parts) | – (own protocol, own rooms/acks) | ++ | + | + (adapter model, but theirs) |
| SSE + POST sends | o | + | – (server→client only; typing needs separate POSTs) | + | o |
| Long-polling | – | + | –– (latency, connection churn) | – (request overhead) | – |
| Managed (Pusher/Ably) | –– (design surface disappears) | – (their semantics, their limits) | ++ | o (usage pricing) | ++ (theirs, proven) |

Socket.IO is the strongest rejected build option: it bundles rooms, acks, and reconnection, but
it hides exactly the mechanics we intend to demonstrate and couples clients to its protocol
version. Managed services score best on D5 and worst on D1 — the inversion that decides this ADR.

## Links

- [ADR-0003](0003-backend-platform.md) — Fastify, Redis, Postgres, BullMQ, observability the gateway reuses.
- [ADR-0005](0005-member-experience-core.md) — admission/entitlement state that gates room membership.
- [ADR-0007](0007-sdlc-and-operational-excellence.md) — SLOs and k6 plans that will cover chat delivery.
- [ADR-0008](0008-ios-demo-client.md) — CoreData backlog cache and the iOS chat client.
- `docs/user-stories.md` — US-06, US-12, US-13.

## Future trends & implications

Over ~24 months, WebSocket remains the deployable default: WebTransport over HTTP/3 keeps
maturing, but iOS/Safari support still lags, and `URLSessionWebSocketTask` is first-class on our
iOS 17+ floor. The managed-realtime market keeps moving toward edge-stateful primitives
(Cloudflare Durable Objects and similar), whose room-as-shard model our stage-3 design mirrors —
so the architecture translates rather than expires. Redis pub/sub stays the standard stage-2
fan-out; if licensing churn around Redis continues, Valkey is a drop-in for our usage. The main
risk is scope: presence and typing at demo scale can seduce us into premature stage-3 work, so
the recorded triggers are the discipline.
