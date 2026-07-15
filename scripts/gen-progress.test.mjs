// Failing-first spec for scripts/gen-progress.mjs. Node's built-in test
// runner (node:test) — no new dependency, matching the parser's own
// stdlib-only constraint. Run: node --test scripts/gen-progress.test.mjs
//
// Fixture policy: happy-path fixtures are verbatim excerpts of the real,
// normalized NEXT_STEPS.md (copied as literal strings, not read from disk,
// so the test stays pinned even if the doc's prose changes later).
// Malformed-input fixtures are small hand-authored strings that don't exist
// in the real doc — they exist purely to prove the fail-closed line-numbered
// error path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  parseNextSteps,
  renderProgressBlock,
  spliceReadme,
  GenProgressError,
} from './gen-progress.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// --- Verbatim excerpt: Stage 1 header + table (NEXT_STEPS.md:27-37) ---
const STAGE_1_FIXTURE = `## Stage 1 — Server foundation online (≈C13–C22)

| # | Work | Notes |
|---|---|---|
| C13–C15 | \`/health\` endpoint triplet on Fastify app factory (done) | failing contract test → typed route → app-factory refactor; first supertest |
| C16 | zod-parsed env config (12-factor) (done) | \`.env.example\` becomes the tested contract |
| C17 | pino structured logging (done) | request IDs; log schema doc |
| C18 | OpenTelemetry bootstrap (done) | trace context (traceId/spanId); \`startTracing\` seam + \`buildApp\`'s optional \`tracing\` option — no server entrypoint wires it into a running process yet, mirroring C16/C20's own staged env-var rollout |
| C19 | docker-compose dev env (Postgres + Redis) (done — runtime-verified: \`make dev-up\` → both containers healthy → \`make dev-down\`) | Local runtime is colima, not Docker Desktop (blocked on this managed machine); see \`docs/runbook.md\` #Local dev environment |
| C20 | DATABASE_URL env contract + Drizzle client factory (done) | optional until Stage 2 boot-wires the pool |
| C21–C22 | Drizzle schema/migrations (Testcontainers-verified) + members repository triplet (done 2026-07-11) | first tables: members + the ADR-0009 truth logs/projections |
`;

// --- Verbatim excerpt: Stage 2 header + bullets (NEXT_STEPS.md:52-75) ---
const STAGE_2_FIXTURE = `## Stage 2 — Entitlements & admission (≈C23–C36) — US-01, US-02

- C23 entitlement service logic — ledger repository (done: append/getBalance,
  idempotency layer 2 on \`natural_key\`) + inbox repository (done: tryInsert,
  idempotency layer 1 on \`(source, event_id)\`) — over the ADR-0009 tables C21
  already created (schema/tables moved to Stage 1 as ADR-0009's persistence
  substrate; this triplet is service logic, not schema, per the 2026-07-11 C21
  scope note above).
- C24–C27 subscription state-machine reducer (done — \`server/src/domain/subscription-transition.ts\`):
  C24 pure state graph (\`transition\`), C25 idempotency layer 3 (\`applyEvent\`'s
  monotonic \`highWater\` guard, I5a stale-but-economic events), C26 context-only
  events (\`autorenew_set\`, \`plan_changed\`, \`renewal_extended\`), C27
  generation-spawning (\`applyPurchase\` — \`[*] --> trial|active\` entry
  transitions, RESUBSCRIBE-on-terminal spawning generation+1 per I6). This is
  the pure reducer only — no executor/persistence wiring yet; that lands as
  part of Stage 3's "subscription state machine wiring" (below), the
  reducer's first real caller, rather than as a standalone Stage 2 step.
- C28–C29 capability check \`can(member, capability)\` + gating middleware
  *(renumbered from C26–C27 — the reducer completion above claimed those
  numbers first; C-numbers are planning handles per this doc's own header,
  not promises of exact count, so this is a relabel, not a scope change)*
- C30–C33 admission state machine (pure core, 100% branch) + persistence
- C34–C35 waitlist lanes + \`waitlist.skip\` consumption (idempotent)
- C36 admission audit log + evidence (sequence diagram, hurl transcripts)
`;

