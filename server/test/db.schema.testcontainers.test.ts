import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  admissionEvents,
  applications,
  consumableBalances,
  ledgerEntries,
  members,
  paymentEvents,
  subscriptions,
} from '../src/db/schema/index.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;
let seedMemberId: string;

beforeAll(async () => {
  testDb = await startTestDb();

  const [seedMember] = await testDb.db.insert(members).values({}).returning({ id: members.id });
  if (!seedMember) throw new Error('seed member insert returned no row');
  seedMemberId = seedMember.id;
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

/**
 * drizzle-orm wraps the underlying pg driver error in a DrizzleQueryError
 * whose own .message is "Failed query: ..." — the real Postgres error (with
 * its SQLSTATE code) lives on .cause. 23505 is unique_violation.
 */
async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ cause: { code: '23505' } });
}

/** 23503 is foreign_key_violation. */
async function expectForeignKeyViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ cause: { code: '23503' } });
}

describe('ADR-0009 schema + migrations (C21)', () => {
  it('creates all seven tables with the expected column shape', async () => {
    const result = await testDb.db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);

    const byTable = new Map<string, string[]>();
    for (const row of result.rows as { table_name: string; column_name: string }[]) {
      const list = byTable.get(row.table_name) ?? [];
      list.push(row.column_name);
      byTable.set(row.table_name, list);
    }

    expect(byTable.get('members')).toEqual(['id', 'created_at']);
    expect(byTable.get('payment_events')).toEqual([
      'id',
      'source',
      'event_id',
      'event_type',
      'payload',
      'effective_at',
      'inbox_seq',
      'disposition',
      'received_at',
    ]);
    expect(byTable.get('ledger_entries')).toEqual([
      'id',
      'member_id',
      'entry_type',
      'credit_type',
      'product_id',
      'quantity',
      'period_start',
      'period_end',
      'natural_key',
      'created_at',
    ]);
    expect(byTable.get('admission_events')).toEqual([
      'id',
      'application_id',
      'event',
      'actor',
      'reason_code',
      'created_at',
    ]);
    expect(byTable.get('subscriptions')).toEqual([
      'id',
      'member_id',
      'provider',
      'provider_subscription_id',
      'generation',
      'state',
      'product_id',
      'will_renew',
      'current_period_end',
      'high_water',
      'created_at',
      'updated_at',
    ]);
    expect(byTable.get('consumable_balances')).toEqual([
      'member_id',
      'credit_type',
      'balance',
      'updated_at',
    ]);
    expect(byTable.get('applications')).toEqual([
      'id',
      'member_id',
      'crew_id',
      'generation',
      'state',
      'lane',
      'cooldown_until',
      'created_at',
      'updated_at',
    ]);
  });

  it('enforces payment_events inbox uniqueness on (source, event_id) — idempotency layer 1', async () => {
    const row = {
      source: 'stripe-webhook',
      eventId: `evt_${randomUUID()}`,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied' as const,
    };

    await testDb.db.insert(paymentEvents).values(row);

    await expectUniqueViolation(testDb.db.insert(paymentEvents).values(row));
  });

  it("accepts 'no_op_live' as a payment_events disposition — ADR-0009 addendum for a purchase/resubscribe event landing on an already-live generation", async () => {
    await expect(
      testDb.db.insert(paymentEvents).values({
        source: 'stripe-webhook',
        eventId: `evt_${randomUUID()}`,
        payload: { kind: 'test' },
        effectiveAt: new Date(),
        disposition: 'no_op_live',
      }),
    ).resolves.not.toThrow();
  });

  it('enforces ledger_entries natural_key uniqueness — idempotency layer 2 (I3)', async () => {
    const naturalKey = `stripe:invoice:${randomUUID()}`;

    await testDb.db.insert(ledgerEntries).values({
      memberId: seedMemberId,
      entryType: 'grant',
      creditType: 'irlo_plus',
      naturalKey,
    });

    await expectUniqueViolation(
      testDb.db.insert(ledgerEntries).values({
        memberId: seedMemberId,
        entryType: 'reversal',
        creditType: 'irlo_plus',
        naturalKey,
      }),
    );
  });

  it('enforces subscriptions uniqueness on (provider, provider_subscription_id, generation)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const row = {
      memberId: seedMemberId,
      provider: 'stripe' as const,
      providerSubscriptionId,
      state: 'active' as const,
      productId: 'irlo.plus.monthly',
    };

    await testDb.db.insert(subscriptions).values(row);

    await expectUniqueViolation(testDb.db.insert(subscriptions).values(row));
  });

  it('allows a second subscription generation for the same provider subscription id — resubscribe (I6)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;

    await testDb.db.insert(subscriptions).values({
      memberId: seedMemberId,
      provider: 'apple',
      providerSubscriptionId,
      generation: 1,
      state: 'expired',
      productId: 'irlo.plus.monthly',
    });

    await expect(
      testDb.db.insert(subscriptions).values({
        memberId: seedMemberId,
        provider: 'apple',
        providerSubscriptionId,
        generation: 2,
        state: 'active',
        productId: 'irlo.plus.monthly',
      }),
    ).resolves.not.toThrow();
  });

  it('rejects a second live application for the same (member, crew) — I8 partial unique index', async () => {
    const crewId = randomUUID();

    await testDb.db
      .insert(applications)
      .values({ memberId: seedMemberId, crewId, state: 'submitted' });

    await expectUniqueViolation(
      testDb.db
        .insert(applications)
        .values({ memberId: seedMemberId, crewId, state: 'under_review' }),
    );
  });

  it('allows a new generation once the prior application is terminal — I8 partial index scope', async () => {
    const crewId = randomUUID();

    await testDb.db.insert(applications).values({
      memberId: seedMemberId,
      crewId,
      state: 'rejected',
      cooldownUntil: new Date(),
    });

    await expect(
      testDb.db
        .insert(applications)
        .values({ memberId: seedMemberId, crewId, generation: 2, state: 'submitted' }),
    ).resolves.not.toThrow();
  });

  it('enforces consumable_balances composite primary key on (member_id, credit_type)', async () => {
    await testDb.db
      .insert(consumableBalances)
      .values({ memberId: seedMemberId, creditType: 'spark', balance: 5 });

    await expectUniqueViolation(
      testDb.db
        .insert(consumableBalances)
        .values({ memberId: seedMemberId, creditType: 'spark', balance: 10 }),
    );
  });

  it('logs an admission_events row against a real application via foreign key (I9)', async () => {
    const crewId = randomUUID();
    const [application] = await testDb.db
      .insert(applications)
      .values({ memberId: seedMemberId, crewId, state: 'submitted' })
      .returning({ id: applications.id });
    if (!application) throw new Error('application insert returned no row');

    await expect(
      testDb.db.insert(admissionEvents).values({
        applicationId: application.id,
        event: 'submit',
        actor: `member:${seedMemberId}`,
      }),
    ).resolves.not.toThrow();
  });

  it('rejects a ledger_entries row against a nonexistent member — FK enforcement', async () => {
    await expectForeignKeyViolation(
      testDb.db.insert(ledgerEntries).values({
        memberId: randomUUID(),
        entryType: 'credit',
        creditType: 'spark',
        naturalKey: `apple:${randomUUID()}`,
      }),
    );
  });

  it('rejects an admission_events row against a nonexistent application — FK enforcement', async () => {
    await expectForeignKeyViolation(
      testDb.db.insert(admissionEvents).values({
        applicationId: randomUUID(),
        event: 'submit',
        actor: `member:${seedMemberId}`,
      }),
    );
  });
});
