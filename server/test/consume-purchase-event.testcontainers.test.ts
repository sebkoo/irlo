import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';
import { createSubscriptionsRepository } from '../src/db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents, subscriptions } from '../src/db/schema/index.js';
import { consumePurchaseEvent } from '../src/payments/consume-purchase-event.js';
import { subscriptionLockKey } from '../src/payments/subscription-lock-key.js';

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

const T1 = new Date('2026-01-01T00:00:00Z');
const T2 = new Date('2026-01-15T00:00:00Z');

function extractOutcomes(results: PromiseSettledResult<{ outcome: string }>[]): string[] {
  return results
    .map((r) => {
      if (r.status !== 'fulfilled') throw new Error(`racer rejected: ${String(r.reason)}`);
      return r.value.outcome;
    })
    .sort();
}

describe('consumePurchaseEvent (ADR-0009 — generation-spawning purchase, I2/I3/I4)', () => {
  it('a first-ever purchase with no offer creates generation 1 at active, one grant ledger row, inbox applied', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const eventId = randomUUID();
    const invoiceId = `in_${randomUUID()}`;

    const result = await consumePurchaseEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'invoice.paid',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      providerSubscriptionId,
      memberId: seedMemberId,
      event: { type: 'purchased', offerPresent: false },
      productId: 'irlo.plus.monthly',
      invoiceOrTransactionId: invoiceId,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'generation_created' });

    const rows = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('active');
    expect(rows[0]?.generation).toBe(1);
    expect(rows[0]?.currentPeriodEnd).toEqual(T2);

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('grant');
    expect(ledgerRows[0]?.creditType).toBe('irlo_plus');

    const [inboxRow] = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRow?.disposition).toBe('applied');
  });

  it('a first-ever purchase with an offer present creates generation 1 at trial', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;

    const result = await consumePurchaseEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T1,
      provider: 'stripe',
      providerSubscriptionId,
      memberId: seedMemberId,
      event: { type: 'purchased', offerPresent: true },
      productId: 'irlo.plus.monthly',
      invoiceOrTransactionId: `in_${randomUUID()}`,
    });

    expect(result).toEqual({ outcome: 'generation_created' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('trial');
  });

  it('RESUBSCRIBE on a live generation is a recorded no-op — existing generation untouched, but a genuinely new transaction id still records its grant (money always recorded)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;

    await consumePurchaseEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T1,
      provider: 'stripe',
      providerSubscriptionId,
      memberId: seedMemberId,
      event: { type: 'purchased', offerPresent: false },
      productId: 'irlo.plus.monthly',
      invoiceOrTransactionId: `in_${randomUUID()}`,
      periodEnd: T1,
    });

    const secondInvoiceId = `in_${randomUUID()}`;
    const secondEventId = randomUUID();
    const result = await consumePurchaseEvent(testDb.db, {
      source: 'stripe',
      eventId: secondEventId,
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      memberId: seedMemberId,
      event: { type: 'purchased', offerPresent: false },
      productId: 'irlo.plus.monthly',
      invoiceOrTransactionId: secondInvoiceId,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'no_op_live' });

    const rows = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.generation).toBe(1);

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${secondInvoiceId}`));
    expect(ledgerRows).toHaveLength(1);

    const [inboxRow] = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, secondEventId)));
    expect(inboxRow?.disposition).toBe('no_op_live');
  });

  it('RESUBSCRIBE on a terminal (expired) generation spawns generation 2 with its own grant row, generation 1 untouched', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await createSubscriptionsRepository(testDb.db).createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 1,
      state: 'expired',
      productId: 'irlo.plus.monthly',
      willRenew: false,
      currentPeriodEnd: T1,
      highWater: T1,
    });

    const invoiceId = `in_${randomUUID()}`;
    const result = await consumePurchaseEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      memberId: seedMemberId,
      event: { type: 'purchased', offerPresent: false },
      productId: 'irlo.plus.yearly',
      invoiceOrTransactionId: invoiceId,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'generation_created' });

    const rows = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
      .orderBy(subscriptions.generation);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.state).toBe('expired');
    expect(rows[1]?.generation).toBe(2);
    expect(rows[1]?.state).toBe('active');
    expect(rows[1]?.productId).toBe('irlo.plus.yearly');

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
  });

  it('propagates a genuine insert failure that is not a unique violation, and writes nothing (I4 atomicity)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const eventId = randomUUID();

    // payload is NOT NULL (23502), not the (source, event_id) unique
    // constraint (23505) — the outer catch's isUniqueViolation check must
    // not swallow this.
    await expect(
      consumePurchaseEvent(testDb.db, {
        source: 'stripe',
        eventId,
        eventType: 'invoice.paid',
        payload: null,
        effectiveAt: T1,
        provider: 'stripe',
        providerSubscriptionId,
        memberId: seedMemberId,
        event: { type: 'purchased', offerPresent: false },
        productId: 'irlo.plus.monthly',
        invoiceOrTransactionId: `in_${randomUUID()}`,
        periodEnd: T1,
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });

    const rows = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(rows).toHaveLength(0);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);
  });

  it('propagates a genuine ledger insert failure that is not a unique violation — the SAVEPOINT isolates it, but the whole call still fails and nothing commits', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const eventId = randomUUID();
    const noSuchMemberId = randomUUID(); // no members row for this id — 23503, not 23505

    await expect(
      consumePurchaseEvent(testDb.db, {
        source: 'stripe',
        eventId,
        eventType: 'invoice.paid',
        payload: {},
        effectiveAt: T1,
        provider: 'stripe',
        providerSubscriptionId,
        memberId: noSuchMemberId,
        event: { type: 'purchased', offerPresent: false },
        productId: 'irlo.plus.monthly',
        invoiceOrTransactionId: `in_${randomUUID()}`,
        periodEnd: T1,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });

    const rows = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(rows).toHaveLength(0);

    // the inbox row inserted earlier in the SAME outer transaction rolls
    // back too — the savepoint isolates the ledger insert specifically, it
    // doesn't make the overall call succeed.
    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);
  });

  it('Race 1 — two concurrent deliveries of the SAME event (identical eventId) for a brand-new subscription id: exactly one generation, one ledger row, one inbox row; one generation_created, one duplicate', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const eventId = randomUUID();
    const invoiceId = `in_${randomUUID()}`;
    const lockKey = subscriptionLockKey('stripe', providerSubscriptionId);

    const racePool = new Pool({ connectionString: testDb.container.getConnectionUri(), max: 3 });
    const raceDb = drizzle(racePool);

    try {
      const input = {
        source: 'stripe',
        eventId,
        eventType: 'invoice.paid',
        payload: { id: eventId },
        effectiveAt: T1,
        provider: 'stripe' as const,
        providerSubscriptionId,
        memberId: seedMemberId,
        event: { type: 'purchased' as const, offerPresent: false },
        productId: 'irlo.plus.monthly',
        invoiceOrTransactionId: invoiceId,
        periodEnd: T1,
      };

      const results = await raceViaAdvisoryLock(racePool, lockKey, [
        () => consumePurchaseEvent(raceDb, input),
        () => consumePurchaseEvent(raceDb, input),
      ]);

      expect(extractOutcomes(results)).toEqual(['duplicate', 'generation_created']);

      const rows = await testDb.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
      expect(rows).toHaveLength(1);

      const ledgerRows = await testDb.db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
      expect(ledgerRows).toHaveLength(1);

      const inboxRows = await testDb.db
        .select()
        .from(paymentEvents)
        .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
      expect(inboxRows).toHaveLength(1);
    } finally {
      await racePool.end();
    }
  });

  it('Race 2 — two concurrent DIFFERENT envelopes carrying the SAME ledger natural key (same invoice id, different eventId) for a brand-new subscription id: exactly one generation, one ledger row (I3), two inbox rows; one generation_created, one no_op_live', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;
    const eventIdA = randomUUID();
    const eventIdB = randomUUID();
    const lockKey = subscriptionLockKey('stripe', providerSubscriptionId);

    const racePool = new Pool({ connectionString: testDb.container.getConnectionUri(), max: 3 });
    const raceDb = drizzle(racePool);

    try {
      const baseInput = {
        source: 'stripe',
        eventType: 'invoice.paid',
        payload: {},
        effectiveAt: T1,
        provider: 'stripe' as const,
        providerSubscriptionId,
        memberId: seedMemberId,
        event: { type: 'purchased' as const, offerPresent: false },
        productId: 'irlo.plus.monthly',
        invoiceOrTransactionId: invoiceId,
        periodEnd: T1,
      };

      const results = await raceViaAdvisoryLock(racePool, lockKey, [
        () => consumePurchaseEvent(raceDb, { ...baseInput, eventId: eventIdA }),
        () => consumePurchaseEvent(raceDb, { ...baseInput, eventId: eventIdB }),
      ]);

      expect(extractOutcomes(results)).toEqual(['generation_created', 'no_op_live']);

      const rows = await testDb.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
      expect(rows).toHaveLength(1);

      const ledgerRows = await testDb.db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
      expect(ledgerRows).toHaveLength(1);

      const inboxRowsA = await testDb.db
        .select()
        .from(paymentEvents)
        .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventIdA)));
      const inboxRowsB = await testDb.db
        .select()
        .from(paymentEvents)
        .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventIdB)));
      expect(inboxRowsA).toHaveLength(1);
      expect(inboxRowsB).toHaveLength(1);
      expect([...inboxRowsA, ...inboxRowsB].map((r) => r.disposition).sort()).toEqual([
        'applied',
        'no_op_live',
      ]);
    } finally {
      await racePool.end();
    }
  });
});
