import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createInboxRepository } from '../src/db/repositories/inbox.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

describe('inbox repository (C23 — idempotency layer 1)', () => {
  it('inserts a new event and reports it as inserted', async () => {
    const repo = createInboxRepository(testDb.db);

    const result = await repo.tryInsert({
      source: 'stripe-webhook',
      eventId: `evt_${randomUUID()}`,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied',
    });

    expect(result.inserted).toBe(true);
    expect(result.row.disposition).toBe('applied');
  });

  it('is a no-op on exact envelope redelivery — same (source, event_id) twice', async () => {
    const repo = createInboxRepository(testDb.db);
    const input = {
      source: 'stripe-webhook',
      eventId: `evt_${randomUUID()}`,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied' as const,
    };

    const first = await repo.tryInsert(input);
    const second = await repo.tryInsert({ ...input, disposition: 'duplicate' });

    expect(second.inserted).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    // The original row is untouched — a replay never rewrites an already-applied
    // disposition, even though the caller passed a different one this time.
    expect(second.row.disposition).toBe('applied');
  });

  it('records the caller-supplied disposition on a genuinely new event', async () => {
    const repo = createInboxRepository(testDb.db);

    const result = await repo.tryInsert({
      source: 'apple-webhook',
      eventId: `notif_${randomUUID()}`,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'superseded',
    });

    expect(result.inserted).toBe(true);
    expect(result.row.disposition).toBe('superseded');
  });

  it('treats the same event_id from different sources as distinct events', async () => {
    const repo = createInboxRepository(testDb.db);
    const eventId = `shared_${randomUUID()}`;

    const fromStripe = await repo.tryInsert({
      source: 'stripe-webhook',
      eventId,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied',
    });
    const fromApple = await repo.tryInsert({
      source: 'apple-webhook',
      eventId,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied',
    });

    expect(fromStripe.inserted).toBe(true);
    expect(fromApple.inserted).toBe(true);
    expect(fromApple.row.id).not.toBe(fromStripe.row.id);
  });

  it('propagates a genuine insert failure that is not a unique violation', async () => {
    const repo = createInboxRepository(testDb.db);

    // payload is NOT NULL (23502) — a distinct failure from the
    // (source, event_id) unique violation (23505) tryInsert() catches;
    // that catch must not swallow this one.
    await expect(
      repo.tryInsert({
        source: 'stripe-webhook',
        eventId: `evt_${randomUUID()}`,
        payload: null,
        effectiveAt: new Date(),
        disposition: 'applied',
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});
