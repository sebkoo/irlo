# Contributing to Irlo

Thanks for your interest in Irlo — "Swipe into real life."
The project is at **Stage 0**: scaffolding, canary tests, and docs. Every feature is planned, not built.
That makes this a great moment to contribute — you get to shape foundations, not patch corners.

> Irlo is an independent, open-source portfolio project. It is not affiliated with,
> endorsed by, or connected to Raya.

## Prerequisites

- **iOS work** (`apps/ios/`, or the full `make test`): macOS with a current Xcode. Homebrew and [mise](https://mise.jdx.dev) installed; `make bootstrap` handles the rest.
- **Server-only work** (`server/`, `packages/contracts/`, `docs/`): Linux is fine. Install mise, then run `mise install && pnpm install` and use `make test-server`.

Toolchain versions are pinned in `.mise.toml` (Node 24, pnpm 10) and the `Brewfile` — never install ad hoc versions.

## Getting started

Exactly three commands:

```sh
git clone https://github.com/sebkoo/irlo.git && cd irlo
make bootstrap
make test
```

`make bootstrap` installs the pinned toolchain, workspace dependencies, and generates the Xcode project.
`make test` runs the server suite (Vitest) and the iOS canaries (XCTest/XCUITest).
On Linux, run `make test-server` instead of `make test`.

## Workspace layout

| Path | What it is |
|---|---|
| `server/` | Node 24 + TypeScript strict backend — the headline. Fastify + Drizzle arrive in Stage 1 (ADR-0003). |
| `packages/contracts/` | zod schemas — the single source of truth for API shapes. |
| `apps/ios/` | Swift 6 demo client. `project.yml` (XcodeGen) is the source of truth; the `.xcodeproj` is generated, never committed. |
| `docs/` | ADRs, RFCs, user stories, monetization, AI methodology, evidence media. |

## How we build: TDD triplets

Every feature change lands as a strict red → green → refactor triplet:

```text
test(contracts): failing spec for HealthStatus schema     ← red run quoted in the body
feat(contracts): make HealthStatus schema pass
refactor(contracts): extract status literal union          ← optional but preferred
```

Rules:

- The failing test is committed **first**, with its red output quoted in the commit body.
- [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/): imperative subject ≤ 72 chars; the body explains *why*.
- One logical concern per commit. Every commit leaves `make test` green.

## Coverage gates

- `server/src` ≥ 90% — payments and admission state machines require **100% branch** coverage.
- `IrloKit` ≥ 85%.

The server gate fails Vitest (and therefore CI) today; the iOS gate is enforced as the suite grows.
If a gate blocks you, ask for help on the PR — never lower a threshold.

## Picking a good first issue

Look for the [`good first issue`](https://github.com/sebkoo/irlo/labels/good%20first%20issue) label — we seed these as the roadmap opens up.
Each one names the files to touch, the failing test(s) to write first, and a definition of done.
Comment on the issue to claim it, and ask questions right there — a maintainer will guide you.

## Pull requests

The PR template walks you through it. In short:

- **Link the driving artifact**: a user story (`US-XX` in `docs/user-stories.md`), an ADR, or an RFC.
- **Tests come first.** Show the triplet: failing-test commit, green commit, refactor.
- **Evidence is required for user-story PRs**: media per `docs/media/README.md`, or a request/response transcript.
- Keep PRs small — one concern, reviewable in one sitting.

## Code style

Style and conventions live in [CLAUDE.md](CLAUDE.md), the engineering guide — they are not duplicated here.
Run `make lint` before pushing; CI runs the same targets.

## Licensing — simple, no paperwork

No CLA, no DCO sign-off. By submitting a contribution you agree it is licensed under the
[MIT License](LICENSE) and that you have the right to submit it.

## Code of Conduct

We follow the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind; assume good intent.
