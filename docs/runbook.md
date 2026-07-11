# Runbook (stub)

> **Honest scope:** Stage 0. Nothing is deployed; there is no production, no staging,
> no pager. This stub fixes the *structure* of incident response now, so content can
> land section-by-section as each system ships (Stage 1+, in `NEXT_STEPS.md` order).
> Sections marked "(arrives with …)" are intentionally empty.

## Severity levels

| Level | Definition | Examples (future) |
|---|---|---|
| SEV-1 | Money or trust is bleeding: payments/entitlements wrong, data exposure, full outage | double-charged member, entitlement granted without payment |
| SEV-2 | A core flow is degraded for many users, workaround exists or blast radius is bounded | chat gateway down, Deck feed erroring, webhook consumer stalled |
| SEV-3 | Minor, cosmetic, or tooling-only; no member impact | flaky CI job, staging-only failure, dashboard broken |

## First 15 minutes (any SEV)

1. **Acknowledge** — open a GitHub issue titled `[SEV-N] <symptom>`, label `incident`.
   It is the incident timeline; timestamp every step.
2. **Snapshot** — capture logs, traces, and provider status *before* changing
   anything (entry points below).
3. **Stop the bleeding** — prefer the smallest reversible action: flag off the
   feature (ADR-0007 flags), roll back the deploy, or pause the failing consumer.
4. **Check the money paths first** — for anything touching payments, confirm the
   ledger is still append-only-consistent before and after mitigation.
5. **Diagnose second** — root cause hunting starts only after impact is contained.
6. **Write it down** — even a solo project gets a short postmortem in the issue:
   what happened, why, and the test that now prevents it.

## Local dev environment (colima)

Docker Desktop is blocked on this managed machine (cask install fails on the
credential-helper linking step under `sudo`); **colima is the supported local
Docker runtime** here instead (`brew install colima docker docker-compose`,
`colima start`). Two colima-specific gotchas, found landing C21 (2026-07-11):

- Leftover `credsStore: "desktop"` in `~/.docker/config.json` from a prior
  Docker Desktop install attempt breaks public image pulls under colima
  (`docker-credential-desktop` executable not found) — remove the key. `auths`
  stays empty for public-only pulls; no replacement credential helper needed.
- `docker compose` (the space-form v2 subcommand used by `make dev-up` and CI)
  isn't wired up by a standalone Homebrew `docker-compose` install — symlink it
  into the CLI plugin path once: `mkdir -p ~/.docker/cli-plugins && ln -sfn
  "$(brew --prefix docker-compose)/bin/docker-compose"
  ~/.docker/cli-plugins/docker-compose`.
- **Confirmed, not hypothetical:** Testcontainers-node does *not* pick up the
  `colima` Docker context automatically — it fails outright ("Could not find
  a working container runtime strategy") without `DOCKER_HOST` set. Separately,
  colima's Ryuk reaper sidecar fails to bind-mount the colima socket across
  the VM boundary ("mkdir .../docker.sock: operation not supported") unless
  Ryuk is disabled. `server/test/support/testcontainers-colima.ts` (a Vitest
  `setupFiles` entry) sets both automatically — `DOCKER_HOST=unix://$HOME/
  .colima/default/docker.sock` and `TESTCONTAINERS_RYUK_DISABLED=true` — but
  only when `DOCKER_HOST` isn't already set and the colima socket file exists,
  so it never overrides an explicit choice and never fires on a non-colima
  machine (CI's native Docker is unaffected). Not in `.env.example`, which
  documents the *app's* runtime contract — Testcontainers reads Docker's own
  config, not the app's.

## Escalation

Reality: **solo maintainer**. There is no rotation; "escalation" means:

- Self-notify via GitHub issue + mobile notification on the `incident` label.
- External escalation paths when the fault is upstream: Stripe status page and
  support, Apple Developer System Status and support, Fly.io status page.
- If unavailable for an extended period, the honest posture is the project's
  disclaimer: this is a portfolio system, not an SLA-bearing service.

## Observability entry points (all planned — Stage 1+)

- **pino structured logs** — request-scoped, JSON; first stop for any symptom
  (Stage 1+, ADR-0003).
- **OpenTelemetry traces/metrics** — cross-service view: HTTP → queue → webhook
  consumers (Stage 1+, ADR-0003).
- **Fly.io status + health checks** — deploy state, instance health, region status
  (Stage 1+, ADR-0007).
- **BullMQ queue depth** — job backlogs for notifications, reconciliation, webhook
  processing (Stage 1+).
- **CI + Codecov** — regression surface when the incident traces back to a change.

## Payments runbooks

The payments platform (ADR-0004) gets dedicated runbook sections. Headings are
reserved now; each fills in with tested procedures when its system lands.

### Webhook backlog

*(arrives with the Stripe + App Store Server Notifications consumers — Stage 1+)*

Scope when written: detecting consumer lag, draining safely under at-least-once
delivery, verifying dedupe keys held, replaying from provider dashboards.

### Reconciliation mismatch

*(arrives with the nightly reconciliation job — Stage 1+)*

Scope when written: triaging ledger-vs-provider diffs, classifying mismatch causes
(missed webhook, replay, clock skew), quarantining metrics until explained, and the
correction procedure that preserves the append-only ledger.

### Entitlement drift

*(arrives with the entitlement service — Stage 1+)*

Scope when written: detecting members whose entitlements disagree with their
subscription state on either rail, the re-derivation procedure from source events,
and grace handling so members are never punished for our drift.
