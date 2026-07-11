import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consumeContextEvent } from '../src/payments/consume-context-event.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { createSubscriptionsRepository } from '../src/db/repositories/subscriptions.js';
import { paymentEvents, subscriptions } from '../src/db/schema/index.js';

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

async function seedGeneration(providerSubscriptionId: string) {
  return createSubscriptionsRepository(testDb.db).createGeneration({
    memberId: seedMemberId,
    provider: 'stripe',
    providerSubscriptionId,
    generation: 1,
    state: 'active',
    productId: 'price_monthly',
    willRenew: true,
    currentPeriodEnd: T1,
    highWater: T1,
  });
}

describe('consumeContextEvent (ADR-0009 I4 — transactional inbox, context-only events)', () => {
  it('applies autorenew_set: updates the subscription and inserts an applied inbox row', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();

    const result = await consumeContextEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'customer.subscription.updated',
      payload: { id: eventId },
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'autorenew_set', willRenew: false },
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.willRenew).toBe(false);
    expect(row?.highWater).toEqual(T2);

    const [inboxRow] = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRow?.disposition).toBe('applied');
  });

  it('applies plan_changed: updates productId', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();

    const result = await consumeContextEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'customer.subscription.updated',
      payload: { id: eventId },
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'plan_changed', productId: 'price_yearly' },
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.productId).toBe('price_yearly');
  });

  it('applies renewal_extended: extends currentPeriodEnd via the input periodEnd, not silently a no-op', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId); // currentPeriodEnd: T1
    const eventId = randomUUID();
    const extendedPeriodEnd = new Date('2026-02-01T00:00:00Z');

    const result = await consumeContextEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'customer.subscription.updated',
      payload: { id: eventId },
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'renewal_extended' },
      periodEnd: extendedPeriodEnd,
    });

    expect(result).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.currentPeriodEnd).toEqual(extendedPeriodEnd);
  });

  it('a stale context event reports superseded and does not update willRenew/productId', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const generation = await createSubscriptionsRepository(testDb.db).createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 1,
      state: 'active',
      productId: 'price_monthly',
      willRenew: true,
      currentPeriodEnd: T1,
      highWater: T2, // already advanced past T1
    });

    const result = await consumeContextEvent(testDb.db, {
      source: 'stripe',
      eventId: randomUUID(),
      eventType: 'customer.subscription.updated',
      payload: {},
      effectiveAt: T1, // stale relative to highWater
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'autorenew_set', willRenew: false },
    });

    expect(result).toEqual({ outcome: 'superseded' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, generation.id));
    expect(row?.willRenew).toBe(true);
  });

  it('a redelivered (source, eventId) is reported duplicate and applies no second effect', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();
    const input = {
      source: 'stripe',
      eventId,
      eventType: 'customer.subscription.updated',
      payload: { id: eventId },
      effectiveAt: T2,
      provider: 'stripe' as const,
      providerSubscriptionId,
      event: { type: 'autorenew_set' as const, willRenew: false },
    };

    const first = await consumeContextEvent(testDb.db, input);
    expect(first).toEqual({ outcome: 'applied' });

    const second = await consumeContextEvent(testDb.db, input);
    expect(second).toEqual({ outcome: 'duplicate' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);
  });

  it('reports no_matching_generation for a never-seen (provider, providerSubscriptionId), with no inbox row written', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const eventId = randomUUID();

    const result = await consumeContextEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'customer.subscription.updated',
      payload: {},
      effectiveAt: T2,
      provider: 'stripe',
      providerSubscriptionId,
      event: { type: 'autorenew_set', willRenew: false },
    });

    expect(result).toEqual({ outcome: 'no_matching_generation' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);
  });

  it('propagates a genuine insert failure that is not a unique violation, and writes nothing', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = randomUUID();

    // payload is NOT NULL (23502), not the (source, event_id) unique
    // constraint (23505) — the outer catch's isUniqueViolation check must
    // not swallow this.
    await expect(
      consumeContextEvent(testDb.db, {
        source: 'stripe',
        eventId,
        eventType: 'customer.subscription.updated',
        payload: null,
        effectiveAt: T2,
        provider: 'stripe',
        providerSubscriptionId,
        event: { type: 'autorenew_set', willRenew: false },
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });

    // The transaction rolled back — no inbox row, and the subscription's
    // willRenew is untouched by the failed write.
    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.willRenew).toBe(true);
  });
});
