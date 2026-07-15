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

## Stage 2 — Entitlements & admission (≈C23–C36) — US-01, US-02

- C23 entitlement service logic — ledger repository (done: append/getBalance,
  idempotency layer 2 on `natural_key`) + inbox repository (done: tryInsert,
  idempotency layer 1 on `(source, event_id)`) — over the ADR-0009 tables C21
  already created (schema/tables moved to Stage 1 as ADR-0009's persistence
  substrate; this triplet is service logic, not schema, per the 2026-07-11 C21
  scope note above).
- C24–C27 subscription state-machine reducer (done — `server/src/domain/subscription-transition.ts`):
  C24 pure state graph (`transition`), C25 idempotency layer 3 (`applyEvent`'s
  monotonic `highWater` guard, I5a stale-but-economic events), C26 context-only
  events (`autorenew_set`, `plan_changed`, `renewal_extended`), C27
  generation-spawning (`applyPurchase` — `[*] --> trial|active` entry
  transitions, RESUBSCRIBE-on-terminal spawning generation+1 per I6). This is
  the pure reducer only — no executor/persistence wiring yet; that lands as
  part of Stage 3's "subscription state machine wiring" (below), the
  reducer's first real caller, rather than as a standalone Stage 2 step.
- C28–C29 capability check `can(member, capability)` + gating middleware
  *(renumbered from C26–C27 — the reducer completion above claimed those
  numbers first; C-numbers are planning handles per this doc's own header,
  not promises of exact count, so this is a relabel, not a scope change)*
- C30–C33 admission state machine (pure core, 100% branch) + persistence
- C34–C35 waitlist lanes + `waitlist.skip` consumption (idempotent)
- C36 admission audit log + evidence (sequence diagram, hurl transcripts)

**Reducer completion (2026-07-11 close, done):** subscription state-machine
reducer triplets landed — ADR-0009 §3b's tables implemented verbatim (states,
events, guards, terminal absorption), including I5a's stale-but-economic named
test (a stale event that still appends its ledger grant/credit while
suppressing only the state transition — see ADR-0009 §3f), plus context-only
events (C26) and generation-spawning (C27). The Stage 3 escalation note's
named judgment escalation was satisfied by ADR-0009 (no design pause needed —
implementing what the ADR specifies, per the 2026-07-11 decision above). Built
on C23's ledger/inbox repositories (`server/src/db/repositories/{ledger,inbox}.ts`)
and the shared `isUniqueViolation` helper (`server/src/db/pg-errors.ts`) —
idempotency layers 1–2 (inbox, ledger natural keys) already had repositories
from C23; layer 3 (monotonic state guard, `applyEvent`) was the new piece C25
added. **Remaining for Stage 2/3 boundary:** the executor — wiring
`applyEvent`/`applyPurchase` into these repositories and persistence — lands
as part of Stage 3's webhook consumer below, its first real caller.

## Stage 3 — Stripe rail (≈C37–C44) — US-09 (server half), US-10

- Checkout session endpoint (contract-first) · signed webhook consumer with
  fixture events · idempotent processing (dedupe table) · subscription state
  machine wiring · test clocks for renewal/dunning · refund/cancel downgrade
  paths · evidence: asciinema cast of webhook replay being a no-op.
- **Normalizer pure core landed (2026-07-11):**
  `server/src/payments/stripe/normalize-event.ts` — `invoice.payment_failed`,
  `customer.subscription.deleted`, `charge.refunded`, `invoice.paid`
  (billing_reason branching), `customer.subscription.updated`
  (`previous_attributes` diffing). Deferred, tracked in the module's own doc
  comment: `charge.dispute.closed`, `checkout.session.completed` linkage.
  **Remaining before the consumer is complete:** the known limitation below,
  then signature verification + fixture events + wiring into the C23
  repositories and the reducer (`applyEvent`/`applyPurchase`) — next-session
  opener, see below.
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

