# Design drills — 8 stubs

> Internal interview-prep notes (Raya is referenced only inside `docs/interview/`).
> These are **stubs to be worked at a whiteboard**, not model answers. Each drill
> names the Irlo artifact that will answer it; all artifacts are Stage 1+ (planned).

Cadence: 2 drills/week per `raya-prep.md`. Warm up with system-design-primer
vocab (study map row 1). Time-box: 35 minutes talking, 10 minutes self-review.

## ① Cross-platform subscription & consumable payments platform

**Problem.** Design a payments platform where users buy subscriptions and
consumables on iOS (StoreKit 2) and web (Stripe), and both rails grant the same
entitlements. Purchases must be credited exactly once from the user's view.

**Clarify:** which rail owns which SKU; refund/cancel semantics per rail;
cross-device entitlement latency budget; audit/compliance needs; scale (webhooks/sec).

**Irlo artifact:** ADR-0004 (planned) — dual rail → one provider-agnostic
entitlement service, append-only ledger, subscription state machine; `docs/monetization.md`; US-07–US-10.

**Follow-ups:**
1. "Exactly-once" over at-least-once delivery — where exactly does idempotency live?
2. A Stripe cancel and an App Store renewal arrive out of order — who wins?
3. How do you test renewals without waiting a month? (Test clocks, sandbox.)
4. Where does the ledger disagree with the provider, and how does reconciliation resolve it?
5. What breaks first at 100× webhook volume?

## ② Waitlist / admission system

**Problem.** Design the application → waitlist → acceptance system for a curated
community. Reviews are human-in-the-loop, demand exceeds capacity, and applicants
can pay to skip ahead. Keep it fair, fast, and abuse-resistant.

**Clarify:** review throughput vs. applicant volume; what "fair" means when skips
are sold; re-application policy; decision auditability; notification SLAs.

**Irlo artifact:** ADR-0005 (planned) — admission state machine (100% branch
coverage gate), audit trail, fairness/throughput notes; `waitlist.skip`; US-01/US-02.

**Follow-ups:**
1. Model the state machine — which transitions need idempotency and why?
2. Paid skips vs. fairness: how do you bound starvation for non-payers?
3. How do you detect and throttle mass or duplicate applications?
4. A reviewer approves twice concurrently — what prevents double admission?
5. How would you measure and raise reviewer throughput without hurting quality?

## ③ Deck feed & ranking API

**Problem.** Design the API serving a swipeable card deck of nearby activities —
ranked by distance, time, and host quality, paginated for a mobile client, cheap
to refresh. Later, embedding-based ranking improves relevance.

**Clarify:** freshness vs. cost; personalization depth at v1; pagination model
(cursor semantics under a changing feed); offline/cached behavior; dedupe of seen cards.

**Irlo artifact:** US-03/US-04 (planned); pgvector embeddings ranking ADR
(planned, `NEXT_STEPS.md`); CoreData offline cache client-side (ADR-0008, planned).

**Follow-ups:**
1. Cursor pagination when items enter/leave the feed mid-scroll — what guarantees do you give?
2. Where do you precompute ranking vs. score at request time?
3. How does swipe feedback flow back into ranking without a full ML pipeline?
4. Cold start: new user, new city — what do you serve?
5. What's your cache key, and when is it invalidated?

## ④ Chat fan-out & presence

**Problem.** Design realtime group chat for activity crews: message fan-out,
typing indicators, presence, offline queue, and backlog sync on reconnect.
Start single-node; show the path to horizontal scale.

**Clarify:** room size distribution; delivery guarantees (ordering, at-least-once);
presence staleness tolerance; backlog depth; mobile reconnect patterns.

**Irlo artifact:** ADR-0006 (planned) — WebSocket gateway, room fan-out, Redis
presence, offline queue + backlog sync, scale path sticky sessions → Redis pub/sub → sharding; US-06.

