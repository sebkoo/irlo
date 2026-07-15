import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplicationsRepository } from '../src/db/repositories/applications.js';
import { createMembersRepository } from '../src/db/repositories/members.js';

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

describe('applications repository (ADR-0009 §3a/§3c, C32)', () => {
  it('getLatestGeneration returns undefined for a never-seen (member, crew)', async () => {
    const repo = createApplicationsRepository(testDb.db);

    const result = await repo.getLatestGeneration(seedMemberId, randomUUID());

    expect(result).toBeUndefined();
  });

  it('createGeneration inserts a fresh generation and getLatestGeneration finds it', async () => {
    const repo = createApplicationsRepository(testDb.db);
    const crewId = randomUUID();

    const created = await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'submitted',
      lane: null,
      cooldownUntil: null,
    });

    expect(created.generation).toBe(1);
    expect(created.state).toBe('submitted');

    const found = await repo.getLatestGeneration(seedMemberId, crewId);

    expect(found?.id).toBe(created.id);
  });

  it('getLatestGeneration returns the highest generation when multiple exist (reapply after a terminal generation)', async () => {
    const repo = createApplicationsRepository(testDb.db);
    const crewId = randomUUID();

    await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'rejected',
      lane: null,
      cooldownUntil: new Date('2026-01-01T00:00:00Z'),
    });
    const gen2 = await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 2,
      state: 'submitted',
      lane: null,
      cooldownUntil: null,
    });

    const found = await repo.getLatestGeneration(seedMemberId, crewId);

    expect(found?.id).toBe(gen2.id);
    expect(found?.generation).toBe(2);
  });

  it('updateGeneration patches state and cooldownUntil on an existing row', async () => {
    const repo = createApplicationsRepository(testDb.db);
    const created = await repo.createGeneration({
      memberId: seedMemberId,
      crewId: randomUUID(),
      generation: 1,
      state: 'under_review',
      lane: null,
      cooldownUntil: null,
    });
    const cooldownUntil = new Date('2026-03-01T00:00:00Z');

    const updated = await repo.updateGeneration(created.id, { state: 'rejected', cooldownUntil });

    expect(updated.state).toBe('rejected');
    expect(updated.cooldownUntil).toEqual(cooldownUntil);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('propagates a genuine insert failure that is not a unique violation', async () => {
    const repo = createApplicationsRepository(testDb.db);

    // A nonexistent memberId trips the members FK (23503), not the
    // live-application unique index.
    await expect(
      repo.createGeneration({
        memberId: randomUUID(),
        crewId: randomUUID(),
        generation: 1,
        state: 'submitted',
        lane: null,
        cooldownUntil: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('I8 — rejects a second LIVE application for the same (member, crew) with a unique violation', async () => {
    const repo = createApplicationsRepository(testDb.db);
    const crewId = randomUUID();
    await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'under_review',
      lane: null,
      cooldownUntil: null,
    });

    // Deliberately no catch-and-recover here — a live-application conflict
    // means concurrent submission raced (or a caller skipped the
    // applySubmission guard), which must surface as an error, not be
    // silently absorbed.
    await expect(
      repo.createGeneration({
        memberId: seedMemberId,
        crewId,
        generation: 2,
        state: 'submitted',
        lane: null,
        cooldownUntil: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('I8 — a new generation after a TERMINAL one for the same (member, crew) is not blocked by the live-application index', async () => {
    const repo = createApplicationsRepository(testDb.db);
    const crewId = randomUUID();
    await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 1,
      state: 'rejected',
      lane: null,
      cooldownUntil: new Date('2026-01-01T00:00:00Z'),
    });

    const gen2 = await repo.createGeneration({
      memberId: seedMemberId,
      crewId,
      generation: 2,
      state: 'submitted',
      lane: null,
      cooldownUntil: null,
    });

    expect(gen2.generation).toBe(2);
  });
});
