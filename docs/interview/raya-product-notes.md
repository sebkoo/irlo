# Raya product notes — Member Experience domain study

> **Internal interview-prep notes.** Raya facts below were recorded from the
> official App Store listing on 2026-07-10, for domain study only. Raya is
> referenced only inside `docs/interview/`. Irlo is an independent, unaffiliated
> portfolio project — it is not a Raya clone, and it is not a dating app.

## What the listing says (recorded 2026-07-10)

- Membership community for **dating, networking, and friendship**.
- Access via an **application → waitlist → acceptance** funnel.
- **1/6/12-month auto-renewing memberships**.
- Live IAP catalog (exact prices below).
- **iOS 17.0+**, visionOS support, roughly **weekly release cadence**.
- **4.0★ across ~15K ratings**; Lifestyle category, 18+.
- Vision to echo, never copy: enrich lives by fostering relationships through
  quality in-person interactions.

### Live IAP catalog

| Product | Price |
|---|---|
| Membership (monthly) | $24.99 |
| Membership (annual) | $113.99 |
| Raya+ Membership | $49.99 |
| Skip the Wait | $7.99 |
| Skip the Wait ×3 | $19.99 |
| Skip the Wait ×5 | $29.99 |
| Direct Request | $4.99 |
| Direct Request ×3 | $12.99 |
| 30 Extra Likes | $10.99 |

Derived note: annual ($113.99) is ~62% below 12× monthly ($299.88) — a strong
push toward annual commitment. Worth raising in pricing conversations.

## What each fact implies for a Member Experience backend

Mapping listing facts to the concepts Irlo studies. All Irlo artifacts are
Stage 1+ and planned.

| Listing fact | Backend implication | Irlo study artifact (planned) |
|---|---|---|
| Application → waitlist → acceptance funnel | An admission state machine with review queues, status transitions, notifications, and an audit trail; fairness and throughput are product features | ADR-0005 admission system; US-01/US-02 |
| 1/6/12-month auto-renewing memberships | Full subscription lifecycle server-side: renewals, grace, billing retry, expiry, refunds; server is the source of truth via App Store Server API v2 + Server Notifications V2 | ADR-0004 subscription state machine; `irlo.plus.monthly` / `irlo.plus.yearly` analogs |
| Raya+ premium tier alongside base Membership | Tiered entitlements: upgrade/downgrade paths, subscription groups, capability gating per tier | ADR-0004 provider-agnostic entitlement service |
| Skip the Wait consumable (single + packs) | Paid queue priority interacts directly with admission fairness; crediting must be idempotent and ledgered | `waitlist.skip` analog; ADR-0004 ledger + ADR-0005 fairness notes |
| Direct Request, 30 Extra Likes consumables | Visibility/interaction consumables: quota enforcement, spend tracking, refund handling on consumed goods | `spark.single` / `spark.pack5`, `undo.pack10` analogs |
| ×3 / ×5 pack pricing | Catalog and SKU modeling with per-unit discount rationale | `docs/monetization.md` price-point rationale |
| iOS 17.0+ / visionOS | StoreKit 2-era APIs are the safe baseline (JWS-verified transactions, `Transaction.currentEntitlements`) | ADR-0008 StoreKit 2 client; Irlo also targets iOS 17.0+ |
| ~Weekly release cadence | Startup pace demands trunk-based delivery, feature flags, backward-compatible APIs, zero-downtime migrations | ADR-0007 SDLC; drill ⑧ |
| 4.0★ / ~15K ratings, 18+ Lifestyle | Member-experience quality is reputational; trust, safety, and abuse prevention are backend concerns | Planned LLM-assisted moderation ADR; drill ⑦ |

## Talking-point summary

The listing is, end to end, the Member Experience domain: **admission** (the
funnel plus paid skips) and **entitlements** (memberships, tiers, consumables).
Irlo generalizes both mechanics — crews instead of dating, activities instead of
matches — so every payments and admission conversation can point at code and
ADRs rather than hypotheticals. Echo the vision in your own words: software that
gets people into quality in-person interactions.
