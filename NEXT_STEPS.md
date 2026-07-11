# NEXT_STEPS — the Stage 1+ plan of record

Stage 0 (C01–C12) is complete: verified name, toolchain, canary-tested monorepo,
CI, AI harness, docs. Stage 1 is underway: C13–C15 (`/health` endpoint triplet),
C16 (zod-parsed runtime env config), and C17 (pino structured logging) are
done. **Nothing below C17 is implemented.** Work proceeds backend-first
in the order that maximizes JD evidence: entitlements & admission → Stripe rail
→ App Store rail → reconciliation → Deck feed → chat → iOS client flows → web
checkout → RN screen. AI ranking (**Stage AI**, below) is orthogonal to this
chain — its design is ungated, its code is gated on entitlements + Stripe +
Deck feed specifically, not on finishing the whole chain first.

Conventions: every feature lands as a TDD triplet `test → feat → refactor`
(refactor optional but preferred), plus an evidence task per story
(`/capture-media`). Commit numbers are planning handles, not promises of exact
count. Cross-cutting rules: coverage gates per CLAUDE.md; contracts before
endpoints; `/adr-new` when a decision is missing.

## Stage 1 — Server foundation online (≈C13–C22)

| # | Work | Notes |
|---|---|---|
| C13–C15 | `/health` endpoint triplet on Fastify app factory (done) | failing contract test → typed route → app-factory refactor; first supertest |
| C16 | zod-parsed env config (12-factor) (done) | `.env.example` becomes the tested contract |
| C17 | pino structured logging (done) | request IDs; log schema doc |
| C18 | OpenTelemetry bootstrap | trace context (traceId/spanId) |
| C19 | docker-compose dev env (Postgres + Redis) (done — runtime-verified: `make dev-up` → both containers healthy → `make dev-down`) | Local runtime is colima, not Docker Desktop (blocked on this managed machine); see `docs/runbook.md` #Local dev environment |
| C20 | DATABASE_URL env contract + Drizzle client factory (done) | optional until Stage 2 boot-wires the pool |
| C21–C22 | Drizzle schema/migrations (Testcontainers-verified) + members repository triplet | first tables: members + the ADR-0009 truth logs/projections |

**Reorder (2026-07-11):** the Stage 2 entitlement domain model is designed first —
[ADR-0009](docs/adr/0009-entitlement-domain-model.md), per CLAUDE.md's named judgment
escalation — so C19–C22 land as its persistence substrate rather than ahead of it.
C18 (OTel) is unaffected and may land either side.

**C21 scope note (2026-07-11):** C21 builds the *full* ADR-0009 schema — all seven
tables (members, payment_events, ledger_entries, admission_events, subscriptions,
consumable_balances, applications), not just `members` — as Testcontainers-verified
migrations with no business logic. This widens Stage 1's original "first table:
members" scope (set before ADR-0009 existed); Stage 2's C23–C25 is re-scoped below
from schema work to service logic over these already-existing tables, so the two
stages don't describe the same work twice.

## Stage 2 — Entitlements & admission (≈C23–C34) — US-01, US-02

- C23–C25 entitlement service logic — the transition executor, ledger repository, and
  idempotency-layer wiring over the ADR-0009 tables C21 already created (schema/tables
  moved to Stage 1 as ADR-0009's persistence substrate; this triplet is service logic,
  not schema, per the 2026-07-11 C21 scope note above)
- C26–C27 capability check `can(member, capability)` + gating middleware
- C28–C31 admission state machine (pure core, 100% branch) + persistence
- C32–C33 waitlist lanes + `waitlist.skip` consumption (idempotent)
- C34 admission audit log + evidence (sequence diagram, hurl transcripts)

## Stage 3 — Stripe rail (≈C35–C42) — US-09 (server half), US-10

- Checkout session endpoint (contract-first) · signed webhook consumer with
  fixture events · idempotent processing (dedupe table) · subscription state
  machine wiring · test clocks for renewal/dunning · refund/cancel downgrade
  paths · evidence: asciinema cast of webhook replay being a no-op.
