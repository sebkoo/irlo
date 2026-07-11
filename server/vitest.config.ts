import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/support/testcontainers-colima.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Drizzle schema files: .references(() => ...) FK callbacks and
      // pgTable's extraConfig (table) => [...] callbacks are lazy — Drizzle
      // only invokes them during DDL/introspection (drizzle-kit generate),
      // never during normal query building, so v8 never sees them execute
      // regardless of test coverage. The constraints they define ARE
      // verified — more rigorously than JS line coverage could show — by
      // db.schema.testcontainers.test.ts running the generated migration
      // against a real Postgres and asserting the actual constraint
      // violations (23505/23503). JS coverage of a declarative config
      // builder isn't a meaningful signal for that code; excluding it here
      // keeps the gate measuring what it's meant to measure (untested
      // logic), not a tooling artifact (found 2026-07-11, C19-C22 milestone
      // checkpoint — make test-ci failed on this before Ben decided the
      // exclusion, per CLAUDE.md's evidence-first checkpoint rule).
      exclude: ['src/db/schema/**'],
      reporter: ['text', 'lcov'],
      // §6 coverage gate: server/src ≥ 90% (payments/admission code: 100% branch, enforced per-module in Stage 1+)
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
