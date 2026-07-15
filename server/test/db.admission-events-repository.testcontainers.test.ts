import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdmissionEventsRepository } from '../src/db/repositories/admission-events.js';
import { createApplicationsRepository } from '../src/db/repositories/applications.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { admissionEvents } from '../src/db/schema/index.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;
let seedApplicationId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  const members = createMembersRepository(testDb.db);
  const memberId = (await members.create()).id;
  const applications = createApplicationsRepository(testDb.db);
  const application = await applications.createGeneration({
    memberId,
    crewId: randomUUID(),
    generation: 1,
    state: 'submitted',
    lane: null,
    cooldownUntil: null,
  });
  seedApplicationId = application.id;
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

describe('admission events repository (ADR-0009 I9 append-only audit log, C32)', () => {
  it('append inserts a row with actor and reasonCode', async () => {
    const repo = createAdmissionEventsRepository(testDb.db);

    const row = await repo.append({
      applicationId: seedApplicationId,
      event: 'decision_reject',
      actor: 'reviewer:r1',
      reasonCode: 'not_a_fit',
    });

    expect(row.event).toBe('decision_reject');
    expect(row.actor).toBe('reviewer:r1');
    expect(row.reasonCode).toBe('not_a_fit');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('append inserts a row with a null reasonCode (not every event carries one)', async () => {
    const repo = createAdmissionEventsRepository(testDb.db);

    const row = await repo.append({
      applicationId: seedApplicationId,
      event: 'auto_triage',
      actor: 'system',
      reasonCode: null,
    });

    expect(row.event).toBe('auto_triage');
    expect(row.reasonCode).toBeNull();
  });

  it('multiple appends accumulate — the log is additive, never overwritten', async () => {
    const repo = createAdmissionEventsRepository(testDb.db);
    const applications = createApplicationsRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;
    const application = await applications.createGeneration({
      memberId,
      crewId: randomUUID(),
      generation: 1,
      state: 'submitted',
      lane: null,
      cooldownUntil: null,
    });

    await repo.append({
      applicationId: application.id,
      event: 'submit',
      actor: `member:${memberId}`,
      reasonCode: null,
    });
    await repo.append({
      applicationId: application.id,
      event: 'review_open',
      actor: 'reviewer:r1',
      reasonCode: null,
    });

    const rows = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.event).sort()).toEqual(['review_open', 'submit']);
  });

  it('propagates a genuine insert failure that is not a unique violation (no matching application)', async () => {
    const repo = createAdmissionEventsRepository(testDb.db);

    await expect(
      repo.append({
        applicationId: randomUUID(),
        event: 'submit',
        actor: 'member:x',
        reasonCode: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
