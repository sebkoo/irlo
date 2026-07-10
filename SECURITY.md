# Security Policy

Irlo is pre-release (Stage 0): scaffolding, canary tests, and docs. There is no deployed
service yet. Security reports about the codebase, CI, and toolchain are still very welcome.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| Anything else (tags, forks) | No |

Until the first release, fixes land on `main` only.

## Reporting a vulnerability

Please report privately — never in a public issue, discussion, or PR.

1. **Preferred**: GitHub Security Advisories — "Report a vulnerability" on
   [github.com/sebkoo/irlo](https://github.com/sebkoo/irlo/security/advisories/new)
   (the repo's planned home).
2. **Or email**: seb.m.koo@gmail.com with the subject line `[irlo security]`.

Include what you found, where (file paths or endpoints), and how to reproduce it.
Proof-of-concept steps help; working exploits are not required.

## Response targets

- Acknowledgement within **72 hours**.
- After triage, we will keep you updated until the issue is resolved and coordinate
  disclosure timing with you. Fixes are prioritized by severity.

## Scope notes

- **Payments code paths are the crown jewels.** The planned StoreKit and Stripe webhook
  consumers, entitlement service, and payments ledger get the highest priority — flaws in
  verification, idempotency, or entitlement logic matter most.
- **Never test against real payment credentials or live money.** Use Apple sandbox and
  Stripe test mode only. Reports produced by probing live payment accounts will not be
  accepted.
- Secrets should never appear in this repo — only `.env.example` placeholders. If you find
  a real credential in the history, report it privately as above.

Thank you for helping keep Irlo and its future members safe.
