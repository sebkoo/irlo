---
description: Run the code-reviewer subagent over a diff range (defaults to the last-reviewed marker through HEAD)
argument-hint: [diff-range, e.g. abc123..HEAD]
---

Run an on-demand review with the `code-reviewer` subagent.

1. **Resolve the range.** If `$ARGUMENTS` is given, use it verbatim. Otherwise
   read `.claude/state/last-reviewed-sha`; if the file doesn't exist yet, use
   the repo's first commit as the lower bound. Range = `<sha-or-first-commit>..HEAD`.
2. **Compute the diff yourself** — `git diff <range>` — the subagent has no
   Bash and cannot do this itself.
3. **Invoke `code-reviewer`**, passing in its prompt: the range, the full diff
   text, and a pointer to read `CLAUDE.md` for conventions. Do not summarize or
   pre-filter the diff before handing it over.
4. **Print the subagent's output verbatim** — do not paraphrase findings.
5. **On `Safe to push: no`**: stop; list the `BLOCKING` items for the user to
   address (fix-forward, never edited by the reviewer itself).
6. **On `Safe to push: yes`**: write the current `HEAD` SHA to
   `.claude/state/last-reviewed-sha` (the directory is seeded with `.gitkeep`,
   so this is always a plain write, never a `mkdir`) and note that it still
   needs to be committed — do not commit it yourself unless the user is
   already mid-commit for this change.
7. **If `.claude/agents/code-reviewer.md` is part of the diff being reviewed**,
   the subagent you're about to invoke may still be running the *previous*
   cached definition (agent registry loads at session start, not on file
   save). Tell the user to run `/agents` to reload mid-session, or note that
   verification is deferred to the next fresh session, before trusting the
   result as evidence the new frontmatter took effect.

This command never pushes and never edits anything beyond
`.claude/state/last-reviewed-sha`.
