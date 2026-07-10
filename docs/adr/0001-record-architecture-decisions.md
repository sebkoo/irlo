# 0001 — Record architecture decisions

- Status: accepted
- Date: 2026-07-10
- Deciders: Ben Koo

## Context and problem statement

Irlo is a backend-first portfolio project whose architecture must be legible to
reviewers (interviewers, contributors) years after decisions were made. Decisions
made in chat sessions, commit bodies, or heads evaporate. We need a durable,
reviewable record of every significant decision, its alternatives, and its
consequences — and the record itself is evidence for the "System design &
architecture" row of the JD-competency matrix (CLAUDE.md).

## Decision drivers

- Reviewability: a stranger can reconstruct *why*, not just *what*.
- Interview leverage: each ADR doubles as a system-design answer sheet.
- Low ceremony: writing one must take minutes, not hours, or it won't happen.
- Evolution: decisions get superseded; the trail must show it.

## Considered options

1. MADR-format ADRs in `docs/adr/` (this document's format)
2. Design docs in a wiki or Notion
3. Decisions recorded only in commit messages and PR descriptions

## Decision outcome

**Option 1 — MADR ADRs in-repo**, numbered `NNNN-kebab-title.md`, created via the
`/adr-new` command which enforces the template. Two Irlo-specific additions to
standard MADR:

- Every ADR ends with a **"Future trends & implications"** section (~24-month
  horizon) — the JD's "Visionary" signal, and an honest check on decision shelf-life.
- Trade-off tables must score options against the stated decision drivers, not
  generic pros/cons.

### Positive consequences

- Versioned next to the code it governs; reviewable in PRs; greppable.
- The index (`docs/adr/README.md`) reads as an architecture tour.

### Negative consequences

- Discipline cost: undocumented decisions now count as process violations.
- Superseding requires bookkeeping (status links both directions).

## Pros and cons of the options

| Driver | 1. MADR in-repo | 2. Wiki/Notion | 3. Commits/PRs only |
|---|---|---|---|
| Reviewability | ✅ versioned, linkable | ⚠️ drifts from code | ❌ scattered |
| Interview leverage | ✅ curated artifacts | ⚠️ private, unlinkable | ❌ archaeology required |
| Low ceremony | ✅ template + command | ⚠️ context switch | ✅ zero extra |
| Evolution trail | ✅ status lifecycle | ⚠️ silent edits | ❌ none |

## Links

- Template/command: `.claude/commands/adr-new.md`
- Index: [docs/adr/README.md](README.md)

## Future trends & implications

AI-assisted development makes decision records *more* valuable, not less: agents
(and this repo's own Claude Code harness) consume ADRs as context, so a good ADR
now steers future generated code. Expect ADR tooling to converge with agent
harnesses — templates enforced by commands, consistency checked by hooks — which
is exactly the shape this repo already implements. The MADR format itself is
stable and boring, which is the point; the risky bet would have been a bespoke
format no tool understands.
