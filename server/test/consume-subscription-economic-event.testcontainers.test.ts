import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';
import {
  createSubscriptionsRepository,
  type CreateSubscriptionGenerationInput,
} from '../src/db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents, subscriptions } from '../src/db/schema/index.js';
import { consumeSubscriptionEconomicEvent } from '../src/payments/consume-subscription-economic-event.js';
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
const T3 = new Date('2026-02-01T00:00:00Z');

function extractOutcomes(results: PromiseSettledResult<{ outcome: string }>[]): string[] {
  return results
    .map((r) => {
      if (r.status !== 'fulfilled') throw new Error(`racer rejected: ${String(r.reason)}`);
      return r.value.outcome;
    })
    .sort();
}

async function seedGeneration(
  providerSubscriptionId: string,
  overrides: Partial<CreateSubscriptionGenerationInput> = {},
) {
  return createSubscriptionsRepository(testDb.db).createGeneration({
    memberId: seedMemberId,
    provider: 'stripe',
    providerSubscriptionId,
    generation: 1,
    state: 'active',
    productId: 'irlo.plus.monthly',
    willRenew: true,
    currentPeriodEnd: T1,
    highWater: T1,
    ...overrides,
  });
}

describe('consumeSubscriptionEconomicEvent (ADR-0009 — renewed/refunded on an existing generation, I2/I3/I4/I5a)', () => {
  it('renewed: active self-loop appends a grant row (with periodStart) and updates currentPeriodEnd', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const invoiceId = `in_${randomUUID()}`;

    const eventId = randomUUID();
    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: invoiceId,
      periodStart: T1,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('active');
    expect(row?.currentPeriodEnd).toEqual(T2);
    expect(row?.highWater).toEqual(T2);

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('grant');
    expect(ledgerRows[0]?.creditType).toBe('irlo_plus');
    expect(ledgerRows[0]?.periodStart).toEqual(T1);
    expect(ledgerRows[0]?.periodEnd).toEqual(T2);

    const [inboxRow] = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRow?.disposition).toBe('applied');
  });

  it('renewed: trial converts to active (no periodStart supplied)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId, { state: 'trial', currentPeriodEnd: null });
    const eventId = randomUUID();

    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: `in_${randomUUID()}`,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('active');

    const [inboxRow] = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRow?.disposition).toBe('applied');
  });

  it('refunded: active moves to refunded and appends a reversal row', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const refundId = `re_${randomUUID()}`;

    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'charge.refunded',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'refunded' },
      providerReferenceId: refundId,
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('refunded');

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:refund:${refundId}`));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('reversal');
  });

  it('refunded on an already-terminal generation is no_op_terminal, but the reversal row still appends (money always recorded)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId, { state: 'expired', willRenew: false });
    const refundId = `re_${randomUUID()}`;

    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'charge.refunded',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'refunded' },
      providerReferenceId: refundId,
    });

    expect(result).toEqual({ outcome: 'no_op_terminal' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('expired');

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:refund:${refundId}`));
    expect(ledgerRows).toHaveLength(1);
  });

  it('I5a at the executor level: a stale renewed still appends its grant row and merges period context, reports superseded, state untouched', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId, {
      state: 'grace',
      currentPeriodEnd: T1,
      highWater: T3, // already advanced past T2 by a later context event
    });
    const invoiceId = `in_${randomUUID()}`;

    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2, // stale relative to highWater
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: invoiceId,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'superseded' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.state).toBe('grace'); // state transition suppressed
    expect(row?.currentPeriodEnd).toEqual(T2); // period context still merges
    expect(row?.highWater).toEqual(T3); // untouched — already later

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1); // the grant still appended
  });

  it('reports no_matching_generation for a never-seen (provider, providerSubscriptionId), with no inbox row written', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;

    const result = await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: `in_${randomUUID()}`,
      periodEnd: T2,
    });

    expect(result).toEqual({ outcome: 'no_matching_generation' });
  });

  it('a redelivered (source, eventId) is reported duplicate and applies no second effect', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();
    const input = {
      source: 'stripe',
      eventId,
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe' as const,
      providerSubscriptionId,
      event: { type: 'renewed' as const },
      providerReferenceId: `in_${randomUUID()}`,
      periodEnd: T2,
    };

    const first = await consumeSubscriptionEconomicEvent(testDb.db, input);
    expect(first).toEqual({ outcome: 'applied' });

    const second = await consumeSubscriptionEconomicEvent(testDb.db, input);
    expect(second).toEqual({ outcome: 'duplicate' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);
  });

  it('I3 sequentially: two different envelopes carrying the same providerReferenceId add only one ledger row', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const invoiceId = `in_${randomUUID()}`;

    await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: invoiceId,
      periodEnd: T2,
    });

    await consumeSubscriptionEconomicEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'invoice.paid',
      payload: {},
      effectiveAt: T3,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewed' },
      providerReferenceId: invoiceId,
      periodEnd: T3,
    });

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
  });

  it('propagates a genuine insert failure that is not a unique violation, and writes nothing (I4 atomicity)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();

    await expect(
      consumeSubscriptionEconomicEvent(testDb.db, {
        source: 'stripe',
        eventId,
        eventType: 'invoice.paid',
        payload: null,
        effectiveAt: T2,
        provider: 'stripe',
        providerSubscriptionId,
        event: { type: 'renewed' },
        providerReferenceId: `in_${randomUUID()}`,
        periodEnd: T2,
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.currentPeriodEnd).toEqual(T1);
  });

  it('Race 3 — two concurrent deliveries of the SAME event (identical eventId) on an existing live generation: exactly one grant row, one inbox row; one applied, one duplicate', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
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
        payload: {},
        effectiveAt: T2,
        provider: 'stripe' as const,
        providerSubscriptionId,
        event: { type: 'renewed' as const },
        providerReferenceId: invoiceId,
        periodEnd: T2,
      };

      const results = await raceViaAdvisoryLock(racePool, lockKey, [
        () => consumeSubscriptionEconomicEvent(raceDb, input),
        () => consumeSubscriptionEconomicEvent(raceDb, input),
      ]);

      expect(extractOutcomes(results)).toEqual(['applied', 'duplicate']);

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
});
