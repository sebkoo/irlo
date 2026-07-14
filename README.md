<div align="center">

# Irlo

**Swipe into real life.**

*A backend-first, open-source platform for discovering and joining nearby
in-person activities — run crews, gallery nights, pickup games.*

[![CI](https://github.com/sebkoo/irlo/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/irlo/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/sebkoo/irlo/branch/main/graph/badge.svg)](https://codecov.io/gh/sebkoo/irlo)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A524-339933?logo=node.js&logoColor=white)](.mise.toml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![Swift](https://img.shields.io/badge/Swift-6-F05138?logo=swift&logoColor=white)](apps/ios/project.yml)
[![Platform](https://img.shields.io/badge/iOS-17%2B-black?logo=apple)](apps/ios/project.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*Honest badge scope: coverage is CI-gated (`server/src` ≥ 90%; payments +
admission state machines 100% branch) and today measures the server foundation
plus the ADR-0009 payments domain — a real number, not proof the whole design
is built. What runs vs. what's design-stage is labeled in
[Start here](#start-here).*

</div>

---

## Table of contents

- [Start here](#start-here)
- [What's inside](#whats-inside)
- [Why Irlo](#why-irlo)
- [Architecture](#architecture)
- [Engineering quality](#engineering-quality)
- [How this is built](#how-this-is-built)
- [Roadmap](#roadmap)
- [Getting started](#getting-started)
- [Monetization design](#monetization-design)
- [Contributing](#contributing)
- [FAQ](#faq)
- [License](#license)

## Start here

**Implemented and tested on `main` today** — the entitlement domain
([ADR-0009](docs/adr/0009-entitlement-domain-model.md)) and the Stripe side of
the payments rail, landed as reviewed TDD triplets:

- **Stripe webhook machinery** — signature verification, event normalization,
  and four idempotent event consumers (purchases, subscription economic
  events, multi-fact context envelopes, consumable refunds) in
  [`server/src/payments/`](server/src/payments/); the HTTP endpoint is the
  slice in flight ([`NEXT_STEPS.md`](NEXT_STEPS.md))
- **Entitlement persistence** — append-only ledger, the seven-table ADR-0009
  schema as Testcontainers-verified Drizzle migrations, typed repositories in
  [`server/src/db/`](server/src/db/)
- **Subscription state machine** — a pure transition function in
  [`server/src/domain/`](server/src/domain/)
- **Server foundation** — Fastify app factory, `/health`, zod-parsed env
  config, pino structured logging, dockerized dev env

Three links that show *how* it's built, not just what:

1. **A red→green pair:**
   [`test(payments): failing spec for the context-event executor`](https://github.com/sebkoo/irlo/commit/43914db7249fce118813822f18b337c27a628764)
   → [`feat(payments): implement the context-event executor`](https://github.com/sebkoo/irlo/commit/8d6adc7f94d891edf9c1258ab6b0d6420a03223f)
   — the failing spec lands first, every time; the history reads like this
   throughout.
2. **The decision record behind it:**
   [ADR-0009 — entitlement domain model](docs/adr/0009-entitlement-domain-model.md)
   — states, guards, idempotency, and reconciliation pinned down *before* the
   code.
3. **The review loop leaving fingerprints:**
   [`fix(payments): rename consumeContextEvent, wire renewal_extended's periodEnd (review SHOULD-FIX x2)`](https://github.com/sebkoo/irlo/commit/68890d18f8ee1becb3d034f3edc4fa06aed88110)
   — code-reviewer findings land as their own commits, not silent amends.

## What's inside

| Tier | What | Where | Evidence |
|---|---|---|---|
| **Platform** (Node.js/TypeScript) | Payments dual-rail (StoreKit 2 + Stripe), provider-agnostic entitlements, admission/waitlist state machine, realtime chat, Deck feed API | [`server/`](server/) · [`packages/contracts/`](packages/contracts/) | [ADR-0004](docs/adr/0004-payments-platform.md) · [ADR-0005](docs/adr/0005-member-experience-core.md) · [ADR-0009](docs/adr/0009-entitlement-domain-model.md) *(entitlement core + Stripe consumers implemented — [Start here](#start-here); StoreKit rail, admission, chat, Deck are [planned](NEXT_STEPS.md))* |
| **Clients** | Swift 6 iOS app (UIKit shell + SwiftUI), React Native brownfield screen *(planned)* | [`apps/ios/`](apps/ios/) | [ADR-0008](docs/adr/0008-ios-demo-client.md) · canary tests (XCTest/XCUITest) wired into CI |

Today the repo carries Stage 0's verified name, canary-tested monorepo, CI,
AI-native engineering harness, and full design record; a live server
foundation; and the ADR-0009 entitlement domain + Stripe event consumers,
landed as reviewed TDD triplets ([Start here](#start-here)). Everything beyond
that is planned in [`NEXT_STEPS.md`](NEXT_STEPS.md) — nothing is quietly
half-built.

## Why Irlo

Loneliness is now a measured global health issue, not a mood. The WHO Commission
on Social Connection reports that **1 in 6 people worldwide is affected by
loneliness**, linked to an estimated 100 deaths every hour ([WHO, June
2025](https://www.who.int/news/item/30-06-2025-social-connection-linked-to-improved-heath-and-reduced-risk-of-early-death)).
In the US, **21% of adults report feeling lonely** — rising to 34% among young
adults — and 73% of respondents point at technology as a cause ([Harvard Making
Caring Common, May 2024](https://mcc.gse.harvard.edu/reports/loneliness-in-america-2024)).
Full citation records: [`docs/research/citations.md`](docs/research/citations.md).

The gap isn't matching people online — apps do that relentlessly. The gap is
**showing up offline**: the run crew that actually meets on Saturday, the
gallery night that actually happens. Irlo's mechanics point every interaction at
a real place and time: swipe into an activity, clear a crew's waitlist, chat
with the people who'll be there.

Irlo exists to help people spend more of their lives in quality, in-person
interaction — and, as an open-source project, to show exactly how the systems
behind that promise are engineered.

## Architecture

```mermaid
flowchart TB
  subgraph clients ["Clients"]
    IOS["iOS app (Swift 6)<br/>UIKit shell + SwiftUI<br/>RxSwift Deck · Combine new modules<br/>CoreData · MapKit · StoreKit 2"]
    WEB["Web checkout (planned)<br/>Stripe Checkout"]
    RN["RN Events screen (planned)"]
  end

  subgraph backend ["Backend — Node 24 · TypeScript strict · Fastify"]
    API["REST API<br/>zod contracts"]
    WS["WebSocket gateway<br/>rooms · presence"]
    ENT["Entitlement service<br/>one source of truth"]
    ADM["Admission state machine<br/>apply → waitlist → accept"]
    PAY["Webhook consumers<br/>StoreKit 2 · Stripe<br/>idempotent · at-least-once"]
    JOBS["BullMQ jobs<br/>reconciliation · notifications"]
  end

  subgraph data ["Data"]
    PG[("Postgres<br/>+ append-only ledger")]
    RD[("Redis<br/>presence · queues · rate limits")]
  end

  IOS --> API
  IOS <--> WS
  WEB --> PAY
  RN --> API
  API --> ENT
  API --> ADM
  PAY --> ENT
  ENT --> PG
  ADM --> PG
  PAY --> PG
  WS --> RD
  JOBS --> PG
  JOBS --> RD
```

*The diagram is the full design. What runs today vs. what's design-stage is
labeled in [Start here](#start-here); the trail from decision to code is
[docs/adr/](docs/adr/README.md).*

| Read the code / design | Entry point |
|---|---|
| ADR index (the architecture tour) | [`docs/adr/README.md`](docs/adr/README.md) |
| Contracts-first API shapes | [`packages/contracts/src/`](packages/contracts/src/) |
| Payments platform design | [ADR-0004](docs/adr/0004-payments-platform.md) |
| Entitlement domain model (states · ledger · idempotency) | [ADR-0009](docs/adr/0009-entitlement-domain-model.md) |
| Admission/waitlist design | [ADR-0005](docs/adr/0005-member-experience-core.md) |
| User stories → tests → evidence | [`docs/user-stories.md`](docs/user-stories.md) |

## Engineering quality

**Why this looks like production, not a demo:**

- **TDD triplets.** Every feature: `test(scope): failing spec` →
  `feat(scope): make it pass` → `refactor(scope): …`. The payments domain
  landed this way commit by commit ([Start here](#start-here)); even the first
  iOS canary quotes its own red run (`type 'RootView' has no member
  'accessibilityID'`) before the green.
- **Coverage gates in CI:** `server/src` ≥ 90%; payments + admission state
  machines require 100% branch; iOS kit ≥ 85% as it grows.
- **Contract-first APIs:** zod schemas in
  [`packages/contracts`](packages/contracts/) are the single source of truth —
  server derives types from them and validates every boundary at runtime.
- **CI matrix:** Ubuntu (typecheck · lint · format · Vitest+coverage) and
  macOS 26 (XcodeGen → XCTest/XCUITest on a dynamically-resolved simulator),
  Codecov flags `server`/`ios`.
- **Observability as a deliverable:** pino structured logs live on the
  `/health` endpoint onward; OpenTelemetry traces next
  ([ADR-0003](docs/adr/0003-backend-platform.md), planned).
- **Atomic, explained commits:** Conventional Commits 1.0; bodies explain *why*;
  history reads as a plan, not an accident — inspect `git log`.

## How this is built

AI-assisted, in public, with Claude Code — and every line is reviewed before
it lands: the AI is the typist, the engineer stays accountable. The workflow
itself is versioned, auditable engineering: a <300-line
[`CLAUDE.md`](CLAUDE.md) constitution, eight encoded slash-command workflows,
format/lint/test hooks, a code-reviewer subagent whose findings land as their
own commits, and a release-blocking [eval checklist](docs/ai/evals.md) for the
harness itself. [`docs/ai/methodology.md`](docs/ai/methodology.md) discloses
models and effort per work type — including seven recorded self-enforcement
cases where the harness (or the human) caught the tool cutting a corner. That
governance isn't an apology; it's one of the things this repo is built to
demonstrate.

## Roadmap

| Horizon | Work |
|---|---|
| **Now** | Stage 0 done: verified name · toolchain · canary-tested monorepo · CI · AI harness · design record (ADR 0001–0009). Server foundation live: `/health` · env config · logging · dockerized dev env · Drizzle + Testcontainers. Landed: ADR-0009 entitlement domain + Stripe event consumers ([Start here](#start-here)) |
| **Next** | Stripe webhook endpoint online · OpenTelemetry bootstrap · admission & waitlist (US-01/02) — order of record in [`NEXT_STEPS.md`](NEXT_STEPS.md) |
| **Later** | App Store rail → reconciliation → Deck feed → chat gateway → iOS flows → web checkout → RN screen → pgvector ranking. The 30-second demo GIF ships with the first user-facing milestone (v0.1.0) |

Full sequence with commit-level granularity: [`NEXT_STEPS.md`](NEXT_STEPS.md).

## Getting started

```bash
git clone https://github.com/sebkoo/irlo.git && cd irlo
make bootstrap
make test
```

Then: `pnpm --filter @irlo/server test:watch` for the server loop, or
`open apps/ios/Irlo.xcodeproj` (generated by bootstrap) for the iOS client.
Details: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Monetization design

Consumable boosts (`spark.*`, `waitlist.skip`, `undo.pack10`) and an **Irlo+**
subscription, sold on two rails — StoreKit 2 in-app and Stripe on the web —
feeding one provider-agnostic entitlement service with an append-only ledger and
nightly reconciliation. It's a payments-engineering showcase first; the design
doc is [`docs/monetization.md`](docs/monetization.md), the architecture is
[ADR-0004](docs/adr/0004-payments-platform.md).

## Contributing

PRs welcome — start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[good-first-issue template](.github/ISSUE_TEMPLATE/good-first-issue.yml).
Every user-story PR ships tests and evidence
([`docs/user-stories.md`](docs/user-stories.md)). We follow the
[Contributor Covenant](CODE_OF_CONDUCT.md); security reports:
[`SECURITY.md`](SECURITY.md).

## FAQ

<details>
<summary><b>Is Irlo a dating app?</b></summary>

No. Irlo is activity-first: you join a run crew or a gallery night, not a
person's inbox. The admission/waitlist mechanics exist to keep small groups
good, not to gate romance.
</details>

<details>
<summary><b>Why build the payments stack instead of using RevenueCat?</b></summary>

Because demonstrating the machinery is this repo's purpose. RevenueCat is the
pragmatic choice for many teams — the honest build-vs-buy analysis is in
[`docs/monetization.md`](docs/monetization.md).
</details>

<details>
<summary><b>Can I run the backend without the iOS toolchain?</b></summary>

Yes. `make test-server` needs only mise (Node/pnpm). Xcode is required only for
`make test-ios` and the app itself.
</details>

<details>
<summary><b>What does "Irlo" mean?</b></summary>

A coined word: IRL + o, pronounced /ˈɜːr.loʊ/. In Korean it puns on 일로 (와) —
"come over here." Name verification evidence:
[`docs/naming/verification.md`](docs/naming/verification.md).
</details>

<details>
<summary><b>Is this affiliated with any existing membership app?</b></summary>

No — see the disclaimer below. The Member Experience domain (applications,
waitlists, entitlements) is an industry-standard pattern studied on public
information.
</details>

## License

[MIT](LICENSE) © 2026 Ben Koo

---

> **Non-affiliation disclaimer:** Irlo is an independent, open-source portfolio
> project. It is not affiliated with, endorsed by, or connected to Raya or any
> other membership platform. Competitive/product research references appear only
> in [`docs/interview/`](docs/interview/) as personal study notes.