// --- Verbatim excerpt: Stage 3 header (line 93) + ADR-0011 slices A-D
// (lines 230-238) — non-contiguous in the source, each fragment copied
// exactly as written.
const STAGE_3_SLICES_FIXTURE = `## Stage 3 — Stripe rail (≈C37–C44) — US-09 (server half), US-10

- **(A)** \`rail_identities\` migration + repository triplet (Testcontainers) (done 2026-07-15) —
  the eighth ADR-0009-family table; a new Stage 3 migration, not a C21 reopen.
- **(B)** linkage consumer (\`checkout.session.completed\` → link upsert + inbox row, per
  ADR-0011 §3b's outcome table) + \`linkage_event\` normalizer kind + route dispatch (done 2026-07-15).
- **(C)** purchase-branch retirement (done 2026-07-15): \`resolveMemberByRailIdentity\` +
  \`consumePurchaseEvent\` wiring; the stub test mutates into the \`unlinked_customer\` test;
  ADR-0011 §3g lists the full test-flip set (golden path, out-of-order pair, conflict).
- **(D)** checkout-session endpoint — the already-planned Stage 3 bullet, now specified:
  create-or-reuse the Customer and commit the link before creating the session.
`;

test('Stage 1 table: all seven rows parse as done, ids and names correct', () => {
  const { stages } = parseNextSteps(STAGE_1_FIXTURE);
  assert.equal(stages.length, 1);
  const [stage] = stages;
  assert.equal(stage.title, 'Stage 1 — Server foundation online (≈C13–C22)');
  assert.equal(stage.items.length, 7);
  assert.deepEqual(
    stage.items.map((i) => i.id),
    ['C13–C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21–C22'],
  );
  assert.ok(stage.items.every((i) => i.state === 'done'));
  assert.equal(
    stage.items[0].name,
    '`/health` endpoint triplet on Fastify app factory',
  );
  assert.equal(
    stage.items[4].name,
    'docker-compose dev env (Postgres + Redis)',
  );
  assert.equal(
    stage.items[6].name,
    'Drizzle schema/migrations (Testcontainers-verified) + members repository triplet',
  );
  // marker text must never leak into the display name
  assert.ok(stage.items.every((i) => !/\(done\b/i.test(i.name)));
});

test('Stage 2 bullets: done vs planned split correctly, multi-line bullets joined', () => {
  const { stages } = parseNextSteps(STAGE_2_FIXTURE);
  const [stage] = stages;
  assert.equal(stage.items.length, 6);
  const byId = Object.fromEntries(stage.items.map((i) => [i.id, i]));

  assert.equal(byId['C23'].state, 'done');
  assert.ok(byId['C23'].name.startsWith('entitlement service logic'));
  assert.ok(!/\(done\b/i.test(byId['C23'].name), 'both done markers stripped');
  // nested parens inside a (done: ...) marker must not leak a stray ")"
  assert.ok(!byId['C23'].name.includes('`)'));

  assert.equal(byId['C24–C27'].state, 'done');
  assert.ok(!/\(done\b/i.test(byId['C24–C27'].name));

  assert.equal(byId['C28–C29'].state, 'planned');
  assert.ok(byId['C28–C29'].name.includes('gating middleware'));

  assert.equal(byId['C30–C33'].state, 'planned');
  assert.equal(byId['C34–C35'].state, 'planned');
  assert.equal(byId['C36'].state, 'planned');
});

test('Stage 3 lettered slices: A/B/C done, D planned, punctuation cleaned after marker removal', () => {
  const { stages } = parseNextSteps(STAGE_3_SLICES_FIXTURE);
  const [stage] = stages;
  assert.equal(stage.items.length, 4);
  const byId = Object.fromEntries(stage.items.map((i) => [i.id, i]));

  assert.equal(byId['Slice A'].state, 'done');
  assert.equal(
    byId['Slice A'].name,
    '`rail_identities` migration + repository triplet (Testcontainers) — the eighth ADR-0009-family table; a new Stage 3 migration, not a C21 reopen.',
  );

  assert.equal(byId['Slice B'].state, 'done');
  assert.ok(byId['Slice B'].name.endsWith('route dispatch.'), 'no stray space before the period');

  assert.equal(byId['Slice C'].state, 'done');
  assert.ok(byId['Slice C'].name.startsWith('purchase-branch retirement:'), 'no stray space before the colon');

  assert.equal(byId['Slice D'].state, 'planned');
});

test('real NEXT_STEPS.md parses end-to-end with no errors', () => {
  const source = readFileSync(join(repoRoot, 'NEXT_STEPS.md'), 'utf-8');
  const { stages } = parseNextSteps(source);
  assert.ok(stages.length >= 9, 'expects at least Stage 1 through Stage AI');
  const total = stages.reduce((n, s) => n + s.items.length, 0);
  assert.ok(total > 0);
});

test('synthetic: (in progress) marker is recognized as a distinct third state', () => {
  const fixture = `## Stage 9 — Test\n\n| C90 | some item (in progress) | notes |\n`;
  const { stages } = parseNextSteps(fixture);
  assert.equal(stages[0].items[0].state, 'in_progress');
});

test('synthetic: a stage with zero tracked items still appears in the output', () => {
  const fixture = `## Stage 5 — Reconciliation (≈C50–C52)\n\n- Nightly BullMQ job: provider truth vs local state.\n`;
  const { stages } = parseNextSteps(fixture);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].items.length, 0);
});

test('malformed: unparseable stage header attempt is a loud, line-numbered error', () => {
  const fixture = `## Stage 3: Bad Colon Instead Of Em-Dash\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.ok(err instanceof GenProgressError);
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].line, 1);
      assert.match(err.errors[0].message, /malformed stage header/);
      return true;
    },
  );
});

test('malformed: table row missing a column is a loud, line-numbered error', () => {
  const fixture = `## Stage 1 — X\n\n| C99 | missing notes column |\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].line, 3);
      assert.match(err.errors[0].message, /malformed table row/);
      return true;
    },
  );
});

