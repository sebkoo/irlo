# Architecture Decision Records

MADR-format records created via `/adr-new` (template enforced; every ADR ends
with a "Future trends & implications" section). Statuses: proposed → accepted →
superseded-by link. This index is the architecture tour — read top to bottom.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions (MADR + Irlo extensions) | accepted |
| [0002](0002-monorepo-and-toolchain.md) | Monorepo & toolchain: pnpm workspaces, zod contracts, XcodeGen+SPM | accepted |
| [0003](0003-backend-platform.md) | Backend platform: Node 24 + TS strict, Fastify + Drizzle, Postgres/Redis/BullMQ | accepted |
| [0004](0004-payments-platform.md) | Payments: dual rail (StoreKit 2 + Stripe) → one entitlement truth | accepted |
| [0005](0005-member-experience-core.md) | Member Experience: admission state machine, capability gating, audit | accepted |
| [0006](0006-realtime-messaging.md) | Realtime messaging: WebSocket gateway, presence, scale path | accepted |
| [0007](0007-sdlc-and-operational-excellence.md) | SDLC & ops: trunk-based, CI/CD, Docker dev, Fly.io staging, SLOs, k6 | accepted |
| [0008](0008-ios-demo-client.md) | iOS demo client: UIKit shell + SwiftUI, RxSwift⇄Combine, CoreData, StoreKit 2 | accepted |
| [0009](0009-entitlement-domain-model.md) | Entitlement domain model: state machines, unified ledger, idempotency, reconciliation | accepted |

Planned future ADRs are queued in [`NEXT_STEPS.md`](../../NEXT_STEPS.md)
(geo indexing, feature-flag service, RevenueCat build-vs-buy, server-side AI
features, RN brownfield integration, analytics pipeline).
