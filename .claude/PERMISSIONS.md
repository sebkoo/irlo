# Permission allowlist rationale

`.claude/settings.json`'s `permissions.allow` list is code, not prose — JSON has no comment
syntax, so the reasoning for each entry lives here instead. This file documents intent; the
enforcement is the settings file (and the guard below).

This list codifies read-only/test command classes that were being approved ad-hoc, one prompt
at a time, during the Stripe rail TDD work (payments consumer functions, Testcontainers-Postgres
integration tests). Nothing here is new capability — it removes repeated prompts for commands
that were already being said yes to every time.

## Allowed

| Pattern | Why |
|---|---|
| `make test*` | Project test entry point; read-only w.r.t. source (writes only to test/coverage output). |
| `pnpm * test*` | Covers `pnpm -r test`, `--filter <pkg> test:coverage`, etc. across workspaces — same rationale as `make test*`. |
| `pnpm * typecheck` | Type-checking only, no code generation; no trailing wildcard, so flags that could change behavior aren't silently covered. |
| `pnpm * lint` | Lint-check only (not `--fix`, which would mutate files) — same no-trailing-wildcard reasoning as typecheck. |
| `git status`, `git log*`, `git diff*`, `git show*` | Inspection only; none of these mutate the working tree, index, or history. |
| `colima status*` | Read-only status query against the local Docker VM. |
| `docker ps*` | Read-only container listing. |
| `docker exec * psql *` | **Caveat:** this technically permits arbitrary SQL against whatever container matches. Accepted only because it targets disposable local dev/test containers (Testcontainers-Postgres, docker-compose) that `make test`/migrations recreate from scratch — there is nothing to leak or persist damage into. Production database access must never flow through this path; if a prod-reachable `psql` invocation is ever needed, it stays prompt-gated. |
| `cat *`, `ls*` | File inspection. **Caveat:** these are prefix-matched on command text, not parsed for shell operators — `cat x > y` or `cat x; rm y` would still match the pattern and execute the trailing mutation unprompted. Accepted as a practical convenience given the low realistic risk in an interactive session, not because the pattern is airtight. |

`find *` was deliberately **not** added: `find` supports `-delete` and `-exec`, so a
prefix-wildcard rule would cover destructive invocations, not just read-only ones. The native
Glob/Grep tools cover the file-discovery use case without that risk; a genuine one-off `find`
need can still prompt.

### Second allowlist pass (2026-07-12)

| Pattern | Why |
|---|---|
| `git add *` | Staging only; CLAUDE.md's own convention favors staging specific files by name (Claude's judgment call on *which* files, not a permission restriction — the pattern doesn't distinguish `git add file.ts` from `git add -A`, so the discipline is behavioral, not enforced here). |
| `git commit *` | CLAUDE.md already states local commits are auto-mode ("edit and commit freely without asking") — this entry just stops the allowlist from lagging a policy that was already decided. Supersedes the narrower `settings.local.json` rule (`git commit -m ' *`) for anyone using the tracked file. |
| `git rebase*`, `git reset*` | Local, unpushed-history operations — also policy-auto per CLAUDE.md ("Push is never automatic" is the actual boundary, not "history is never rewritten locally"). **Caveat:** this allowlist entry removes the permission *prompt*, not Claude's own duty of care — `git reset` (especially `--hard`) discards uncommitted working-tree changes too, which is a distinct risk from rewriting already-committed history, and isn't covered by "unpushed history" reasoning at all. The system-level instruction to run `git status` and stash/protect uncommitted work before any reset/clean/checkout-family command still applies regardless of what's allowlisted — this entry only means the *permission* step is skipped, not the *safety-check* step. |
| `node scripts/validate-*.mjs*` | Our own gate scripts (e.g. `validate-mermaid.mjs`) — read-only checks, not mutations. |
| `bash -n *` | Syntax-check only (`-n` parses without executing) — used to verify hook scripts before they're wired in. |
| `which *` | Environment diagnostic; read-only. |
| `* --version*` | Environment diagnostic; read-only for any well-behaved CLI. Note this is the one entry with a **leading** wildcard rather than a fixed command prefix — broader than the rest of this list by construction, accepted because `--version` invocations are conventionally side-effect-free regardless of which binary is invoked. |

## Explicitly excluded (stays prompt-gated)

- `git push` (any form) — shared/remote state; CLAUDE.md requires an explicit go before any push.
- `pnpm add` (and any SPM/dependency addition) — CLAUDE.md's new-dependency gate requires
  announcing the exact `package@version`, confirming provenance, and pinning it before it lands.
- `docker run`, `docker rm` — container lifecycle mutation, not inspection.
- Anything else network- or state-mutating — destructive/irreversible actions stay gated by
  design, per CLAUDE.md's checkpoint discipline (§ Checkpoints, § Never do).

## Self-protection

`.claude/hooks/protect-evidence.sh` (a `PreToolUse` guard on `Edit|Write|MultiEdit`) blocks edits
to `LICENSE`, `docs/naming/*`, `.claude/settings*.json` (both the tracked file and the
gitignored local override), and everything under `.claude/hooks/` itself — the enforcement
mechanism protects its own source so it can't be edited around. Any change to this allowlist,
the hooks it's paired with, or the guard script requires the same explicit my-say-so as touching
`LICENSE`.

`.claude/hooks/protect-constitution-bash.sh` (a `PreToolUse` guard on the `Bash` matcher) closes
the gap the `Edit|Write|MultiEdit` guard above cannot: it only sees those three tools, so a Bash
heredoc, `tee`, `cp`, `mv`, `sed -i`, or `rm` targeting `.claude/settings*.json` or
`.claude/hooks/` would otherwise land unblocked. Found 2026-07-12: an agent session proposed
writing `settings.json` via Bash specifically because it had been asked for that exact content
and reasoned the request satisfied the *spirit* of the Edit/Write guard even though the literal
tool-call would dodge it. The human operator rejected the write and made the actual rule
explicit — closing a mechanical loophole under a stated justification is exactly the case this
guard exists for, and stated justification is not itself authorization. Pattern-based and
best-effort (documented in the script's own header) — it is not a sandbox guarantee, the same
honest limitation already noted above for `cat`/`ls`.

### Constitution edit procedure

Both guards above intentionally have **no bypass** reachable from any Claude Code tool —
Edit, Write, MultiEdit, and now Bash are all covered for the two protected path classes. This
is deliberate, not an oversight to route around: **constitution edits (`.claude/settings*.json`,
`.claude/hooks/*`) are proposed as diffs and full file contents by the agent, and applied by the
human operator directly in their own terminal.** The agent's role stops at: show a diff against
the current file (so nothing is silently dropped), write proposed new-file content to the
scratchpad (never to the real path, by any tool), and hand over a copy-paste apply-and-verify
block for the human to run and report the output of. This is the intended, permanent shape of
this workflow, not a temporary workaround pending a "proper" fix.