- **Escalation note (decided 2026-07-11):** the named judgment escalations — the
  entitlement domain model (Stage 2) and the subscription state machine (Stage 3), per
  CLAUDE.md §Model routing — are satisfied by
  [ADR-0009](docs/adr/0009-entitlement-domain-model.md) — implementing what the ADR
  specifies needs no new design pause. A fresh escalation triggers only if
  implementation surfaces a genuine domain-design gap (already a stop-and-show-evidence
  event under CLAUDE.md's deviation rule), or when a genuinely new domain arrives
  (Deck feed re-ranking → **Stage AI (ADR-0010)**, below; messaging fan-out, Stage 7).
  Stage 6's own `ranking v0 (recency/distance)` heuristic is ordinary sort logic, not a
  new domain, and needs no escalation — see Stage 6's note.

## Stage 4 — App Store rail (≈C43–C49) — US-07, US-08 (server half)

- JWS verification (App Store Server API v2) with fixture keys · Server
  Notifications V2 consumer · consumable credit → ledger · subscription
  lifecycle mapping to the shared state machine · sandbox test plan.

## Stage 5 — Reconciliation (≈C50–C52)

- Nightly BullMQ job: provider truth vs local state, drift report, alert rule.
  Evidence: seeded-drift test run.

## Stage 6 — Deck feed API (≈C53–C58) — US-03

- Activity model + geo query (`TODO(decide)`: geo indexing approach — PostGIS vs
  earthdistance vs H3; take via `/adr-new`) · feed contract + pagination ·
  ranking v0 (recency/distance) · seed script.
- **Note:** heuristic ranking only — no escalation; AI re-ranking lives in
  Stage AI / ADR-0010 (below), whose *implementation* is gated on this stage
  existing first (there is nothing to re-rank before the feed does).

## Stage 7 — Chat gateway (≈C59–C66) — US-06, US-13

- WS gateway per [ADR-0006](docs/adr/0006-realtime-messaging.md): rooms,
  presence, typing, offline queue + backlog sync · push notification "starting
  soon" deep link (US-13 server half).

## Stage 8 — iOS client flows (≈C67–C74) — US-03..05, US-07/08 (client), US-12

- Deck UI (RxSwift module) + coordinator routes · activity detail + MapKit ·
  StoreKit 2 purchase/restore with StoreKitTest · CoreData offline cache ·
  snapshot tests for Deck cards & paywall.

## Stage 9 — Web checkout, RN screen (≈C75–C80)

- Stripe Checkout web page (US-09 web half) · React Native brownfield Events
  screen (TurboModule). AI ranking is **not** part of this stage's C-range — it's
  **Stage AI — retrieval slice**, below (its own orthogonal gating; study-map
  rows 10–14).

## Stage AI — retrieval slice (planned, not started)

**Sequencing — split gate.** The **ADR-0010 design session** (Plan Mode, escalated model) is
**ungated**: it needs no Deck feed to exist and may be pulled forward, including for interview
value. **Implementation** (code) is gated on Stage 2's transition executor (C23–C25), Stage 3's
Stripe rail (the first webhook rail), **and Stage 6's Deck feed** — there is nothing to re-rank
before the feed exists. Not given C-numbers yet; positioned here (after Stage 9) as an
orthogonal track: its *design* isn't Stage-N-sequenced, but its *code* now explicitly is.

**Escalation:** per the Stage 3 escalation note's named new-domain trigger — Deck feed
re-ranking → **Stage AI (ADR-0010)** — implementation begins with a Plan-Mode design session on
the escalated model before any code, not a continuation of ADR-0009's scope.

pgvector Deck re-ranking MVP mapped to the five-layer AI stack
(`docs/ai/methodology.md` §The five-layer AI stack):

- **Retrieval:** embeddings via a provider-agnostic interface; pgvector + HNSW index on the
  existing Postgres (no separate vector DB); a deterministic fake embedder for tests — no API
  keys in CI.
- **Efficiency:** embedding hash-cache (skip re-embedding unchanged content); per-call
  cost/latency logging; the provider interface doubles as product-side model routing.
- **Action:** evidenced by then — the Stripe/App Store integrations (Stages 3–4) precede this
  slice; later, an MCP server exposing Irlo's own ops endpoints as tools.
- **Agent:** remains dev-plane only, by design — documented, not duplicated into the product.
- **Trust:** a golden-set offline eval wired into CI; moderation is slice 2, after the
  re-ranking MVP, not bundled into it.

## Deferred / parked items

- CI Docker image-pull caching (e.g. GitHub Actions cache for the Testcontainers
  postgres:17-alpine layer) — watch, not urgent: the first Testcontainers-enabled
  server CI run added +16s over the prior baseline (41s vs ~25s; run
  [29163791797](https://github.com/sebkoo/irlo/actions/runs/29163791797)).
  Revisit if Stage 2+ adds enough image-pulling tests to push this meaningfully
  higher.
- README CI/coverage badges — add only after the first green CI run (may already
  be done post-push; check).
- Manual KIPRIS trademark session before any commercial use (`docs/naming/verification.md` #12).
- RevenueCat build-vs-buy ADR (`docs/monetization.md` §Build vs buy).
- Turborepo when >3 packages or cold build >30s ([ADR-0002](docs/adr/0002-monorepo-and-toolchain.md)).
- TypeScript 7 migration when typescript-eslint's peer range allows ([ADR-0003](docs/adr/0003-backend-platform.md)).
- zod→OpenAPI generation once the first real endpoint exists.
- Feature-flag service choice (`TODO(decide)` in [ADR-0007](docs/adr/0007-sdlc-and-operational-excellence.md)).
- Social preview 1280×640 upload (manual, spec in `docs/media/README.md`).
- Final Irlo+ price points (`docs/monetization.md` catalog TODO).