**Context-event executor landed (2026-07-11 close, prior session):**
`consumeContextEvent` (`server/src/payments/consume-context-event.ts`) — the
transactional-inbox wiring for the three context-only events (`autorenew_set`,
`plan_changed`, `renewal_extended`), locking via `SELECT ... FOR UPDATE` on the
existing subscription row.

**Economic-event executor landed (2026-07-11 close, this session):** the three
money-moving events — `consumePurchaseEvent` (generation-spawning `purchased`,
`server/src/payments/consume-purchase-event.ts`), `consumeSubscriptionEconomicEvent`
(`renewed`/`refunded` on an existing generation,
`server/src/payments/consume-subscription-economic-event.ts`), and
`consumeConsumableRefund` (ADR-0009 I2's negative-balance debt path,
`server/src/payments/consume-consumable-refund.ts`). Locking design (see the two
new functions' own doc comments for the full reasoning, reviewed and corrected
during this session's design pass before implementation): `pg_advisory_xact_lock`
keyed on `(provider, providerSubscriptionId)` protects the zero-row
generation-creation race that `FOR UPDATE` structurally cannot (there's no row
yet to lock); `SELECT ... FOR UPDATE` is *also* still taken once a row exists, so
these two functions and the already-shipped `consumeContextEvent` all mutually
serialize on an existing row via ordinary Postgres row-level locking — **no
residual cross-function gap**, unlike an advisory-lock-only design would have
left (an earlier draft of this session's design had exactly that gap; it was
caught and closed before implementation, not discovered after). `payment_events.disposition`
gained a fifth value, `no_op_live` (ADR-0009 "Decisions recorded" §6), for
`consumePurchaseEvent`'s "different envelope, same ledger natural key, generation
already live" case. Four real concurrent-Postgres-connection race tests
(`server/test/support/deterministic-race.ts`'s `raceViaAdvisoryLock` harness for
three of them; a documented best-effort `Promise.allSettled` for the fourth,
`consumeConsumableRefund`, which takes no lock at all by design) prove
exactly-once ledger effects under genuine interleaving, not just sequential
replay. All three triplets code-reviewed (opus, xhigh) with no BLOCKING findings.
`renewal_failed`/`grace_exhausted`/`period_expired` (state-only, no ledger fact —
Q2: "a failed payment moves no money") remain unimplemented, left to a follow-up
executor per the same deferral style `consume-context-event.ts` already uses.

**Multi-fact envelope + delivery-semantics addenda settled (2026-07-11):** the two gaps that
were blocking the webhook route — the combined-update `autorenew_set` drop and the missing
disposition→HTTP mapping — are now [ADR-0009 §3g and §3h](docs/adr/0009-entitlement-domain-model.md#3g-multi-fact-envelopes-addendum-decided-2026-07-11--code-reviewer-approved),
both code-reviewer approved. See the resolved `TODO(decide)` above for the §3g summary.

**§3g implementation landed:** `normalizeStripeEvent`'s widening to emit a multi-fact
context-event envelope and `consumeContextEvent`'s widening to fold it in one
transaction/one inbox row are both done and code-reviewed (test/feat commits
`ddcb01d`/`892a05c` post-history-rewrite — see `.claude/state/last-reviewed-sha`).

**Named blocker found while wiring the route (2026-07-12):** `consumePurchaseEvent`
requires a caller-supplied `memberId`, and there is no member↔customer linkage
anywhere in the schema (`members` has no provider-linkage column) — `normalizeStripeEvent`'s
own doc comment already flagged this as deferred (`checkout.session.completed` "member↔customer
linkage — the executor's job, not the reducer's"), but the executor-side linkage was never
actually built. Checked and confirmed narrower than it first looked: `consumeSubscriptionEconomicEvent`
derives `memberId` from the existing row it locks (never external input), `consumeContextEvent`
never needs it, and `consumeConsumableRefund` has no Stripe caller today by design — so only
the brand-new-subscription path (`purchased` → `consumePurchaseEvent`) is actually blocked.
**Decided (2026-07-12):** scope the first route triplet down rather than design the linkage
inline — wire context/economic events (3 of 4 consumers) fully now; for `purchase_event`, the
route logs + alerts and returns 5xx (transient, not a permanent domain gap — matches §3h's
`invalid`-transition reasoning: this isn't unactionable forever, it's unactionable *until
linkage lands*, which is a different disposition than "will never resolve"). This path is a
real tested branch, not a stub note: a fixture asserts 5xx + an alert + zero rows written for
a `purchase_event` with no resolvable member. **Member↔customer linkage → Stage 3
(ADR-0011)**, a new named escalation-gated item alongside **Stage AI (ADR-0010)** above: the
**ADR-0011 design session** (Plan Mode, escalated model) covers the linkage data model (a
`provider_customer_id`-shaped column or table, populated via `checkout.session.completed`)
before any schema lands — entitlement-domain-model territory per CLAUDE.md's named judgment
escalations, not normal-session model/effort. Implementation is gated on the design session
existing first, same split-gate shape as ADR-0010.

**Next-session opener:** the webhook route itself — signature verification
(`Stripe.webhooks.constructEvent`) against fixture events, raw-body content-type parsing
scoped to the route, and dispatch from `normalizeStripeEvent`'s output
(`server/src/payments/stripe/normalize-event.ts`) into `consumeContextEvent`/
`consumeSubscriptionEconomicEvent` (fully wired) and a logged/alerted 5xx stub for
`purchase_event` (blocked, see above) — `consumeConsumableRefund` has no Stripe caller
yet, wired for Stage 4's Apple rail instead. Route HTTP status mapping per §3h; doc comment
cites §3h, not §3e. Model routing: Sonnet 5 @ high (no fresh escalation for the route itself
— the Stage 3 escalation note above already covers this; the linkage follow-up above is the
one piece that may need its own escalation).

**Route landed (2026-07-14):** `server/src/routes/stripe-webhook.ts` is wired end-to-end —
raw-body content-type parsing scoped to the route, `Stripe.webhooks.constructEvent` signature
verification, dispatch from `normalizeStripeEvent`'s output into `consumeContextEvent`/
`consumeSubscriptionEconomicEvent`, and the §3h disposition→HTTP mapping — plus
`extractSubscriptionIdFromInvoice` (`server/src/payments/stripe/extract-subscription-id.ts`)
resolving `invoice.paid`'s routing key. `buildApp` only registers the route when both a `db`
and `STRIPE_WEBHOOK_SECRET` are supplied (`packages/contracts`'s `serverEnvSchema` gained the
latter, optional until this point, mirroring `DATABASE_URL`'s staged rollout). Testcontainers-
verified per the [route spec's fixture
matrix](server/test/routes/stripe-webhook.route.testcontainers.test.ts): the golden path for
both wired consumers, redelivery dedup, `no_matching_generation`, a missing/bad/reparsed
signature, an unresolvable routing key, an unsupported event type, and a genuine
killed-connection infra fault followed by a successful identical-redelivery retry.
`purchase_event` (blocked on ADR-0011 linkage) and non-`renewed` `subscription_event` types
remain the two logged/alerted 5xx stubs described above — both are real tested branches, not
stub notes. **Next:** ADR-0011 is designed (block below, 2026-07-14) — next code work is
linkage slice (A) below or C18 (OTel bootstrap); slices A–D implement what ADR-0011
specifies, so no fresh judgment escalation, per the same rule the Stage 3 escalation note
already applies to ADR-0009.

**ADR-0011 accepted (2026-07-14):** member↔rail-identity linkage is designed —
[ADR-0011](docs/adr/0011-member-rail-identity-linkage.md): one provider-agnostic
`rail_identities` table (UNIQUE `(provider, external_id)`, member 1:N identities), links
created on each rail's authenticated channel only (Stripe: the checkout-session endpoint
commits the link *before* the session exists; `checkout.session.completed` is the
signed-echo backstop; Apple's server-minted `appAccountToken` at Stage 4), and
5xx-until-linked retained for out-of-order purchase events (parking in `payment_events`
rejected — it would shift delivery ownership from Stripe's at-least-once retries onto a
local replay job, an at-most-once downgrade for money facts). Implementation slices, in
order:

- **(A)** `rail_identities` migration + repository triplet (Testcontainers) — the eighth
  ADR-0009-family table; a new Stage 3 migration, not a C21 reopen.
- **(B)** linkage consumer (`checkout.session.completed` → link upsert + inbox row, per
  ADR-0011 §3b's outcome table) + `linkage_event` normalizer kind + route dispatch.
- **(C)** purchase-branch retirement: `resolveMemberByRailIdentity` +
  `consumePurchaseEvent` wiring; the stub test mutates into the `unlinked_customer` test;
  ADR-0011 §3g lists the full test-flip set (golden path, out-of-order pair, conflict).
- **(D)** checkout-session endpoint — the already-planned Stage 3 bullet, now specified:
  create-or-reuse the Customer and commit the link before creating the session.

**C↔D dependency, stated so nobody misreads post-C as launchable:** slice C's golden path
is testable with fixture-created links, but production links only exist once D ships —
after C, the purchase path passes end-to-end in tests while every real-world purchase
still 5xxes as `unlinked_customer` until D lands.

Stage 4 note: Apple token minting/first-submission flows consume the same table (ADR-0011
§3e); no fresh linkage design pause needed there.

**Slice A done (2026-07-15):** `rail_identities` schema + migration + the three-operation
repository triplet (`createLink`, `resolveMemberByRailIdentity`, `getLatestIdentity`)
landed, each as a genuine red→green pair, Testcontainers-verified. Two code-reviewer
passes (Opus 4.8, xhigh): the first flagged an untested `resolveMemberByRailIdentity`
provider predicate (a real misattribution-of-money risk given `UNIQUE(provider,
external_id)` allows the same raw external id under two providers) and a missed bare
`§3g` qualifier in ADR-0011 §3f; both fixed and folded into their originating commits via
fixup+autosquash, re-reviewed clean. Server suite: 100% statement/branch/function/line
coverage.

**Slice B done (2026-07-15):** the `checkout.session.completed` linkage consumer landed —
`normalizeStripeEvent` gains a `linkage_event` kind, `consumeLinkageEvent` implements
§3b's full outcome table (`linked`/`already_linked`/`duplicate`/`conflict`/
`member_not_found`/`unattributable`, no new `payment_events.disposition` value), and the
route dispatches it (always 2xx; alerted on the three outcomes that never resolve on
redelivery). `purchase_event`'s 5xx stub deliberately untouched (that's slice C).

**Slice C done (2026-07-15):** the `purchase_event` 5xx stub is retired. The route now
resolves the member via `resolveMemberByRailIdentity('stripe', customer)` before calling
`consumePurchaseEvent` — resolver hit → 2xx (`generation_created`/`no_op_live`/
`duplicate`); resolver miss → 5xx `unlinked_customer` + alert + zero rows written
(ADR-0009 §3h case (c), added by ADR-0011 §3d/§3f). All four of §3g's named
done-definition tests pass, including the flagship out-of-order pair (purchase 5xxes →
`checkout.session.completed` links it → the same purchase envelope re-posted succeeds).
`consumePurchaseEvent`'s own signature is unchanged (Q6) — the route resolves `memberId`,
the consumer still just takes it. Server suite: 100% statement/branch/function/line
coverage. **The C↔D dependency stands as designed:** production purchases still 5xx as
`unlinked_customer` until slice D's checkout-session endpoint creates real links — slice C
alone only makes the purchase path pass end-to-end in tests with fixture-created links.
**Next:** slice (D) — the checkout-session endpoint (create-or-reuse the Stripe Customer,
commit the link before creating the session).

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
value. **Implementation** (code) is gated on the transition executor (Stage 2's reducer, C23–C27,
wired up as Stage 3's webhook consumer), Stage 3's Stripe rail (the first webhook rail),
**and Stage 6's Deck feed** — there is nothing to re-rank
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

- `.claude/hooks/protect-constitution-bash.sh` (the Bash-matcher constitution guard,
  methodology.md self-enforcement case 7) has a known minor false-positive: its
  mutation-signature check matches a bare `>` anywhere in the command string, not
  specifically redirection *into* a protected path — so a read-only command that both
  mentions `.claude/settings*.json`/`.claude/hooks/` in an argument *and* uses `2>/dev/null`
  or `2>&1` elsewhere (common for suppressing stderr on diagnostics) gets blocked too.
  Found 2026-07-12, same session as the guard's first fix. Not fixed same-session per the
  constitution-edit rule this incident produced (propose-diff, human-applies) and the
  operator's explicit "no more harness work this session" — workaround in the meantime is
  to avoid combining a protected-path mention with a `2>`/`&>` redirect in one Bash call.
  A tighter fix would require the `>` check to confirm the redirect target (not just any
  `>` in the string) is actually one of the protected paths, mirroring the existing
  word-boundary treatment already applied to `cp`/`mv`/`rm`/`dd`/etc.
- CI Docker image-pull caching (e.g. GitHub Actions cache for the Testcontainers
  postgres:17-alpine layer) — watch, not urgent: the first Testcontainers-enabled
  server CI run added +16s over the prior baseline (41s vs ~25s; run
  [29163791797](https://github.com/sebkoo/irlo/actions/runs/29163791797)).
  Revisit if Stage 2+ adds enough image-pulling tests to push this meaningfully
  higher.
- `TODO(decide)`: ADR-0009 §3b's diagram has no `trial → grace`/`billing_retry` edge,
  so `trial + renewal_failed` is `invalid_transition` in C24's reducer (faithful to
  the ADR as written) — but a free-trial that fails to convert to paid is a real
  Apple flow (DID_FAIL_TO_RENEW at trial end). Confirm against real App Store Server
  Notification fixtures when Stage 4 lands: does the normalizer map that flow to
  `period_expired` (trial→expired, forgoing dunning) by design, or is §3b missing an
  edge? Found in code-reviewer's C24 review (2026-07-11) — not a bug in C24, which
  correctly implements the ADR as specified.
- ~~`TODO(decide)`: `normalizeStripeEvent`'s `customer.subscription.updated` combined-update
  edge (dropped `autorenew_set` when `items` also changed in the same envelope)~~ —
  **resolved 2026-07-11**, [ADR-0009 §3g](docs/adr/0009-entitlement-domain-model.md#3g-multi-fact-envelopes-addendum-decided-2026-07-11--code-reviewer-approved)
  (code-reviewer approved, Opus 4.8/xhigh): the normalizer will emit an ordered, non-empty
  list of context facts for a combined update; the executor folds all facts of one envelope
  in a single transaction under one inbox row (decided over a facet-suffixed-inbox-key
  alternative on atomicity grounds — one Stripe event must stay one atomic unit). Also see
  [ADR-0009 §3h](docs/adr/0009-entitlement-domain-model.md#3h-delivery-semantics--stripe-webhook-http-response-mapping-addendum-2026-07-11),
  added the same session: the disposition→HTTP status mapping for the webhook route
  (2xx/400/5xx + the `invalid`-transition and `no_matching_generation` edge cases), since no
  section previously specified this (§3e is dual-rail reconciliation authority, not HTTP
  transport — a prior read of the ADR conflated the two). Both addenda are settled; nothing
  blocks starting the route.
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
