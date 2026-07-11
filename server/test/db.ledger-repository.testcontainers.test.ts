import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLedgerRepository } from '../src/db/repositories/ledger.js';
import { createMembersRepository } from '../src/db/repositories/members.js';

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

describe('ledger repository (C23)', () => {
  it('appends a credit entry and reflects it in the balance', async () => {
    const repo = createLedgerRepository(testDb.db);

    await repo.append({
      memberId: seedMemberId,
      entryType: 'credit',
      creditType: 'spark',
      quantity: 5,
      naturalKey: `apple:${randomUUID()}`,
    });

    const balance = await repo.getBalance(seedMemberId, 'spark');

    expect(balance).toBe(5);
  });

  it('nets credit and debit rows into the balance', async () => {
    const repo = createLedgerRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;

    await repo.append({
      memberId,
      entryType: 'credit',
      creditType: 'undo',
      quantity: 10,
      naturalKey: `apple:${randomUUID()}`,
    });
    await repo.append({
      memberId,
      entryType: 'debit',
      creditType: 'undo',
      quantity: 3,
      naturalKey: `member:${memberId}:idempotency:${randomUUID()}`,
    });

    const balance = await repo.getBalance(memberId, 'undo');

    expect(balance).toBe(7);
  });

  it('is idempotent on natural_key — replaying the same append adds no row and returns the original', async () => {
    const repo = createLedgerRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;
    const naturalKey = `apple:${randomUUID()}`;
    const input = {
      memberId,
      entryType: 'credit' as const,
      creditType: 'spark',
      quantity: 5,
      naturalKey,
    };

    const first = await repo.append(input);
    const second = await repo.append(input);

    expect(second.id).toBe(first.id);
    expect(await repo.getBalance(memberId, 'spark')).toBe(5);
  });

  it('allows a reversal to drive the balance negative — member debt, no clamping (I2)', async () => {
    const repo = createLedgerRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;

    await repo.append({
      memberId,
      entryType: 'credit',
      creditType: 'spark',
      quantity: 5,
      naturalKey: `apple:${randomUUID()}`,
    });
    await repo.append({
      memberId,
      entryType: 'debit',
      creditType: 'spark',
      quantity: 5,
      naturalKey: `member:${memberId}:idempotency:${randomUUID()}`,
    });
    // The pack is refunded after being fully spent — the reversal is
    // recorded as a debit against the countable balance (ADR-0009: credit/
    // debit are the countable row shapes; grant/reversal are irlo.plus-only).
    await repo.append({
      memberId,
      entryType: 'debit',
      creditType: 'spark',
      quantity: 5,
      naturalKey: `apple:refund:${randomUUID()}`,
    });

    expect(await repo.getBalance(memberId, 'spark')).toBe(-5);
  });

  it('returns zero balance for a member with no ledger history', async () => {
    const repo = createLedgerRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;

    expect(await repo.getBalance(memberId, 'spark')).toBe(0);
  });

  it('scopes balance to the given credit type — other buckets do not leak in', async () => {
    const repo = createLedgerRepository(testDb.db);
    const memberId = (await createMembersRepository(testDb.db).create()).id;

    await repo.append({
      memberId,
      entryType: 'credit',
      creditType: 'spark',
      quantity: 5,
      naturalKey: `apple:${randomUUID()}`,
    });

    expect(await repo.getBalance(memberId, 'undo')).toBe(0);
  });
});
