import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMembersRepository } from '../src/db/repositories/members.js';
import { paymentEvents, railIdentities } from '../src/db/schema/index.js';
import { consumeLinkageEvent } from '../src/payments/consume-linkage-event.js';

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

async function inboxRowsFor(eventId: string) {
  return testDb.db
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
}

describe('consumeLinkageEvent (ADR-0011 slice B — checkout.session.completed backstop, L1–L5)', () => {
  it('a fresh (customer, client_reference_id) pair creates a link and an inbox row — linked', async () => {
    const externalId = `cus_${randomUUID()}`;
    const eventId = randomUUID();

    const result = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: seedMemberId,
    });

    expect(result).toEqual({ outcome: 'linked' });

    const [link] = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(link?.memberId).toBe(seedMemberId);
    expect(link?.linkedVia).toBe('checkout_session_completed');

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.disposition).toBe('applied');
  });

  it('a redelivered identical envelope (same eventId) is a duplicate — no second link attempt, no second inbox row', async () => {
    const externalId = `cus_${randomUUID()}`;
    const eventId = randomUUID();
    const input = {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe' as const,
      externalId,
      clientReferenceId: seedMemberId,
    };

    const first = await consumeLinkageEvent(testDb.db, input);
    expect(first).toEqual({ outcome: 'linked' });

    const second = await consumeLinkageEvent(testDb.db, input);
    expect(second).toEqual({ outcome: 'duplicate' });

    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(1);

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(1);
  });

  it('the same member/customer pair arriving under a different envelope is already_linked — a fresh inbox row, no second link row', async () => {
    const externalId = `cus_${randomUUID()}`;
    const firstEventId = randomUUID();
    const secondEventId = randomUUID();

    const first = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId: firstEventId,
      eventType: 'checkout.session.completed',
      payload: { id: firstEventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: seedMemberId,
    });
    expect(first).toEqual({ outcome: 'linked' });

    const second = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId: secondEventId,
      eventType: 'checkout.session.completed',
      payload: { id: secondEventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: seedMemberId,
    });
    expect(second).toEqual({ outcome: 'already_linked' });

    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(1);

    const inboxRows = await inboxRowsFor(secondEventId);
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.disposition).toBe('applied');
  });

  it('a claim on an already-linked customer from a DIFFERENT member is a conflict — 2xx-worthy, but no repoint and no inbox row (L3)', async () => {
    const members = createMembersRepository(testDb.db);
    const otherMember = await members.create();
    const externalId = `cus_${randomUUID()}`;
    const firstEventId = randomUUID();
    const conflictingEventId = randomUUID();

    const first = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId: firstEventId,
      eventType: 'checkout.session.completed',
      payload: { id: firstEventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: seedMemberId,
    });
    expect(first).toEqual({ outcome: 'linked' });

    const conflict = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId: conflictingEventId,
      eventType: 'checkout.session.completed',
      payload: { id: conflictingEventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: otherMember.id,
    });
    expect(conflict).toEqual({ outcome: 'conflict' });

    // Never repointed (L3/L4) — the original link still resolves to the
    // original member.
    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0]?.memberId).toBe(seedMemberId);

    // No inbox row for the conflicting envelope — a duplicate delivery of
    // the SAME conflicting envelope must alert again, not dedupe silently.
    const inboxRows = await inboxRowsFor(conflictingEventId);
    expect(inboxRows).toHaveLength(0);
  });

  it('a client_reference_id naming no member is member_not_found — no link row, no inbox row', async () => {
    const externalId = `cus_${randomUUID()}`;
    const eventId = randomUUID();
    const noSuchMemberId = randomUUID();

    const result = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: noSuchMemberId,
    });

    expect(result).toEqual({ outcome: 'member_not_found' });

    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(0);

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(0);
  });

  it('a session missing customer is unattributable — no database interaction at all', async () => {
    const eventId = randomUUID();

    const result = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId: null,
      clientReferenceId: seedMemberId,
    });

    expect(result).toEqual({ outcome: 'unattributable' });

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(0);
  });

  it('a session missing client_reference_id is unattributable', async () => {
    const eventId = randomUUID();

    const result = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId: `cus_${randomUUID()}`,
      clientReferenceId: null,
    });

    expect(result).toEqual({ outcome: 'unattributable' });

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(0);
  });

  it('a malformed (non-uuid) client_reference_id is member_not_found, not an uncaught 5xx — it never resolves on redelivery any more than a deleted member does', async () => {
    const externalId = `cus_${randomUUID()}`;
    const eventId = randomUUID();

    // Trips Postgres's own uuid-format check on rail_identities.member_id
    // (22P02) before the FK constraint is even evaluated — reachable if a
    // checkout.session.completed ever echoes a client_reference_id we
    // didn't set, not merely defensive.
    const result = await consumeLinkageEvent(testDb.db, {
      source: 'stripe',
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      effectiveAt: T1,
      provider: 'stripe',
      externalId,
      clientReferenceId: 'not-a-valid-uuid',
    });

    expect(result).toEqual({ outcome: 'member_not_found' });

    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(0);

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(0);
  });

  it('propagates a genuine insert failure that is not a unique or foreign-key violation, and writes nothing (I4 atomicity)', async () => {
    const externalId = `cus_${randomUUID()}`;
    const eventId = randomUUID();

    // payload is NOT NULL (23502) on payment_events — but the link insert
    // above it in the transaction must succeed and then roll back, not the
    // reverse; picking a fresh externalId isolates this from the other
    // tests' link rows.
    await expect(
      consumeLinkageEvent(testDb.db, {
        source: 'stripe',
        eventId,
        eventType: 'checkout.session.completed',
        payload: null,
        effectiveAt: T1,
        provider: 'stripe',
        externalId,
        clientReferenceId: seedMemberId,
      }),
    ).rejects.toMatchObject({ cause: { code: '23502' } });

    const linkRows = await testDb.db
      .select()
      .from(railIdentities)
      .where(and(eq(railIdentities.provider, 'stripe'), eq(railIdentities.externalId, externalId)));
    expect(linkRows).toHaveLength(0);

    const inboxRows = await inboxRowsFor(eventId);
    expect(inboxRows).toHaveLength(0);
  });
});
