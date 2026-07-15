import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyAdmissionEvent } from '../src/admission/apply-admission-event.js';
import { createApplicationsRepository } from '../src/db/repositories/applications.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { admissionEvents, applications } from '../src/db/schema/index.js';

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

async function seedApplication(state: (typeof applications.$inferSelect)['state']) {
  const repo = createApplicationsRepository(testDb.db);
  return repo.createGeneration({
    memberId: seedMemberId,
    crewId: randomUUID(),
    generation: 1,
    state,
    lane: null,
    cooldownUntil: null,
  });
}

describe('applyAdmissionEvent (ADR-0009 §3c per-generation events, C33)', () => {
  it('auto_triage: submitted -> waitlisted, one audit row, row updated', async () => {
    const application = await seedApplication('submitted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'auto_triage' },
      actor: 'system',
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('waitlisted');

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('auto_triage');
    expect(events[0]?.actor).toBe('system');
  });

  it('review_open: submitted -> under_review', async () => {
    const application = await seedApplication('submitted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'review_open' },
      actor: 'reviewer:r1',
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('under_review');
  });

  it('decision(accept): under_review -> accepted', async () => {
    const application = await seedApplication('under_review');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'decision', outcome: 'accept', actor: 'reviewer:r1', reasonCode: 'fit' },
      actor: 'reviewer:r1',
      reasonCode: 'fit',
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('accepted');

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events[0]?.event).toBe('decision_accept');
    expect(events[0]?.reasonCode).toBe('fit');
  });

  it('decision(reject): under_review -> rejected, sets cooldownUntil', async () => {
    const application = await seedApplication('under_review');
    const cooldownUntil = new Date('2026-08-01T00:00:00Z');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: {
        type: 'decision',
        outcome: 'reject',
        actor: 'reviewer:r1',
        reasonCode: 'not_a_fit',
        cooldownUntil,
      },
      actor: 'reviewer:r1',
      reasonCode: 'not_a_fit',
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('rejected');
    expect(row?.cooldownUntil).toEqual(cooldownUntil);
  });

  it('decision(defer): under_review -> waitlisted', async () => {
    const application = await seedApplication('under_review');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: {
        type: 'decision',
        outcome: 'defer',
        actor: 'reviewer:r1',
        reasonCode: 'more_signal',
      },
      actor: 'reviewer:r1',
      reasonCode: 'more_signal',
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('waitlisted');
  });

  it('queue_advanced: waitlisted -> under_review', async () => {
    const application = await seedApplication('waitlisted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'queue_advanced' },
      actor: 'system',
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('under_review');
  });

  it('onboarding_complete: accepted -> member', async () => {
    const application = await seedApplication('accepted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'onboarding_complete' },
      actor: `member:${seedMemberId}`,
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('member');
  });

  it('withdraw: submitted -> withdrawn', async () => {
    const application = await seedApplication('submitted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'withdraw', actor: `member:${seedMemberId}` },
      actor: `member:${seedMemberId}`,
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'applied' });
    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('withdrawn');
  });

  it('a repeat decision(accept) on an already-accepted application is a recorded no-op — row untouched, but still audited', async () => {
    const application = await seedApplication('accepted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'decision', outcome: 'accept', actor: 'reviewer:r2', reasonCode: 'fit' },
      actor: 'reviewer:r2',
      reasonCode: 'fit',
    });

    expect(result).toEqual({ outcome: 'noop' });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('accepted');
    expect(row?.updatedAt.getTime()).toBe(application.updatedAt.getTime());

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe('reviewer:r2');
  });

  it('a conflicting decision(reject) on an already-accepted application is a typed error, never a second admission, no audit row written', async () => {
    const application = await seedApplication('accepted');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: {
        type: 'decision',
        outcome: 'reject',
        actor: 'reviewer:r2',
        reasonCode: 'not_a_fit',
        cooldownUntil: new Date('2026-08-01T00:00:00Z'),
      },
      actor: 'reviewer:r2',
      reasonCode: 'not_a_fit',
    });

    expect(result).toEqual({
      outcome: 'conflicting_decision',
      error: { code: 'conflicting_decision', state: 'accepted', outcome: 'reject' },
    });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('accepted');

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(0);
  });

  it('an off-graph event is a typed invalid_transition error, no audit row written', async () => {
    const application = await seedApplication('under_review');

    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'auto_triage' },
      actor: 'system',
      reasonCode: null,
    });

    expect(result).toEqual({
      outcome: 'invalid_transition',
      error: { code: 'invalid_transition', state: 'under_review', eventType: 'auto_triage' },
    });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.state).toBe('under_review');

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(0);
  });

  it('a nonexistent applicationId returns not_found', async () => {
    const result = await applyAdmissionEvent(testDb.db, {
      applicationId: randomUUID(),
      event: { type: 'auto_triage' },
      actor: 'system',
      reasonCode: null,
    });

    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('I9 — the audit row records the actor/reasonCode embedded in a decision/withdraw event, not a mismatched top-level input (single source of truth for the append-only log)', async () => {
    const application = await seedApplication('under_review');

    await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'decision', outcome: 'accept', actor: 'reviewer:embedded', reasonCode: 'fit' },
      // Deliberately mismatched — a caller bug (or a future route bug) must
      // not be able to make the append-only log disagree with the domain
      // event it's supposedly auditing.
      actor: 'reviewer:mismatched',
      reasonCode: 'wrong_reason',
    });

    const [row] = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(row?.actor).toBe('reviewer:embedded');
    expect(row?.reasonCode).toBe('fit');
  });

  it("I9 — a withdraw event's embedded actor is what gets audited, not a mismatched top-level input", async () => {
    const application = await seedApplication('submitted');

    await applyAdmissionEvent(testDb.db, {
      applicationId: application.id,
      event: { type: 'withdraw', actor: 'member:embedded' },
      actor: 'member:mismatched',
      reasonCode: null,
    });

    const [row] = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(row?.actor).toBe('member:embedded');
  });
});
