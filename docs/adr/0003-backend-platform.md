# 0003 — Backend platform: Node 24 + TypeScript strict, Fastify + Drizzle

- Status: accepted
- Date: 2026-07-10
- Deciders: Ben Koo

## Context and problem statement

The backend is the headline of this repo: it must showcase production Node.js/
TypeScript patterns for a payments- and membership-heavy domain (JD rows 1, 3, 4,
5), stay fast to iterate on solo, and remain legible to reviewers. We need to fix
runtime, language, HTTP framework, database access, and the operational baseline
before Stage 1 writes the first endpoint.

## Decision drivers

- **D1 JD evidence:** demonstrate widely-used production patterns, not exotica.
- **D2 Type-safety end-to-end:** contracts (zod) → handlers → DB rows, no `any`.
- **D3 Startup pace:** minimal ceremony per endpoint; fast tests; fast feedback.
- **D4 Operational transparency:** the SQL, the queues, the logs must be inspectable — nothing that hides the machinery this repo exists to demonstrate.
- **D5 Solo maintainability:** small dependency surface, boring failure modes.

## Considered options

- HTTP framework: **Fastify** vs NestJS vs Express vs Hono
- ORM/data access: **Drizzle** vs Prisma vs Kysely
- Runtime/language: Node 24 + TypeScript ~6.0 (strict) — see notes below

## Decision outcome

**Fastify + Drizzle on Node 24 / TypeScript strict**, with:

- **Postgres** as the system of record; **Redis** for presence, rate limits, and
  queue backing; **BullMQ** for background jobs (webhook processing, reconciliation
  — [ADR-0004](0004-payments-platform.md)).
- **zod-validated boundaries** everywhere, schemas imported from
  `@irlo/contracts` ([ADR-0002](0002-monorepo-and-toolchain.md)); zod→OpenAPI
  generation planned.
- **pino** structured logging + **OpenTelemetry** traces/metrics from the first
  endpoint — observability is a Stage 1 deliverable, not a retrofit.
- **12-factor config**: env-only, parsed once through a zod schema at boot,
  documented in `.env.example`.

### Positive consequences

- Fastify's schema-first request lifecycle matches the contracts-package design;
  validation and serialization are first-class, and it stays close to Node HTTP.
- Drizzle keeps SQL visible (D4), generates types from the schema (D2), and its
  migrations diff cleanly in PRs.
- Both are mainstream enough to read as production choices (D1) with small
  dependency trees (D5).

### Negative consequences

- More assembly required than NestJS: DI, module layout, and conventions are ours
  to define (and to defend in review).
- Drizzle's ecosystem is younger than Prisma's; some patterns (soft deletes,
  computed columns) need hand-rolling.
- Fastify plugins vary in quality; each adoption needs a look at maintenance
  status.

## Pros and cons of the options

### HTTP framework

| Driver | Fastify | NestJS | Express | Hono |
|---|---|---|---|---|
| D1 JD evidence | ✅ common in production Node | ✅ common, esp. enterprise | ⚠️ ubiquitous but legacy patterns | ⚠️ rising, edge-first |
| D2 Type-safety | ✅ schema-first, typed routes | ✅ decorators + DTOs | ❌ bolt-on | ✅ good generics |
| D3 Pace | ✅ minimal ceremony | ❌ heavy scaffolding per feature | ✅ minimal | ✅ minimal |
| D4 Transparency | ✅ thin over Node | ⚠️ DI container indirection | ✅ thin | ✅ thin |
| D5 Solo maintainability | ✅ | ⚠️ framework-brain lock-in | ⚠️ middleware sprawl | ⚠️ younger ecosystem |

NestJS was the serious contender: it *is* widespread in payments-adjacent shops.
It lost on D3/D4 — the DI/decorator layer adds ceremony and hides the machinery
this repo exists to expose. A NestJS reading note stays in the interview prep
(large-codebase fluency), which captures its value without paying its cost here.

### Data access

| Driver | Drizzle | Prisma | Kysely |
|---|---|---|---|
| D1 JD evidence | ✅ fast-growing standard | ✅ most adopted | ⚠️ niche |
| D2 Type-safety | ✅ schema→types | ✅ generated client | ✅ excellent |
| D3 Pace | ✅ lightweight migrations | ✅ great DX | ⚠️ hand-write more |
| D4 SQL transparency | ✅ SQL-shaped API | ❌ query engine abstraction | ✅ SQL-shaped |
| D5 Maintainability | ✅ no codegen daemon | ⚠️ heavier toolchain | ✅ tiny |

Prisma lost on D4: the query-engine abstraction is exactly the layer an
interviewer probes past ("what SQL does this emit?"). Kysely is admirable but
thin on D1/D3 for this purpose. Payments ledger tables will still be reviewed as
raw SQL migrations regardless of ORM ([ADR-0004](0004-payments-platform.md)).

## Runtime and language notes (recorded facts)

- **Node 24 (Active LTS)** — deviation from the original spec's Node 22, chosen
  by the owner at bootstrap; pinned in `.mise.toml` and honored by CI via mise.
- **TypeScript pinned `~6.0.3`**, not 7.x: typescript-eslint 8.63 peer-requires
  `<6.1.0` (verified at install, 2026-07-10). Revisit when the peer range moves —
  tracked in `NEXT_STEPS.md`.

## Links

- [ADR-0002](0002-monorepo-and-toolchain.md) — contracts package, toolchain
- [ADR-0004](0004-payments-platform.md) — payments architecture on this platform
- [ADR-0007](0007-sdlc-and-operational-excellence.md) — deploy/ops for this stack

## Future trends & implications

Node's native TypeScript type-stripping is maturing; within ~24 months the
tsc-as-build-step may disappear for server code, which favors our ESM/NodeNext,
annotation-light style. TypeScript 7's Go-based compiler will land in the lint
toolchain once typescript-eslint supports it — our pin is a scheduled migration,
not a fork in the road. Drizzle's trajectory (SQL-first, no runtime engine) aligns
with the ecosystem's drift away from heavy query engines; if that reverses,
Drizzle's thin API keeps a Kysely/raw-SQL escape hatch cheap. Fastify remains the
default performance-oriented Node framework; the credible disruptor is
platform-agnostic (WinterTC-style) servers, which our thin-framework choice keeps
us near.