test('malformed: C-item bullet with no name text is a loud, line-numbered error', () => {
  const fixture = `## Stage 1 — X\n\n- C99\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 3);
      assert.match(err.errors[0].message, /malformed C-item bullet/);
      return true;
    },
  );
});

test('malformed: lowercase slice letter is a loud, line-numbered error', () => {
  const fixture = `## Stage 3 — X\n\n- **(a)** lowercase letter slice\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 3);
      assert.match(err.errors[0].message, /malformed slice bullet/);
      return true;
    },
  );
});

test('malformed: an item outside any Stage section is a loud, line-numbered error', () => {
  const fixture = `- C99 orphan item with no preceding stage header\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 1);
      assert.match(err.errors[0].message, /outside any Stage section/);
      return true;
    },
  );
});

test('malformed: duplicate C-number anywhere in the doc is a loud error', () => {
  const fixture = `## Stage 1 — X\n\n- C13 first mention (done)\n- C13 second mention\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 4);
      assert.match(err.errors[0].message, /duplicate C-number/);
      return true;
    },
  );
});

test('malformed: duplicate slice letter within a stage is a loud error', () => {
  const fixture = `## Stage 3 — X\n\n- **(A)** first (done 2026-07-15)\n- **(A)** second\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 4);
      assert.match(err.errors[0].message, /duplicate slice letter/);
      return true;
    },
  );
});

test('malformed: an item claiming both done and in-progress is a loud error', () => {
  const fixture = `## Stage 1 — X\n\n- C13 contradictory item (done) (in progress)\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors[0].line, 3);
      assert.match(err.errors[0].message, /both a done and an in-progress marker/);
      return true;
    },
  );
});

