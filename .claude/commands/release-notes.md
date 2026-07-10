---
description: Draft release notes and changelog entry for the next tagged release
argument-hint: <version, e.g. v0.1.0>
---

Prepare release **$ARGUMENTS**.

1. Collect commits since the last tag: `git log <last-tag>..HEAD --oneline`.
2. Group by Conventional Commit type into: **Highlights** (user-visible, with story
   IDs and evidence media links), **Engineering** (refactors, CI, tooling), **Docs**,
   **Fixes**. Drop noise (fixups should not exist post-squash; flag any you find).
3. Write `CHANGELOG.md` entry (keepachangelog style: Added/Changed/Fixed) and a
   GitHub release body: 2–3 sentence narrative on top — what shipped and why it
   matters for the roadmap — then the grouped list, then a "coverage & quality"
   line (test counts, coverage %, from the actual CI run — no invented numbers).
4. Verify `make test` is green and CI on `main` is green before tagging.
5. Tag annotated: `git tag -a $ARGUMENTS -m "<one-line summary>"` — ask before
   pushing the tag (push rules in CLAUDE.md).
6. After the release is public, update the README roadmap (Now/Next/Later) to match
   reality and run `/readme-audit`.
