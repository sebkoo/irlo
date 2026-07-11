import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';
import { createSubscriptionsRepository } from '../src/db/repositories/subscriptions.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;
let seedMemberId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  const members = createMembersRepository(testDb.db);
  const seedMember = await members.create();
  seedMemberId = seedMember.id;
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

describe('subscriptions repository (C-next: webhook consumer executor substrate)', () => {
  it('getLatestGeneration returns undefined for a never-seen (provider, providerSubscriptionId)', async () => {
    const repo = createSubscriptionsRepository(testDb.db);

    const result = await repo.getLatestGeneration('stripe', `sub_${randomUUID()}`);

    expect(result).toBeUndefined();
  });

  it('createGeneration inserts a fresh generation and getLatestGeneration finds it', async () => {
    const repo = createSubscriptionsRepository(testDb.db);
    const providerSubscriptionId = `sub_${randomUUID()}`;

    const created = await repo.createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 1,
      state: 'active',
      productId: 'price_monthly',
      willRenew: true,
      currentPeriodEnd: null,
      highWater: null,
    });

    expect(created.generation).toBe(1);
    expect(created.state).toBe('active');

    const found = await repo.getLatestGeneration('stripe', providerSubscriptionId);

    expect(found?.id).toBe(created.id);
  });

  it('getLatestGeneration returns the highest generation when multiple exist', async () => {
    const repo = createSubscriptionsRepository(testDb.db);
    const providerSubscriptionId = `sub_${randomUUID()}`;

    await repo.createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 1,
      state: 'expired',
      productId: 'price_monthly',
      willRenew: false,
      currentPeriodEnd: null,
      highWater: null,
    });
    const gen2 = await repo.createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 2,
      state: 'active',
      productId: 'price_monthly',
      willRenew: true,
      currentPeriodEnd: null,
      highWater: null,
    });

    const found = await repo.getLatestGeneration('stripe', providerSubscriptionId);

    expect(found?.id).toBe(gen2.id);
    expect(found?.generation).toBe(2);
  });

  it('updateGeneration patches the mutable fields on an existing row', async () => {
    const repo = createSubscriptionsRepository(testDb.db);
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const created = await repo.createGeneration({
      memberId: seedMemberId,
      provider: 'stripe',
      providerSubscriptionId,
      generation: 1,
      state: 'active',
      productId: 'price_monthly',
      willRenew: true,
      currentPeriodEnd: null,
      highWater: null,
    });
    const periodEnd = new Date('2026-03-01T00:00:00Z');
    const highWater = new Date('2026-02-01T00:00:00Z');

    const updated = await repo.updateGeneration(created.id, {
      state: 'grace',
      willRenew: false,
      currentPeriodEnd: periodEnd,
      highWater,
    });

    expect(updated.state).toBe('grace');
    expect(updated.willRenew).toBe(false);
    expect(updated.currentPeriodEnd).toEqual(periodEnd);
    expect(updated.highWater).toEqual(highWater);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('propagates a genuine insert failure that is not a unique violation', async () => {
    const repo = createSubscriptionsRepository(testDb.db);

    // A nonexistent memberId trips the members FK (23503), not the
    // (provider, providerSubscriptionId, generation) unique constraint.
    await expect(
      repo.createGeneration({
        memberId: randomUUID(),
        provider: 'stripe',
        providerSubscriptionId: `sub_${randomUUID()}`,
        generation: 1,
        state: 'active',
        productId: 'price_monthly',
        willRenew: true,
        currentPeriodEnd: null,
        highWater: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