**Follow-ups:**
1. Walk the scale path — what breaks at each stage, and what does the next stage fix?
2. How does a client resync after 8 hours offline without replaying everything?
3. Per-room ordering: where is it enforced, and what does it cost?
4. Presence for 10K concurrent users — push, pull, or TTL heartbeats?
5. How do typing indicators avoid becoming your top traffic source?

## ⑤ Geo activity search

**Problem.** Design "activities near me": radius and bounding-box queries over
activities with start times, filtered and sorted, feeding the Deck feed. Reads
dominate writes; results must feel instant on mobile.

**Clarify:** query shape (radius vs. viewport); density extremes (Seoul vs. rural);
freshness of new activities; filter combinatorics; result count vs. precision.

**Irlo artifact:** US-03 nearby-activities feed (planned) over Postgres
(ADR-0003, planned). TODO(decide): geo indexing approach for nearby-activity search.

**Follow-ups:**
1. Compare geo indexing options and pick one for this read/write mix — justify it.
2. Dense-city query returns 5K hits — how do you rank and truncate cheaply?
3. Do you cache geo queries? What's the key, given a moving user?
4. How do time filters ("starting soon") compose with the spatial index?
5. When does this move out of the primary datastore?

## ⑥ Webhook reliability & reconciliation

**Problem.** Two providers (Stripe, App Store) push payment events at-least-once,
out of order, occasionally never. Design consumption so entitlements stay correct,
plus a reconciliation loop that catches whatever webhooks miss.

**Clarify:** per-provider delivery/ordering guarantees; retry/backoff windows;
acceptable entitlement staleness; poison-message policy; alerting thresholds.

**Irlo artifact:** ADR-0004 (planned) — signature verification, dedupe keys,
idempotent consumers, append-only ledger, nightly reconciliation job; US-09/US-10.

**Follow-ups:**
1. Dedupe key choice per provider — event ID, transaction ID, or something derived?
2. Verify-then-queue or queue-then-verify? Defend the boundary.
3. Reconciliation finds a divergence — who is the source of truth, per case?
4. How do you replay a week of events safely after a consumer bug?
5. What single metric best tells you webhook processing is silently degrading?

## ⑦ Rate limiting & abuse prevention

**Problem.** Protect the platform: application spam toward the waitlist, swipe
bots, chat flooding, webhook endpoint abuse. Design layered rate limiting and
abuse detection that punishes bots, not enthusiastic members.

**Clarify:** limit dimensions (IP, user, device, endpoint); hard block vs. shadow
throttle; abuse signals available; false-positive tolerance; appeal path.

**Irlo artifact:** Redis-backed rate limits (ADR-0003, planned); admission abuse
notes (ADR-0005, planned); planned LLM-assisted content moderation (`NEXT_STEPS.md`).

**Follow-ups:**
1. Token bucket vs. sliding window in Redis — pick per endpoint class and justify.
2. How do limits behave when Redis is down — fail open or closed, where?
3. Distinguish a swipe bot from a power user — with what signals?
4. Where does rate limiting live: edge, gateway, or handler? Trade-offs?
5. How do paid actions (skips, boosts) change your abuse model?

## ⑧ Zero-downtime migrations

**Problem.** Evolve the Postgres schema under live traffic — including hot tables
like the payments ledger and admission states — with weekly releases and no
maintenance windows. Rollback must always be possible.

**Clarify:** deploy topology (rolling? multiple app versions live?); table sizes
and lock sensitivity; data backfill volume; rollback expectations; ORM constraints.

**Irlo artifact:** Drizzle migrations (ADR-0003, planned); trunk-based weekly
release cadence + runbook stub (ADR-0007, planned).

**Follow-ups:**
1. Walk expand → migrate → contract for renaming a column on the ledger.
2. Which DDL takes dangerous locks in Postgres, and how do you avoid them?
3. Backfilling 50M rows — batching, pacing, and progress tracking?
4. Old and new app versions run simultaneously — what contract must the schema keep?
5. A migration is 80% done and wrong — what's your rollback story?
