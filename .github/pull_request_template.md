# What & why

<!-- One or two sentences. Link the driving artifact below. -->

- Story / design link: <!-- US-XX in docs/user-stories.md, ADR-XXXX, or an RFC -->

## TDD checklist

<!-- Strict red → green → refactor triplets; see CONTRIBUTING.md. -->

- [ ] Failing test committed first — commit: `<hash>` (red run quoted in its body)
- [ ] Green commit: `<hash>`
- [ ] Refactor commit (optional but preferred): `<hash / n/a>`

## Evidence

<!-- REQUIRED for user-story PRs. Attach media per docs/media/README.md
     (screenshots, GIFs, casts) or link a request/response transcript. -->

## Coverage

- [ ] Gates still met — `server/src` ≥ 90% (payments + admission state machines 100% branch), `IrloKit` ≥ 85%

## Docs

- [ ] Docs updated where this change demands it (ADR, README, user stories, runbook) — or n/a

## Commits

- [ ] Conventional Commits 1.0 — one logical concern per commit; every commit leaves `make test` green
