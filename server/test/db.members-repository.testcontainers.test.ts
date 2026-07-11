import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';

import { startTestDb, stopTestDb, type TestDb } from './support/testcontainers-postgres.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

describe('members repository (C22)', () => {
  it('creates a member and round-trips it by id', async () => {
    const repo = createMembersRepository(testDb.db);

    const created = await repo.create();
    const fetched = await repo.getById(created.id);

    expect(fetched).toEqual(created);
  });

  it('returns undefined for a nonexistent id', async () => {
    const repo = createMembersRepository(testDb.db);
    // Seed a real row first: on an empty table, a broken/missing WHERE
    // clause would also happen to return undefined, so this assertion is
    // only meaningful — and order-independent — with a row present to miss.
    await repo.create();

    const fetched = await repo.getById(randomUUID());

    expect(fetched).toBeUndefined();
  });

  it('creates distinct members with distinct ids', async () => {
    const repo = createMembersRepository(testDb.db);

    const first = await repo.create();
    const second = await repo.create();

    expect(first.id).not.toBe(second.id);
  });
});
