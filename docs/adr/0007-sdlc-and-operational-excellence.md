# 0007 — SDLC and operational excellence

- Status: accepted
- Date: 2026-07-10
- Deciders: Ben Koo

## Context and problem statement

The target JD asks for full-SDLC ownership: CI/CD, operational excellence, and startup pace.
Today the repo has Stage-0 scaffolding and PR-level CI checks (typecheck, lint, tests, coverage
on ubuntu-latest + macos-26 with Codecov flags `server`/`ios`). Everything past those checks is
planned. This ADR fixes the branching model, the CI/CD promotion path, the dev environment, the
staging platform, feature flagging, SLOs and error budgets, alerting, the runbook, and the
load-test plan — so later stages execute a recorded plan instead of improvising one.

## Decision drivers

- **D1 — Velocity**: a solo/small team merging to `main` daily, shipping weekly tagged releases.
- **D2 — Safety without ceremony**: automated gates over process; no branch bureaucracy.
- **D3 — Production realism**: choices a senior interviewer would accept for a real B2C service.
- **D4 — Cost floor**: staging for a portfolio project must idle at near-zero spend.
- **D5 — Reversibility**: platform choices stay swappable behind `make`/CI abstractions.

## Considered options

Branching model:

1. **Trunk-based development, short-lived branches** — chosen
2. GitFlow (`develop` + release branches)
3. Release-branch model (stabilization branches per release)

Staging platform:

4. **Fly.io** — chosen
5. Railway
6. Render

Feature flags: env-based now (chosen), graduating later to a flag service — see outcome.

## Decision outcome

- **Trunk-based development**: `main` is always releasable; branches live hours-to-a-day; there
  is **no `develop` branch**. PR checks plus coverage gates (`server/src` ≥ 90%, payments and
  admission state machines 100% branch, `IrloKit` ≥ 85%) are the merge gate. Incomplete work
  hides behind flags, never behind long-lived branches.
- **CI/CD promotion path** (PR checks exist today; the rest is planned):
  PR checks → merge to `main` → **staging autodeploy** (Fly.io) → **manual production gate**
  (a tagged release deploys to production after explicit approval). Rollback is a redeploy of
  the previous image; images are immutable and tagged by commit SHA.
- **Dev environment (Stage 1+)**: Docker + docker-compose provide Postgres and Redis; the app
  itself runs on the host via pnpm for fast iteration. Testcontainers reuses the same images in
  repository tests, so dev, test, and CI share one database reality.
- **Fly.io for staging** (decided; trade-off vs Railway/Render below): Fly machines give precise
  start/stop control and scale-to-zero, keeping an idle staging near-free (D4); Postgres and
  Redis can be placed in-region next to the app; the machines API makes deploys scriptable from
  CI without a bespoke pipeline. This is a **two-way door**: the deploy sits behind `make`/CI
  targets, and the choice is explicitly revisitable — re-evaluation is delegated to the stage
  that builds the deploy pipeline.
- **Feature flags**: start env-based — flags are part of the zod-validated env schema
  ([ADR-0003](0003-backend-platform.md)), so a flag is one line and a redeploy. Graduate to a
  flag service when we need runtime toggles or percentage rollouts (first experiment or first
  gradual rollout is the trigger). `TODO(decide): which flag service at graduation — self-hosted
  (e.g., Unleash) vs SaaS.`
- **SLO / error-budget sketch** (planned; initial targets, explicitly provisional):

  | SLI | Initial SLO | Error budget / note |
  |---|---|---|
  | API availability (5xx-free rate) | 99.9% monthly | ~43 min/month; burn tracked from `main` deploys |
  | Webhook processing lag, p95 | < 60 s event→entitlement update | protects [ADR-0004](0004-payments-platform.md) dual-rail sync (US-09) |
  | Chat message delivery, p95 | < 500 ms in-region | owned jointly with [ADR-0006](0006-realtime-messaging.md) |

