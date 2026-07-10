# Metrics & experiments

> **Status: Stage 0.** No analytics pipeline, no events, no numbers exist yet. This
> document is the *design* of Irlo's data-driven product loop. Every table below is
> planned; the pipeline itself is a later ADR (see `NEXT_STEPS.md`).

## Why this exists

"Data-driven" is a claim that needs machinery: a metric worth moving, guardrails that
catch harm, an event schema decided before code, and a repeatable experiment loop.
This doc defines all four so Stage 1+ features ship with instrumentation from day one.

## North-star metric — candidate set

The north star is deliberately **not chosen yet**. Candidates, with trade-offs:

| Candidate | What it captures | Risk if chosen |
|---|---|---|
| Weekly show-ups per active member | The mission itself — people meeting in person | Requires an attendance signal we have not designed |
| Activities joined per weekly active member | Intent to meet; measurable from day one | Rewards joining, not showing up — can drift from mission |
| First show-up rate (% of new members attending ≥1 activity within 14 days) | Activation quality; leading indicator of retention | Same attendance-signal dependency; small-n noise early |

`TODO(decide): pick the north-star metric from the candidate set above before Stage 1 analytics work begins.`

`TODO(decide): how attendance ("show-up") is measured — host check-in, geofenced confirmation, self-report, or a combination.`

## Guardrail metrics

Metrics that must not regress while we optimize the north star. All planned; thresholds
arrive with the ADR-0007 SLO/error-budget sketch.

- **p95 API latency and error rate** — per route; SLO targets set in ADR-0007 work.
- **Crash-free session rate (iOS)** — a growth win that crashes the client is a loss.
- **Report/safety-flag rate per activity** — in-person products carry real-world risk.
- **Refund rate per rail** — monetization pressure must not produce regret purchases.
- **Notification opt-out rate** — US-13 pushes must earn their interruptions.
- **Admission wait time** — the US-01/US-02 funnel must stay fair and responsive.

## Event tracking schema (planned)

Conventions, decided now so Stage 1 code has no ambiguity:

- Event names are `snake_case`, past tense, product-meaningful (`swipe_performed`).
- Every event payload is a zod schema in `@irlo/contracts` (planned) — validated at the
  boundary like any other contract.
- No PII in properties. User identifiers are hashed; free-text content never leaves the
  product datastore for analytics.
- Every event carries standard envelope fields: hashed user id, session id, platform,
  app/server version, timestamp. The table lists distinguishing properties only.

<details>
<summary>Event schema table — key actions across US-01…US-13</summary>

| Event | Distinguishing properties | Fired from | Story |
|---|---|---|---|
| `application_submitted` | `crew_id`, `application_id` | server (API) | US-01 |
| `application_state_changed` | `application_id`, `from_state`, `to_state` | server | US-01, US-02 |
| `admission_decided` | `application_id`, `decision` | server | US-02 |
| `acceptance_notified` | `application_id`, `channel` | server | US-02 |
| `entitlement_granted` | `entitlement`, `source_rail` (`app_store`\|`stripe`\|`admission`) | server | US-02, US-08, US-09 |
| `deck_viewed` | `card_count`, `latency_ms` | iOS | US-03 |
| `deck_card_impression` | `activity_id`, `position`, `distance_bucket` | iOS | US-03 |
| `swipe_performed` | `activity_id`, `direction` (`right`\|`left`) | iOS | US-04 |
| `swipe_undone` | `activity_id`, `undo_credits_remaining` | server | US-04 |
| `activity_detail_viewed` | `activity_id`, `source` (`deck`\|`chat`\|`push`) | iOS | US-05 |
| `directions_opened` | `activity_id` | iOS | US-05 |
| `chat_message_sent` | `room_id`, `offline_queued` (bool) | server | US-06 |
| `chat_backlog_synced` | `room_id`, `message_count` | iOS | US-06, US-12 |
| `checkout_started` | `product_id`, `rail` | iOS / web | US-07, US-08, US-09 |
| `purchase_completed` | `product_id`, `rail`, `transaction_dedupe_key` | server | US-07, US-08, US-09 |
| `purchase_failed` | `product_id`, `rail`, `failure_stage` | server | US-07, US-08, US-09 |
| `subscription_state_changed` | `subscription_id`, `from_state`, `to_state`, `rail` | server | US-08, US-09, US-10 |
| `refund_processed` | `product_id`, `rail` | server | US-10 |
| `billing_retry_recovered` | `subscription_id`, `rail` | server | US-10 |
| `activity_created` | `activity_id`, `validation_error_count` | server | US-11 |
| `draft_autosaved` | `draft_id` | iOS | US-11 |
| `offline_cache_hit` | `surface` (`deck`\|`chat`), `cache_age_bucket` | iOS | US-12 |
| `push_sent` | `type` (`starting_soon`), `activity_id` | server | US-13 |
| `push_opened` | `type`, `deep_link_target` | iOS | US-13 |

</details>

Server events fire from the domain layer (the state machine or service, not the HTTP
handler) so every rail and every retry path is covered. iOS events fire from
ViewModels, keeping SwiftUI views instrumentation-free.

## Experimentation workflow

Every product experiment follows the same loop. Nothing ships behind a hunch.

1. **Hypothesis** — one falsifiable sentence: expected metric movement, the guardrails
   that must hold, and the minimum effect worth acting on.
2. **RFC** — open one from [`docs/rfc/0000-template.md`](../rfc/0000-template.md). The
   Rollout section names the flag and the success metric; review happens in public.
3. **Flag** — the change ships dark behind a feature flag (ADR-0007), enabling staged
   exposure and instant revert.
4. **Analysis** — compare against the pre-registered decision rule, check guardrails,
   then update the RFC status with the verdict and the follow-up.

**Honesty note:** at portfolio scale, traffic will rarely support statistically
significant A/B results. Early "experiments" therefore prove the *method* — flags,
pre-registration, guardrail checks, written verdicts — and lean on qualitative signal.
The doc says so rather than inventing significance.

## Payments metrics — tie-in to `docs/monetization.md`

The monetization design ([`docs/monetization.md`](../monetization.md)) defines the
catalog and the dual-rail architecture; these are the metrics that judge it. All are
derivable from the event schema above — no separate payments tracking system.

- **Conversion, per rail** — `checkout_started` → `purchase_completed`, segmented by
  `product_id` and `rail`. The dual-rail design (US-07/08/09) makes rail comparison a
  first-class question, not an afterthought.
- **ARPPU** — revenue per paying member, computed from the append-only payments ledger
  (the ledger, not events, is the financial source of truth; events are directional).
- **Involuntary-churn recovery** — `billing_retry_recovered` ÷ subscriptions entering
  `billing-retry` (US-10). This is the dunning design's success metric.
- **Refund rate, per rail** — `refund_processed` over `purchase_completed`; a guardrail
  shared with the table above.

The nightly reconciliation job (ADR-0004) doubles as the data-quality backstop: if
ledger, provider, and event counts disagree, the metrics are quarantined until the
mismatch is explained (see `docs/runbook.md`, reconciliation section).
