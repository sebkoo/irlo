---
description: Implement a user story as a strict TDD triplet (red → green → refactor)
argument-hint: <story-id, e.g. US-03> [extra context]
---

Implement **$ARGUMENTS** as a TDD triplet per CLAUDE.md §TDD protocol.

1. **Locate the story** in `docs/user-stories.md`. Read its Given/When/Then, named
   tests, and evidence paths. If the story has no named tests yet, STOP and add them
   to the story table first (separate `docs:` commit).
2. **Red.** Write the named failing test(s) only — no implementation. Contract shapes
   come from `@irlo/contracts`; if the schema doesn't exist, run `/api-endpoint` first.
   Run the suite; quote the failure in the commit body.
   Commit: `test(<scope>): failing spec for <story summary> [<story-id>]`
3. **Green.** Write the minimum implementation to pass. No speculative abstraction,
   no scope beyond the test. Run the full affected suite (`make test-server` or
   `make test-ios`).
   Commit: `feat(<scope>): <behavior> [<story-id>]`
4. **Refactor** (preferred, optional). Improve names/structure with tests green at
   every step. Commit: `refactor(<scope>): <what improved>`
5. **Evidence.** Run `/capture-media $ARGUMENTS` (or note why deferred).
6. **Review.** Launch the `code-reviewer` agent on the diff; resolve BLOCKERS before
   declaring done.

Rules: never write implementation before the red commit exists; never weaken a
coverage gate; state machines (payments, admission) require 100% branch coverage.
