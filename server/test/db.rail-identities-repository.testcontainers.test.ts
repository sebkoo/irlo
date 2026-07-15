import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';
import { createRailIdentitiesRepository } from '../src/db/repositories/rail-identities.js';

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

describe('rail identities repository (ADR-0011 slice A)', () => {
  it('createLink commits a link and resolveMemberByRailIdentity finds it', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const externalId = `cus_${randomUUID()}`;

    const created = await repo.createLink({
      memberId: seedMemberId,
      provider: 'stripe',
      externalId,
      linkedVia: 'checkout_session',
    });

    expect(created.memberId).toBe(seedMemberId);

    const resolved = await repo.resolveMemberByRailIdentity('stripe', externalId);

    expect(resolved).toBe(seedMemberId);
  });

  it('resolveMemberByRailIdentity returns undefined for an unknown (provider, externalId)', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);

    const resolved = await repo.resolveMemberByRailIdentity('stripe', `cus_${randomUUID()}`);

    expect(resolved).toBeUndefined();
  });

  it('resolveMemberByRailIdentity scopes by provider — the same externalId under a different provider resolves a different member', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const members = createMembersRepository(testDb.db);
    const otherMember = await members.create();
    // UNIQUE(provider, external_id) makes this schema-legal: the same raw
    // string can be one member's Stripe customer id and a different
    // member's Apple token. A resolver that dropped the provider predicate
    // would misattribute one member's purchase to the other.
    const sharedExternalId = randomUUID();

    await repo.createLink({
      memberId: seedMemberId,
      provider: 'apple',
      externalId: sharedExternalId,
      linkedVia: 'minted',
    });
    await repo.createLink({
      memberId: otherMember.id,
      provider: 'stripe',
      externalId: sharedExternalId,
      linkedVia: 'checkout_session',
    });

    expect(await repo.resolveMemberByRailIdentity('stripe', sharedExternalId)).toBe(otherMember.id);
    expect(await repo.resolveMemberByRailIdentity('apple', sharedExternalId)).toBe(seedMemberId);
  });

  it('rejects a conflicting (provider, externalId) claim from a different member — L3/L4: never a repoint', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const members = createMembersRepository(testDb.db);
    const otherMember = await members.create();
    const externalId = `cus_${randomUUID()}`;

    await repo.createLink({
      memberId: seedMemberId,
      provider: 'stripe',
      externalId,
      linkedVia: 'checkout_session',
    });

    // Deliberately no catch-and-recover here (same discipline as
    // SubscriptionsRepository.createGeneration): the repository exposes no
    // update path for member_id (L4), so a second claim on the same
    // identity — even from a different member — can only ever surface as
    // the unique-violation error, never silently repoint the link.
    await expect(
      repo.createLink({
        memberId: otherMember.id,
        provider: 'stripe',
        externalId,
        linkedVia: 'checkout_session',
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });

    const resolved = await repo.resolveMemberByRailIdentity('stripe', externalId);
    expect(resolved).toBe(seedMemberId);
  });

  it('rejects a redelivered identical claim from the same member with the same unique-violation error', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const externalId = `cus_${randomUUID()}`;
    const linkInput = {
      memberId: seedMemberId,
      provider: 'stripe' as const,
      externalId,
      linkedVia: 'checkout_session',
    };

    await repo.createLink(linkInput);

    // Disambiguating this from the conflicting-claim case above (same
    // member vs a different one) is the linkage consumer's job (slice B);
    // the repository itself makes no distinction — every second claim on
    // the same (provider, externalId) hits the same constraint.
    await expect(repo.createLink(linkInput)).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it('propagates a genuine insert failure that is not a unique violation', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);

    // A nonexistent memberId trips the members FK (23503), not the
    // (provider, externalId) unique constraint.
    await expect(
      repo.createLink({
        memberId: randomUUID(),
        provider: 'stripe',
        externalId: `cus_${randomUUID()}`,
        linkedVia: 'checkout_session',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('getLatestIdentity returns undefined when the member has no identity for that provider', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const members = createMembersRepository(testDb.db);
    const freshMember = await members.create();

    const result = await repo.getLatestIdentity(freshMember.id, 'stripe');

    expect(result).toBeUndefined();
  });

  it('getLatestIdentity returns the newest identity for a (member, provider) pair — checkout-time Customer reuse (§3a)', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const members = createMembersRepository(testDb.db);
    const member = await members.create();

    const first = await repo.createLink({
      memberId: member.id,
      provider: 'stripe',
      externalId: `cus_${randomUUID()}`,
      linkedVia: 'checkout_session',
    });
    // A support-recreated Customer: the old row is retained (§3f), and
    // "the" identity a checkout-time reuse should pick up is the new one.
    const second = await repo.createLink({
      memberId: member.id,
      provider: 'stripe',
      externalId: `cus_${randomUUID()}`,
      linkedVia: 'operator',
    });

    const latest = await repo.getLatestIdentity(member.id, 'stripe');

    expect(latest?.id).toBe(second.id);
    expect(latest?.id).not.toBe(first.id);
  });

  it('getLatestIdentity does not cross providers for the same member', async () => {
    const repo = createRailIdentitiesRepository(testDb.db);
    const members = createMembersRepository(testDb.db);
    const member = await members.create();

    await repo.createLink({
      memberId: member.id,
      provider: 'apple',
      externalId: randomUUID(),
      linkedVia: 'minted',
    });

    const result = await repo.getLatestIdentity(member.id, 'stripe');

    expect(result).toBeUndefined();
  });
});
