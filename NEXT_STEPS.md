# NEXT_STEPS — the Stage 1+ plan of record

Stage 0 (C01–C12) is complete: verified name, toolchain, canary-tested monorepo,
CI, AI harness, docs. **Nothing below is implemented.** Work proceeds backend-
first in the order that maximizes JD evidence: entitlements & admission → Stripe
rail → App Store rail → reconciliation → Deck feed → chat → iOS client flows →
web checkout → RN screen → AI ranking.

Conventions: every feature lands as a TDD triplet `test → feat → refactor`
(refactor optional but preferred), plus an evidence task per story
(`/capture-media`). Commit numbers are planning handles, not promises of exact
count. Cross-cutting rules: coverage gates per CLAUDE.md; contracts before
endpoints; `/adr-new` when a decision is missing.

## Stage 1 — Server foundation online (≈C13–C22)

| # | Work | Notes |
|---|---|---|
| C13–C15 | `/health` endpoint triplet on Fastify app factory | failing contract test → typed route → app-factory refactor; first supertest |
| C16 | zod-parsed env config (12-factor) | `.env.example` becomes the tested contract |
| C17–C18 | pino logging + OpenTelemetry bootstrap | request IDs, trace context; log schema doc |
| C19 | docker-compose dev env (Postgres + Redis) | requires `cask docker` (deferred Brewfile entry) |
| C20–C22 | Drizzle + migrations + Testcontainers repository triplet | first table: members |

## Stage 2 — Entitlements & admission (≈C23–C34) — US-01, US-02

- C23–C25 entitlement service schema + ledger tables (append-only, triplet)
- C26–C27 capability check `can(member, capability)` + gating middleware
- C28–C31 admission state machine (pure core, 100% branch) + persistence
- C32–C33 waitlist lanes + `waitlist.skip` consumption (idempotent)
- C34 admission audit log + evidence (sequence diagram, hurl transcripts)

## Stage 3 — Stripe rail (≈C35–C42) — US-09 (server half), US-10

- Checkout session endpoint (contract-first) · signed webhook consumer with
  fixture events · idempotent processing (dedupe table) · subscription state
  machine wiring · test clocks for renewal/dunning · refund/cancel downgrade
  paths · evidence: asciinema cast of webhook replay being a no-op.

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

## Stage 7 — Chat gateway (≈C59–C66) — US-06, US-13

- WS gateway per [ADR-0006](docs/adr/0006-realtime-messaging.md): rooms,
  presence, typing, offline queue + backlog sync · push notification "starting
  soon" deep link (US-13 server half).

## Stage 8 — iOS client flows (≈C67–C74) — US-03..05, US-07/08 (client), US-12

- Deck UI (RxSwift module) + coordinator routes · activity detail + MapKit ·
  StoreKit 2 purchase/restore with StoreKitTest · CoreData offline cache ·
  snapshot tests for Deck cards & paywall.

## Stage 9 — Web checkout, RN screen, AI ranking (≈C75–C80)

- Stripe Checkout web page (US-09 web half) · React Native brownfield Events
  screen (TurboModule) · pgvector embeddings ranking + LLM moderation behind a
  provider-agnostic interface (study-map rows 10–14).

## Deferred / parked items

- `brew "asciinema"`, `cask "docker"` — uncomment in Brewfile when Stage 1 starts.
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
