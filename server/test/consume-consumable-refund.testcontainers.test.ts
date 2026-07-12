import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLedgerRepository } from '../src/db/repositories/ledger.js';
import { createMembersRepository } from '../src/db/repositories/members.js';
import { paymentEvents } from '../src/db/schema/index.js';
import { consumeConsumableRefund } from '../src/payments/consume-consumable-refund.js';

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

describe('consumeConsumableRefund (ADR-0009 I2 — the negative-balance debt path)', () => {
  it('a refund-debit reduces an existing positive balance', async () => {
    const ledger = createLedgerRepository(testDb.db);
    await ledger.append({
      memberId: seedMemberId,
      entryType: 'credit',
      creditType: 'spark',
      naturalKey: `apple:${randomUUID()}`,
      quantity: 5,
    });

    const refundId = `re_${randomUUID()}`;
    const result = await consumeConsumableRefund(testDb.db, {
      source: 'apple',
      eventId: randomUUID(),
      eventType: 'REFUND',
      payload: {},
      effectiveAt: T1,
      provider: 'apple',
      refundId,
      memberId: seedMemberId,
      creditType: 'spark',
      quantity: 2,
    });

    expect(result).toEqual({ outcome: 'applied' });
    expect(await ledger.getBalance(seedMemberId, 'spark')).toBe(3);
  });

  it('I2 debt path: a refund-debit on an already-fully-spent balance drives it negative, no clamp, no throw', async () => {
    const ledger = createLedgerRepository(testDb.db);
    // no prior credit at all for this credit type — balance starts at 0
    const refundId = `re_${randomUUID()}`;

    const result = await consumeConsumableRefund(testDb.db, {
      source: 'apple',
      eventId: randomUUID(),
      eventType: 'REFUND',
      payload: {},
      effectiveAt: T1,
      provider: 'apple',
      refundId,
      memberId: seedMemberId,
      creditType: 'undo',
      quantity: 4,
    });

    expect(result).toEqual({ outcome: 'applied' });
    expect(await ledger.getBalance(seedMemberId, 'undo')).toBe(-4);
  });

  it('I3: replaying the same refund id under a different eventId adds no second row, balance unaffected the second time', async () => {
    const ledger = createLedgerRepository(testDb.db);
    const refundId = `re_${randomUUID()}`;
    const baseInput = {
      source: 'apple' as const,
      eventType: 'REFUND',
      payload: {},
      effectiveAt: T1,
      provider: 'apple' as const,
      refundId,
      memberId: seedMemberId,
      creditType: 'waitlist_skip',
      quantity: 1,
    };

    const first = await consumeConsumableRefund(testDb.db, { ...baseInput, eventId: randomUUID() });
    expect(first).toEqual({ outcome: 'applied' });
    const balanceAfterFirst = await ledger.getBalance(seedMemberId, 'waitlist_skip');

    const second = await consumeConsumableRefund(testDb.db, {
      ...baseInput,
      eventId: randomUUID(),
    });
    expect(second).toEqual({ outcome: 'applied' });

    expect(await ledger.getBalance(seedMemberId, 'waitlist_skip')).toBe(balanceAfterFirst);
  });

  it('a redelivered (source, eventId) is reported duplicate and applies no second effect', async () => {
    const ledger = createLedgerRepository(testDb.db);
    const eventId = randomUUID();
    const input = {
      source: 'apple' as const,
      eventId,
      eventType: 'REFUND',
      payload: {},
      effectiveAt: T1,
      provider: 'apple' as const,
      refundId: `re_${randomUUID()}`,
      memberId: seedMemberId,
      creditType: 'spark',
      quantity: 1,
    };

    const first = await consumeConsumableRefund(testDb.db, input);
    expect(first).toEqual({ outcome: 'applied' });
    const balanceAfterFirst = await ledger.getBalance(seedMemberId, 'spark');

    const second = await consumeConsumableRefund(testDb.db, input);
    expect(second).toEqual({ outcome: 'duplicate' });

    expect(await ledger.getBalance(seedMemberId, 'spark')).toBe(balanceAfterFirst);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'apple'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);
  });

  it('propagates a genuine insert failure that is not a unique violation, and writes nothing (I4 atomicity — inbox)', async () => {
    const eventId = randomUUID();

    await expect(
      consumeConsumableRefund(testDb.db, {
        source: 'apple',
        eventId,
        eventType: 'REFUND',
        payload: null,
        effectiveAt: T1,
        provider: 'apple',
        refundId: `re_${randomUUID()}`,
        memberId: seedMemberId,
        creditType: 'spark',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'apple'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);
  });

  it('propagates a genuine ledger insert failure that is not a unique violation (bogus memberId, FK violation) — the SAVEPOINT isolates it, but the whole call still fails and nothing commits', async () => {
    const eventId = randomUUID();
    const noSuchMemberId = randomUUID();

    await expect(
      consumeConsumableRefund(testDb.db, {
        source: 'apple',
        eventId,
        eventType: 'REFUND',
        payload: {},
        effectiveAt: T1,
        provider: 'apple',
        refundId: `re_${randomUUID()}`,
        memberId: noSuchMemberId,
        creditType: 'spark',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'apple'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);
  });

  it('Race 4 — two concurrent deliveries of the SAME event (identical eventId): exactly one debit row; one applied, one duplicate (no lock needed — the unique constraint alone serializes this)', async () => {
    const ledger = createLedgerRepository(testDb.db);
    const balanceBefore = await ledger.getBalance(seedMemberId, 'spark');
    const eventId = randomUUID();
    const input = {
      source: 'apple' as const,
      eventId,
      eventType: 'REFUND',
      payload: {},
      effectiveAt: T1,
      provider: 'apple' as const,
      refundId: `re_${randomUUID()}`,
      memberId: seedMemberId,
      creditType: 'spark',
      quantity: 1,
    };

    const results = await Promise.allSettled([
      consumeConsumableRefund(testDb.db, input),
      consumeConsumableRefund(testDb.db, input),
    ]);

    const outcomes = results
      .map((r) => {
        if (r.status !== 'fulfilled') throw new Error(`racer rejected: ${String(r.reason)}`);
        return r.value.outcome;
      })
      .sort();
    expect(outcomes).toEqual(['applied', 'duplicate']);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'apple'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);
    // exactly-once: the debit landed once, not twice — a delta against the
    // pre-race balance, not an absolute value, since seedMemberId's 'spark'
    // balance already carries state from earlier tests in this file.
    expect(await ledger.getBalance(seedMemberId, 'spark')).toBe(balanceBefore - 1);
  });
});
