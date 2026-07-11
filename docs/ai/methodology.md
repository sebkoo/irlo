# AI-native methodology — prompt · context · harness · loop

This repo is built with Claude Code as a first-class engineering tool, and the
workflow itself is a deliverable: documented, versioned, and eval-gated
(`docs/ai/evals.md`). It evidences two JD rows at once — "enthusiasm around new
AI tools" and "productivity-obsessed" — with artifacts, not adjectives.

## The four layers

1. **Context engineering — `CLAUDE.md`.** Project map, the JD-competency matrix,
   conventions, TDD protocol, commit grammar, model routing, definition of done,
   never-do list. Kept under 300 lines; everything deeper links out.
2. **Prompt engineering — `.claude/commands/`.** Eight encoded workflows:
   `/tdd-feature`, `/adr-new`, `/rfc-new`, `/api-endpoint` (contract-first),
   `/capture-media`, `/readme-audit`, `/release-notes`, `/review` (on-demand
   `code-reviewer` run over a diff range). Commands encode the *whole*
   procedure — ordering, stop conditions, commit messages — so quality doesn't
   depend on remembering to ask.
3. **Harness engineering — hooks + CI + templates.** PostToolUse: path-scoped
   format/lint/related-tests on every edit, fail-open. PreToolUse: guard on
   immutable evidence (LICENSE, `docs/naming/`). Outer harness: CI (typecheck,
   lint, tests, coverage gates) and a PR template demanding tests + story
   evidence. `docs/ai/evals.md` treats the harness as a system under test with
   release-blocking scenarios.
4. **Loop engineering — the cycle below,** with a `code-reviewer` subagent
   reviewing every diff against CLAUDE.md + the JD matrix before commit.

## The loop

```mermaid
flowchart LR
  P[Plan\nPlan Mode, top model] --> R[Red\nfailing named test]
  R --> G[Green\nminimum implementation]
  G --> F[Refactor\ntests stay green]
  F --> E[Evidence\n/capture-media]
  E --> REV[Subagent review\ncode-reviewer]
  REV --> C[Atomic commit\nConventional Commits]
  C --> PR[PR + template\ntests + evidence]
  PR --> CI[CI gates\ncoverage, lint]
  CI --> M[Merge to main\ntrunk-based]
  M --> REL[Weekly tagged release\n/release-notes]
  REL --> P
```

## Model routing in practice

The routing policy lives in CLAUDE.md §Model routing. What Stage 0 actually
used, for transparency:

| Work | Policy says | Actually used |
|---|---|---|
| Phase 0 naming verification | Opus 4.8/Fable 5 · xhigh | Fable 5 · xhigh |
| Architecture, ADRs, payments design | Opus 4.8/Fable 5 · xhigh | Fable 5 · xhigh |
| Mechanical scaffolding, configs | Sonnet 5 · medium | Fable 5 (session model; Sonnet would have sufficed) |
| Canary tests, CI workflow | Sonnet 5 · high | Fable 5 (same note) |
| Docs copywriting | Opus 4.8 · high | Fable 5 + parallel subagents on a frozen fact pack |

Subagent pattern for bulk docs: every agent receives an identical **frozen
decided-facts pack**; agents may reference but never make decisions; anything
undecided becomes a `TODO(decide)` marker; a single-threaded consistency pass by
the main session precedes the commit.

### Cheap execution, expensive review

Stage 1 onward runs implementation on Sonnet 5 (§Model routing default) but
pins every review to Opus 4.8 at `xhigh` — not by remembering to switch models,
but by encoding it in the subagent's own frontmatter.

| Phase | Model · effort | Mechanism |
|---|---|---|
| Implementation (TDD triplets) | Sonnet 5 · high | session default |
| Review (`code-reviewer` subagent) | Opus 4.8 · xhigh | frontmatter override in `.claude/agents/code-reviewer.md`, loaded per agent-registry refresh |

Review is the highest-leverage, lowest-token phase of the loop — a bounded diff
read once, versus thousands of generated lines — so the design intent is to
concentrate the most capable model there and buy near-Opus review quality at
near-Sonnet aggregate implementation cost. That's a rationale, not yet a
measured result — same honesty rule as the empty Velocity notes table above:
no efficiency claim stands without a number behind it, and none exists yet.
Pinning the model and effort in the agent's frontmatter, rather than relying on
a habit of invoking `/model opus` before each review, makes the routing
enforceable and auditable instead of something that erodes under deadline
pressure — but the pin only takes effect once the agent registry (re)loads the
file (new session, or an in-session `/agents` reload), which the first live
verification run (2026-07-10) caught the hard way: a review invoked before any
reload ran on the *previous* cached definition (Sonnet 5, old output format),
not Opus at `xhigh`. The routing itself still lives in version-controlled
harness files (`.claude/agents/code-reviewer.md`), not in anyone's memory —
that part survives context resets and new contributors unchanged; only the
*runtime* pickup is session-boundary-gated.

## Velocity notes

Cycle time per story (idea → merged with evidence) gets recorded here from
Stage 1 onward — the "productivity-obsessed" claim needs numbers, and none exist
yet, so this table is honestly empty.

| Story | Started | Merged | Cycle time | Notes |
|---|---|---|---|---|
| _measurement begins with US-01 (Stage 2)_ | | | | |

## Server-side AI runway (planned)

pgvector embeddings for Deck ranking and LLM-assisted content moderation behind
a provider-agnostic interface — queued in `NEXT_STEPS.md`, informed by study-map
rows 10–14 (`docs/interview/study-map.md`).
