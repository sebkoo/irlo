import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applicationLockKey } from '../src/admission/application-lock-key.js';
import { submitApplication } from '../src/admission/submit-application.js';
import { createApplicationsRepository } from '../src/db/repositories/applications.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { admissionEvents, applications } from '../src/db/schema/index.js';

import { raceViaAdvisoryLock } from './support/deterministic-race.js';
import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;
let seedMemberId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  const members = createMembersRepository(testDb.db);
  seedMemberId = (await members.create()).id;
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

function extractOutcomes(results: PromiseSettledResult<{ outcome: string }>[]): string[] {
  return results
    .map((r) => {
      if (r.status !== 'fulfilled') throw new Error(`racer rejected: ${String(r.reason)}`);
      return r.value.outcome;
    })
    .sort();
}

describe('submitApplication (ADR-0009 §3c submit / §3b refinement 8 reapply, C33)', () => {
  it('a first-ever submission with an open crew creates generation 1 at submitted, one submit audit row', async () => {
    const crewId = randomUUID();

    const result = await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: true,
      cooldownElapsed: true,
    });

    expect(result.outcome).toBe('submitted');
    if (result.outcome !== 'submitted') throw new Error('unreachable');

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, result.applicationId));
    expect(row?.state).toBe('submitted');
    expect(row?.generation).toBe(1);

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, result.applicationId));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('submit');
    expect(events[0]?.actor).toBe(`member:${seedMemberId}`);
  });

  it('a closed crew blocks submission with no rows written', async () => {
    const crewId = randomUUID();

    const result = await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: false,
      cooldownElapsed: true,
    });

    expect(result).toEqual({ outcome: 'crew_not_open' });

    const rows = await testDb.db
      .select()
      .from(applications)
      .where(and(eq(applications.memberId, seedMemberId), eq(applications.crewId, crewId)));
    expect(rows).toHaveLength(0);
  });

  it('a second submission against an already-live application is blocked (double-admission attempt)', async () => {
    const crewId = randomUUID();
    await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: true,
      cooldownElapsed: true,
    });

    const result = await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: true,
      cooldownElapsed: true,
    });

    expect(result).toEqual({ outcome: 'already_applied' });

    const rows = await testDb.db
      .select()
      .from(applications)
      .where(and(eq(applications.memberId, seedMemberId), eq(applications.crewId, crewId)));
    expect(rows).toHaveLength(1);
  });

  it('reapply against a terminal generation with cooldown active is blocked', async () => {
    const crewId = randomUUID();
    const repo = createApplicationsRepository(testDb.db);
    await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'rejected',
      lane: null,
      cooldownUntil: new Date('2099-01-01T00:00:00Z'),
    });

    const result = await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: true,
      cooldownElapsed: false,
    });

    expect(result).toEqual({ outcome: 'cooldown_active' });

    const rows = await testDb.db
      .select()
      .from(applications)
      .where(and(eq(applications.memberId, seedMemberId), eq(applications.crewId, crewId)));
    expect(rows).toHaveLength(1);
  });

  it('reapply against a terminal generation once cooldown has elapsed spawns generation 2, generation 1 untouched', async () => {
    const crewId = randomUUID();
    const repo = createApplicationsRepository(testDb.db);
    const gen1 = await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'rejected',
      lane: null,
      cooldownUntil: new Date('2020-01-01T00:00:00Z'),
    });

    const result = await submitApplication(testDb.db, {
      memberId: seedMemberId,
      crewId,
      actor: `member:${seedMemberId}`,
      crewOpen: true,
      cooldownElapsed: true,
    });

    expect(result.outcome).toBe('submitted');
    if (result.outcome !== 'submitted') throw new Error('unreachable');

    const rows = await testDb.db
      .select()
      .from(applications)
      .where(and(eq(applications.memberId, seedMemberId), eq(applications.crewId, crewId)))
      .orderBy(applications.generation);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(gen1.id);
    expect(rows[0]?.state).toBe('rejected');
    expect(rows[1]?.generation).toBe(2);
    expect(rows[1]?.state).toBe('submitted');
    expect(rows[1]?.cooldownUntil).toBeNull();
  });

  it('Race — two concurrent first-ever submissions for the same (member, crew): exactly one generation, one submitted, one already_applied', async () => {
    const crewId = randomUUID();
    const lockKey = applicationLockKey(seedMemberId, crewId);

    const racePool = new Pool({ connectionString: testDb.container.getConnectionUri(), max: 3 });
    const raceDb = drizzle(racePool);

    try {
      const input = {
        memberId: seedMemberId,
        crewId,
        actor: `member:${seedMemberId}`,
        crewOpen: true,
        cooldownElapsed: true,
      };

      const results = await raceViaAdvisoryLock(racePool, lockKey, [
        () => submitApplication(raceDb, input),
        () => submitApplication(raceDb, input),
      ]);

      expect(extractOutcomes(results)).toEqual(['already_applied', 'submitted']);

      const rows = await testDb.db
        .select()
        .from(applications)
        .where(and(eq(applications.memberId, seedMemberId), eq(applications.crewId, crewId)));
      expect(rows).toHaveLength(1);
    } finally {
      await racePool.end();
    }
  });
});