- **Alerting rules sketch** (planned): multiwindow burn-rate alerts on the availability SLO
  (fast 14.4x/1h, slow 6x/6h, per the Google SRE Workbook); BullMQ queue depth and oldest-job
  age beyond threshold; dead-letter queue non-empty; webhook signature-failure spike; Postgres
  connection/disk saturation. `TODO(decide): alert routing destination (email/Slack/pager) — pick
  when staging exists.`
- **Runbook**: `docs/runbook.md` (planned) is the operational memory — deploy/rollback steps,
  every alert's response, and post-incident learnings. Runbook edits ride the PRs that change
  behavior, reviewed like code.
- **k6 load-test plan** (planned): scripted k6 smoke on hot paths (feed read, message send,
  webhook ingest) runs against staging per release; a capacity test before public launch sizes
  machines and validates the SLO table. Thresholds in the k6 scripts encode the SLOs, so a
  regression fails the run.

### Positive consequences

- One branch to reason about; releases are tags, not merges — history stays linear (D1, D2).
- The promotion path makes "how does code reach prod?" a one-diagram interview answer (D3).
- SLOs, alerts, and k6 thresholds share numbers — one definition of "healthy" (D3).
- Staging idles near-free on scale-to-zero machines (D4).

### Negative consequences

- Trunk-based + flags demands discipline: flag hygiene, and dead-flag cleanup nobody enjoys.
- No `develop` buffer means a bad merge lands on the release line; coverage gates and staging
  autodeploy are the compensation, and they must stay trustworthy.
- Fly.io is an opinionated platform with its own failure modes; the price of D4 is learning them.
  Mitigated by D5 — the abstraction seam is deliberate.
- Provisional SLOs set without traffic are guesses; they must be revised against real k6 and
  staging data or they become theater.

## Pros and cons of the options

Scores: `++` strong fit · `+` fit · `o` neutral · `–` poor · `––` disqualifying.

| Branching option | D1 velocity | D2 safety w/o ceremony | D3 realism |
|---|---|---|---|
| **Trunk-based (chosen)** | ++ | ++ (gates, not process) | ++ (industry default for CD) |
| GitFlow | –– (merge trains, `develop` drift) | – (ceremony as safety) | – (fits boxed releases, not CD) |
| Release branches | – | o | o (right for versioned products, wrong here) |

| Staging platform | D3 realism | D4 cost floor | D5 reversibility | Data proximity |
|---|---|---|---|---|
| **Fly.io (chosen)** | + (machines, regions, real ops surface) | ++ (scale-to-zero) | + | ++ (Postgres/Redis in-region by design) |
| Railway | + (best DX) | + | + | + |
| Render | + | o (weaker idle floor for always-on services) | + | + |

Railway is the strongest rejected option — its DX likely beats Fly for a solo project — but Fly's
machines API and explicit regional data placement give more of the operational surface this repo
exists to demonstrate (D3). The gap is small; hence the recorded two-way door.

## Links

- [ADR-0001](0001-record-architecture-decisions.md) — the decision log this process feeds.
- [ADR-0002](0002-monorepo-and-toolchain.md) — `make` targets and pins that CI executes.
- [ADR-0003](0003-backend-platform.md) — env-schema config that hosts the first flags.
- [ADR-0004](0004-payments-platform.md) / [ADR-0006](0006-realtime-messaging.md) — sources of the SLO table's SLIs.
- `.github/workflows/` (exists), `docs/runbook.md` (planned), `NEXT_STEPS.md`.

## Future trends & implications

Over ~24 months, trunk-based development plus feature flags remains the default for continuous
delivery, so this model needs no successor — only enforcement. OpenTelemetry-native SLO tooling
keeps maturing, which should let the SLO table move from a markdown sketch to queryable burn-rate
dashboards without changing its numbers. The small-PaaS market (Fly, Railway, Render) is
consolidating and repricing frequently; the recorded two-way door and `make`-level abstraction
are the hedge, and the delegated re-evaluation should check pricing and Postgres story at deploy
time. Finally, runbooks-as-markdown are becoming machine-operable — an AI agent following
`docs/runbook.md` is a plausible on-call assistant within this horizon, which raises the bar for
keeping it accurate.
