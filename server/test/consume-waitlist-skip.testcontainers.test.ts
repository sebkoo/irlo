import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consumeWaitlistSkip } from '../src/admission/consume-waitlist-skip.js';
import { createApplicationsRepository } from '../src/db/repositories/applications.js';
import { createLedgerRepository } from '../src/db/repositories/ledger.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { admissionEvents, applications, ledgerEntries } from '../src/db/schema/index.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

async function seedMember() {
  return (await createMembersRepository(testDb.db).create()).id;
}

async function seedApplication(
  memberId: string,
  state: (typeof applications.$inferSelect)['state'],
  lane: (typeof applications.$inferSelect)['lane'] = null,
) {
  return createApplicationsRepository(testDb.db).createGeneration({
    memberId,
    crewId: randomUUID(),
    generation: 1,
    state,
    lane,
    cooldownUntil: null,
  });
}

async function grantSkipCredit(memberId: string, quantity = 1) {
  await createLedgerRepository(testDb.db).append({
    memberId,
    entryType: 'credit',
    creditType: 'waitlist_skip',
    quantity,
    naturalKey: `test:grant:${randomUUID()}`,
  });
}

describe('consumeWaitlistSkip (ADR-0009 §3c skip_consumed / §3d Q6 spend recipe, C35)', () => {
  it('promotes standard -> priority, debits one credit, writes one skip_consumed audit row', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);
    const application = await seedApplication(memberId, 'waitlisted', 'standard');

    const result = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: application.id,
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.lane).toBe('priority');

    expect(await createLedgerRepository(testDb.db).getBalance(memberId, 'waitlist_skip')).toBe(0);

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('skip_consumed');
  });

  it('a same-key replay (network retry) returns the original success, no second debit — natural-key idempotency (ADR-0009 §3d layer 2)', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);
    const application = await seedApplication(memberId, 'waitlisted', 'standard');
    const idempotencyKey = randomUUID();

    const first = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: application.id,
      idempotencyKey,
    });
    const second = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: application.id,
      idempotencyKey,
    });

    expect(first).toEqual({ outcome: 'applied' });
    expect(second).toEqual({ outcome: 'applied' });

    const debits = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.memberId, memberId));
    expect(debits).toHaveLength(2); // one credit (grant) + one debit — never two debits.

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.lane).toBe('priority');
  });

  it('a NEW key against an already-priority application is a typed already_priority error — zero rows, credit preserved (distinct from a same-key replay)', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId, 2);
    const application = await seedApplication(memberId, 'waitlisted', 'priority');

    const result = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: application.id,
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ outcome: 'already_priority' });
    expect(await createLedgerRepository(testDb.db).getBalance(memberId, 'waitlist_skip')).toBe(2);

    const events = await testDb.db
      .select()
      .from(admissionEvents)
      .where(eq(admissionEvents.applicationId, application.id));
    expect(events).toHaveLength(0);
  });

  it.each(['submitted', 'under_review'] as const)(
    'a skip against a %s application is a typed not_waitlisted error — lane has no meaning outside the waitlisted context, credit preserved',
    async (state) => {
      const memberId = await seedMember();
      await grantSkipCredit(memberId);
      const application = await seedApplication(memberId, state);

      const result = await consumeWaitlistSkip(testDb.db, {
        memberId,
        applicationId: application.id,
        idempotencyKey: randomUUID(),
      });

      expect(result).toEqual({ outcome: 'not_waitlisted' });
      expect(await createLedgerRepository(testDb.db).getBalance(memberId, 'waitlist_skip')).toBe(1);
    },
  );

  it('blocks with insufficient_credits when the member has no waitlist_skip balance — lane and application untouched', async () => {
    const memberId = await seedMember();
    const application = await seedApplication(memberId, 'waitlisted', 'standard');

    const result = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: application.id,
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ outcome: 'insufficient_credits' });

    const [row] = await testDb.db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id));
    expect(row?.lane).toBe('standard');
  });

  it('returns not_found for a nonexistent applicationId', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);

    const result = await consumeWaitlistSkip(testDb.db, {
      memberId,
      applicationId: randomUUID(),
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ outcome: 'not_found' });
  });

  it("returns not_found when the applicationId belongs to a different member — a caller cannot spend their credits against someone else's application", async () => {
    const owner = await seedMember();
    const application = await seedApplication(owner, 'waitlisted', 'standard');
    const attacker = await seedMember();
    await grantSkipCredit(attacker);

    const result = await consumeWaitlistSkip(testDb.db, {
      memberId: attacker,
      applicationId: application.id,
      idempotencyKey: randomUUID(),
    });

    expect(result).toEqual({ outcome: 'not_found' });
    expect(await createLedgerRepository(testDb.db).getBalance(attacker, 'waitlist_skip')).toBe(1);
  });
});