test('malformed: multiple errors in one document are all reported, not just the first', () => {
  const fixture = `## Stage 1 — X\n\n| C1 | bad row |\n- C2\n`;
  assert.throws(
    () => parseNextSteps(fixture),
    (err) => {
      assert.equal(err.errors.length, 2);
      return true;
    },
  );
});

test('renderProgressBlock: emoji vocabulary, no percentages, placeholder for empty stages', () => {
  const block = renderProgressBlock([
    {
      title: 'Stage 1 — Server foundation online (≈C13–C22)',
      items: [
        { id: 'C13–C15', name: 'health endpoint', state: 'done' },
        { id: 'C21–C22', name: 'migrations', state: 'in_progress' },
        { id: 'C90', name: 'future work', state: 'planned' },
      ],
    },
    { title: 'Stage 5 — Reconciliation (≈C50–C52)', items: [] },
  ]);
  assert.match(block, /### Stage 1 — Server foundation online \(≈C13–C22\)/);
  assert.match(block, /- ✅ \*\*C13–C15\*\* — health endpoint/);
  assert.match(block, /- 🚧 \*\*C21–C22\*\* — migrations/);
  assert.match(block, /- 📋 \*\*C90\*\* — future work/);
  assert.match(block, /### Stage 5 — Reconciliation \(≈C50–C52\)/);
  assert.match(block, /no slice-level items yet — see the stage heading in NEXT_STEPS\.md/i);
  assert.doesNotMatch(block, /%/, 'no percentages or progress bars, per CLAUDE.md');
});

test('renderProgressBlock: items over the fold threshold collapse into <details>, short ones stay inline', () => {
  const longName = 'a'.repeat(120) + ' ' + 'b'.repeat(120); // 241 chars, well over 200
  const shortName = 'a short item name well under the fold threshold';
  const block = renderProgressBlock([
    {
      title: 'Stage 2 — Entitlements & admission (≈C23–C36) — US-01, US-02',
      items: [
        { id: 'C23', name: longName, state: 'done' },
        { id: 'C24–C27', name: shortName, state: 'done' },
      ],
    },
  ]);
  // short item: plain inline row, no <details>
  assert.match(block, new RegExp(`- ✅ \\*\\*C24–C27\\*\\* — ${shortName}$`, 'm'));
  // long item: collapsed behind <details><summary>, full text still present for search/expand
  assert.match(block, /- ✅ \*\*C23\*\* — <details><summary>/);
  assert.ok(block.includes(longName), 'full text is preserved inside <details>, not truncated away');
  const summaryMatch = /<summary>(.*?)<\/summary>/.exec(block);
  assert.ok(summaryMatch, 'summary tag present');
  assert.ok(summaryMatch[1].length < longName.length, 'summary is shorter than the full name');
});

test('real NEXT_STEPS.md opens the ledger with a completed Stage 0', () => {
  const source = readFileSync(join(repoRoot, 'NEXT_STEPS.md'), 'utf-8');
  const { stages } = parseNextSteps(source);
  assert.match(stages[0].title, /^Stage 0 —/);
  assert.equal(stages[0].items.length, 1);
  assert.equal(stages[0].items[0].state, 'done');
});

test('spliceReadme: replaces content strictly between the marker comments', () => {
  const readme = [
    '# Irlo',
    '',
    '## Roadmap',
    '',
    '<!-- progress:begin -->',
    'STALE CONTENT',
    '<!-- progress:end -->',
    '',
    '## Getting started',
    '',
  ].join('\n');
  const updated = spliceReadme(readme, 'FRESH CONTENT');
  assert.ok(updated.includes('FRESH CONTENT'));
  assert.ok(!updated.includes('STALE CONTENT'));
  assert.ok(updated.includes('## Getting started'));
});

test('spliceReadme: missing markers is a loud error, not a silent no-op', () => {
  assert.throws(() => spliceReadme('# Irlo\n\nno markers here\n', 'X'), /progress:begin/);
});
