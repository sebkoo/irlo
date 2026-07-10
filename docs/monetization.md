# Monetization design

Document-only in Stage 0. Monetization here is a means, not the end: the catalog
exists to exercise **production payments engineering** — the dual-rail
architecture in [ADR-0004](adr/0004-payments-platform.md) — against a realistic
curated-membership catalog. Benchmark mechanics come from category-leading
curated-membership apps (specific benchmark notes live in
`docs/interview/raya-product-notes.md`); Irlo mirrors *mechanics*, never branding.

## Catalog

| Product ID | Type | What it does | Indicative price band | Rationale |
|---|---|---|---|---|
| `spark.single` | Consumable | One visibility boost for your join request | low single-digit $ | impulse price; anchors the pack |
| `spark.pack5` | Consumable | Five boosts | ~3–4× single | standard 5-pack discount teaches pack economics |
| `undo.pack10` | Consumable | Ten swipe undos (US-04) | low single-digit $ | high-frequency, low-stakes; volume-priced |
| `waitlist.skip` | Consumable | One priority-lane move in a crew waitlist ([ADR-0005](adr/0005-member-experience-core.md)) | mid single-digit $ | the domain's signature consumable; priced above sparks to protect fairness |
| `irlo.plus.monthly` | Auto-renewable | Irlo+ membership, monthly, intro offer | TODO(decide): final price points | monthly premium tier; intro offer exercises offer-code flows |
| `irlo.plus.yearly` | Auto-renewable | Irlo+ membership, annual | ~4× monthly (≈65% discount) | annual-discount norm; exercises upgrade/downgrade proration |

Final USD price points are deliberately **TODO(decide)** until launch planning;
bands above document the *rationale structure* (anchoring, pack discounts,
fairness protection) that interviewers probe.

**Irlo+ entitlements (planned):** full Deck reach, unlimited swipes, boosted host
visibility, extended chat history, undo included. Free tier remains genuinely
usable — the funnel sells acceleration, not access to friends.

## Two rails, one truth

Everything below is specified in [ADR-0004](adr/0004-payments-platform.md) and
implemented across Stages 3–5 (`NEXT_STEPS.md`):

- **StoreKit 2 (iOS):** `Transaction.currentEntitlements` client-side for UX
  only; server verifies transaction JWS via App Store Server API v2 and consumes
  **Server Notifications V2** for lifecycle events.
- **Stripe (web):** Checkout + Billing; signed webhooks; test clocks drive
  renewal/dunning scenarios in CI.
- **One entitlement service** answers capability checks; an **append-only
  ledger** records every grant/consumption/refund; **idempotent consumers** make
  provider retries harmless; **nightly reconciliation** flags drift.
- Buying `irlo.plus.monthly` on the web unlocks iOS in seconds (US-09) — the
  dual-rail proof.

## App Review 3.1.1 position

In-app purchases of digital goods use IAP exclusively. The web rail sells the
same entitlement, discovered independently — no in-app steering to external
purchase. Restore purchases and refund handling (both rails, US-10) are
first-class flows. Evolving external-link allowances are additive to this
design (see ADR-0004 §3.1.1 note).

## Paywall principles (no dark patterns)

- Price, renewal period, and cancel path visible before purchase; no fake
  urgency, no pre-selected upsells, no guilt copy.
- Free-tier value stays real; paywalls never gate safety features (blocking,
  reporting) or already-formed connections.
- A/B tests (flag-driven, per `docs/product/metrics-and-experiments.md`) may vary
  presentation and offer timing — never the honesty of the disclosure.

## Metrics that matter

Trial→paid conversion, ARPPU, consumable attach rate, involuntary-churn recovery
(grace/billing-retry re-capture — the state machine's ROI), refund rate, and
LTV:CAC once acquisition exists. Definitions and event schema:
`docs/product/metrics-and-experiments.md`.

## Build vs buy

RevenueCat would compress Stages 3–5 substantially and is the pragmatic choice
for a small team; this repo builds the machinery because demonstrating it *is
the goal*. A full build-vs-buy ADR stub is queued in `NEXT_STEPS.md` so the
decision is revisited with evidence, not vibes.
