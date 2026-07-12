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
