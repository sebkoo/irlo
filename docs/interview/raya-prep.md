# Raya interview prep — Senior Backend Engineer, Member Experience

> Internal interview-prep notes. Raya is referenced only inside `docs/interview/`.
> Irlo is an independent portfolio project, not affiliated with Raya.

The strategy: every Irlo commit is an exhibit. This doc maps the expected loop,
the daily plan, and the JD bullets to those exhibits. Companion docs:
`study-map.md`, `design-drills.md`, `raya-product-notes.md`.

## Expected interview loop

Assumed shape — confirm each stage with the recruiter and adjust.

| Stage | Format | Lead with |
|---|---|---|
| 1. Recruiter screen | Call | 90-second pitch: 6+ years, payments/membership systems ownership, Irlo as living portfolio |
| 2. Technical deep-dive / live coding | Node/TS | Strict-TS habits from `server/` — typed contracts, discriminated unions, TDD reflexes |
| 3. System design | Whiteboard | ADR-0004 payments platform (planned) and ADR-0005 admission system (planned) — drills ① and ② |
| 4. Architecture & leadership deep-dive | Conversation | ADR trade-off tables, RFC/review culture, migration stories, mentoring |
| 5. Values / behavioral | Conversation | In-person connection: why Irlo exists; quality of interaction over volume |

## 4-week daily plan

Interleave repo commits (evidence) with drills (delivery). All repo work is
Stage 1+ and therefore planned, ordered backend-first per `NEXT_STEPS.md`.

**Every day:** one TypeScript problem (study map row 4) · 30 min of Stripe or
App Store Server API docs (alternate days) · one TDD triplet commit toward the
week's repo focus · a one-line velocity note.

**Every week:** two design drills from `design-drills.md` · one mock interview ·
one production-codebase reading hour (study map rows 10–14) · one tagged release
(bias toward shipping).

| Week | Repo focus (planned commits) | Design drills | Mock theme |
|---|---|---|---|
| 1 | Admission/waitlist state machine + entitlement service | ② admission · ⑦ rate limiting | Behavioral baseline + recruiter pitch |
| 2 | Stripe rail: Checkout, Billing, signed webhooks, test clocks | ① payments platform · ⑥ webhooks | Payments system design |
| 3 | App Store Server Notifications rail + reconciliation; Deck feed start | ③ Deck feed · ⑤ geo search | Admission/waitlist system design |
| 4 | Chat gateway; polish + evidence capture | ④ chat fan-out · ⑧ migrations | Full loop dry run (design + behavioral) |

## "What Sets You Apart" mapping

| Trait | Repo artifact |
|---|---|
| Visionary | Roadmap + "future trends & implications" section closing every ADR (planned) |
| Empathetic Leader | RFC/review culture docs, `CODE_OF_CONDUCT.md` |
| Growth-oriented | The study-map habit (`study-map.md`) — scheduled, not aspirational |
| Impact-driven | `NEXT_STEPS.md` ordered by impact, backend-first |
| Productivity-obsessed | AI-native harness (`docs/ai/methodology.md`) + velocity notes per story |
| Bias toward shipping | Weekly tagged releases, small atomic commits |

## JD bullet → repo evidence → STAR story

Framing for the 6+ years bar: lead every answer with **ownership of scalable
systems** — scale numbers, blast radius, decisions you drove. Features come
second, as proof the ownership shipped. Order below reflects that.

STAR cells are structured prompts. Fill them from real experience only — never
invent biography.

| JD bullet | Repo evidence (planned unless noted) | STAR story |
|---|---|---|
| Scaling backend systems in production, startup pace | Observability, load-test plan (k6), idempotency, queues, weekly shippable milestones | TODO(fill: your story) — S: system + traffic/scale numbers; T: what you owned; A: the scaling decision you drove; R: quantified result |
| System design & architecture | ADR suite + `design-drills.md` + Mermaid diagrams | TODO(fill: your story) — S: architecture at an inflection point; T: your mandate; A: trade-off you called and how you socialized it; R: outcome + what you'd revisit |
| Node.js + TypeScript mastery | `server/` strict TS (exists, Stage 0), typed contracts package (exists), production patterns | TODO(fill: your story) — S: a gnarly TS/Node production issue; T: why it landed on you; A: root cause + fix; R: measurable improvement |
| Production StoreKit payments/subscriptions | App Store Server API v2 client, JWS verification, Server Notifications V2 consumer, StoreKitTest flows | TODO(fill: your story) — S: IAP/subscription system you ran; T: correctness/revenue stakes; A: verification/entitlement design; R: revenue or defect metric |
| Production Stripe payments/subscriptions (B2C) | Checkout + Billing + signed webhooks, test clocks, dunning/involuntary-churn design | TODO(fill: your story) — S: Stripe (or equivalent) billing at scale; T: your ownership; A: webhook/idempotency/churn work; R: recovered revenue or reliability number |
| Full SDLC, agile, CI/CD | Trunk-based flow, CI matrix (exists, Stage 0), feature flags, release tags + changelog, runbook stub | TODO(fill: your story) — S: delivery process you inherited; T: pace target; A: pipeline/process change; R: cycle-time or release-frequency delta |
| Cross-functional & user-centric, data-driven | Event tracking schema, experimentation doc, RFC template, feedback-loop design | TODO(fill: your story) — S: product decision needing data; T: your role across functions; A: instrumentation/experiment you built; R: decision changed by the data |
| Enthusiasm for new AI tools | `docs/ai/methodology.md` harness + planned embeddings ranking and moderation | TODO(fill: your story) — S: where you adopted a new AI tool early; T: skepticism to overcome; A: how you evaluated and integrated it; R: velocity or quality gain |

Target from study map row 3: **two** STAR stories per bullet before week 4's mock.
