# CLAUDE.md — Irlo engineering guide

Irlo ("Swipe into real life") is a backend-first, open-source platform for discovering and
joining nearby in-person activities — run crews, gallery nights, pickup games. The repo is
engineered to demonstrate, line by line, every competency in Raya's Senior Backend Engineer
(Member Experience) JD, while staying a real, runnable system. Irlo is an independent
portfolio project, not affiliated with Raya.

## Project map

| Path | What it is |
|---|---|
| `server/` | Node 24 + TypeScript strict backend — **the headline**. Fastify + Drizzle arrive in Stage 1 (ADR-0003). |
| `packages/contracts/` | zod schemas — single source of truth for API shapes (compile-time types + runtime validation). |
| `apps/ios/` | Swift 6 demo client. `project.yml` (XcodeGen) is the source of truth; `Irlo.xcodeproj` is generated, never committed. |
| `docs/` | ADRs, RFCs, user stories, interview prep, monetization, AI methodology, evidence media. |
| `NEXT_STEPS.md` | The only place Stage 1+ work exists. Nothing beyond the current stage gets implemented. |

Entry points: `make bootstrap` · `make test` · `make lint`. CI runs the same commands.

## JD-competency matrix (encode of §0 — verbatim)

| JD requirement | Repo evidence (planned) |
|---|---|
| Node.js + TypeScript mastery | `server/` strict TS, typed contracts package, production patterns (below) |
| System design & architecture | ADR suite + `docs/interview/design-drills.md` + Mermaid diagrams |
| Scaling backend systems in production, startup pace | Observability, load-test plan, idempotency, queues, weekly shippable milestones |
| Production StoreKit payments/subscriptions | App Store Server API v2 client, JWS verification, Server Notifications V2 consumer, StoreKitTest-backed client flows |
| Production Stripe payments/subscriptions (B2C) | Checkout + Billing + signed webhooks, test clocks, dunning/involuntary-churn design |
| Full SDLC, agile, CI/CD | Trunk-based flow, CI matrix, feature flags, release tags + changelog, runbook stub |
| Cross-functional & user-centric, data-driven | Event tracking schema, experimentation doc, RFC template, feedback-loop design |
| Enthusiasm for new AI tools | §7 AI-native methodology + server-side AI features (embeddings ranking, moderation) |

## Conventions

### TypeScript (server, contracts)
- Strict everything — the flags live in `tsconfig.base.json`; never weaken them per-file.
- **No `any`** (lint-enforced). No type assertions to silence errors; fix the type.
- API shapes are **never hand-written** — import from `@irlo/contracts`; zod-validate at every boundary (HTTP, queue, webhook, env).
- ESM + NodeNext: relative imports carry `.js` extensions.
- Errors: typed, thrown only at boundaries; domain code returns discriminated unions.
- Structured logging only (pino, Stage 1+); never `console.log` in committed code.

### Swift (apps/ios)
- Swift API Design Guidelines; **no force-unwraps** (`force_unwrapping` lint rule is on).
- UIKit shell + coordinator; screens in SwiftUI via `UIHostingController` (ADR-0008).
- UI-test hooks are stable `accessibilityID` constants on the view type — never display text.

## TDD protocol (§6)

Strict red → green → refactor. Commit triplets:
1. `test(scope): failing spec for X` — the red run is quoted in the commit body.
2. `feat(scope): make X pass`
3. `refactor(scope): …` (optional but preferred)

- Backend: Vitest unit; supertest integration per endpoint; contract tests from `@irlo/contracts`; Stripe webhooks via signed fixture events + test clocks; App Store notifications via JWS fixtures; Testcontainers-Postgres for repositories.
- iOS: XCTest for ViewModels/repositories; one XCUITest journey per client story; swift-snapshot-testing for Deck cards & paywall; StoreKitTest with a local `.storekit` config.
- Coverage gates (CI): `server/src` ≥ 90% (payments + admission state machines: 100% branch), `IrloKit` ≥ 85%. Badges appear only when real.
- Every user story (`docs/user-stories.md`) maps to named tests **before** implementation — the PR template enforces it.

## Commit grammar

- Conventional Commits 1.0; imperative subject ≤ 72 chars; body explains **why**.
- One logical concern per commit; every commit leaves `make test` green once targets exist.
- Correcting an unpushed planned commit: `git commit --fixup <target>` then
  `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>` — never a stray fix commit.
- Never force-push. Ask before any push to a remote.

## Model routing (§1)

| Activity | Model | Effort | Mode |
|---|---|---|---|
| Naming/prior-art verification | Opus 4.8 (or Fable 5) | xhigh | Plan Mode → execute |
| Architecture, ADRs, payments/domain design | Opus 4.8 (or Fable 5) | xhigh (+ ultrathink on trade-offs) | Plan Mode |
| Mechanical scaffolding (configs, templates) | Sonnet 5 | medium | normal |
| Canary tests, CI workflows | Sonnet 5 | high | normal |
| README / docs copywriting | Opus 4.8 | high | normal |
| Final self-review subagent | Opus 4.8 | high | subagent |

Announce the active row before each phase; if the session model differs, proceed and note what
would have been used. **Never downgrade** on ADRs, payments design, or naming verification.

## Definition of done

- `make test` green (server Vitest + iOS canaries); lint and format clean; coverage gates met.
- Contract-first: schema exists before the endpoint; failing test before implementation.
- Evidence captured per story (`docs/media/us-XX-*`) and attached to the PR.
- Docs updated where the change demands it (ADR, README, user stories, runbook).
- Commits atomic and conventional; README still 100% truthful.

## Never do (§2)

- Implement beyond the current stage boundary — later work goes to `NEXT_STEPS.md`.
- Put a false claim, badge, metric, or screenshot in the README; label every placeholder.
- Star-farm, fake accounts, or engagement bait — growth is `docs/growth.md`, ethically.
- Reuse Raya branding/assets; reference Raya only inside `docs/interview/`.
- Introduce GPL-contaminated or copied proprietary code (MIT repo).
- Commit secrets — `.env.example` placeholders only; payments keys always test-mode/sandbox.
- Edit `LICENSE` or `docs/naming/` (immutable evidence — hook-enforced).

## Pointers

Deep dives live outside this file: `docs/ai/methodology.md` (the loop), `docs/ai/evals.md`
(release-blocking harness checks), `docs/adr/` (architecture), `docs/monetization.md`
(payments catalog), `docs/interview/` (JD mapping, drills, study map).
