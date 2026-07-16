import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrincipalContext } from '../../src/capabilities/can.js';
import type { Authenticator } from '../../src/capabilities/gating.js';
import { createApplicationsRepository } from '../../src/db/repositories/applications.js';
import { createLedgerRepository } from '../../src/db/repositories/ledger.js';
import { createMembersRepository } from '../../src/db/repositories/members.js';
import type { applications } from '../../src/db/schema/index.js';
import { MemoryLogStream } from '../support/memory-log-stream.js';
import { startTestDb, stopTestDb, type TestDb } from '../support/testcontainers-postgres.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

// A test-only header carries which member is making the request — a stand-in
// for a real session/token, exactly the seam buildApp's authenticator option
// documents (slice D's pending auth-shape question, unchanged here).
const MEMBER_HEADER = 'x-test-member-id';

function buildTestApp(admissionState: PrincipalContext['admissionState'] | 'none') {
  const authenticator: Authenticator = {
    identify: (req) => {
      const memberId = req.headers[MEMBER_HEADER];
      if (typeof memberId !== 'string') return undefined;
      if (admissionState === 'none') return undefined;
      return { memberId, admissionState, entitlements: { irloPlus: false } };
    },
  };

  return buildApp({
    loggerStream: new MemoryLogStream(),
    db: testDb.db,
    authenticator,
    config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'debug' },
  });
}

async function seedMember() {
  return (await createMembersRepository(testDb.db).create()).id;
}

async function seedApplication(
  memberId: string,
  state: (typeof applications.$inferSelect)['state'],
  lane: (typeof applications.$inferSelect)['lane'] = null,
) {
  return createApplicationsRepository(testDb.db).createGeneration({
    memberId,
    crewId: randomUUID(),
    generation: 1,
    state,
    lane,
    cooldownUntil: null,
  });
}

async function grantSkipCredit(memberId: string) {
  await createLedgerRepository(testDb.db).append({
    memberId,
    entryType: 'credit',
    creditType: 'waitlist_skip',
    quantity: 1,
    naturalKey: `test:grant:${randomUUID()}`,
  });
}

describe('POST /applications/:applicationId/waitlist-skip (C34-C35 first product route)', () => {
  it('200s and promotes the lane on a well-formed, well-credited request', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);
    const application = await seedApplication(memberId, 'waitlisted', 'standard');
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${application.id}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'applied' });

    await app.close();
  });

  it('401s when the authenticator finds no principal', async () => {
    const app = buildTestApp('none');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${randomUUID()}/waitlist-skip`)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(401);

    await app.close();
  });

  it('403s when the principal has no live pending application at all (boost_visibility denied)', async () => {
    const memberId = await seedMember();
    const app = buildTestApp(null);
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${randomUUID()}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'capability_denied', capability: 'boost_visibility' });

    await app.close();
  });

  it('404s for a nonexistent applicationId', async () => {
    const memberId = await seedMember();
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${randomUUID()}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ outcome: 'not_found' });

    await app.close();
  });

  it('409s with already_priority for a new key against an already-priority application', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);
    const application = await seedApplication(memberId, 'waitlisted', 'priority');
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${application.id}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ outcome: 'already_priority' });

    await app.close();
  });

  it('409s with not_waitlisted for an application not currently in the waitlisted state', async () => {
    const memberId = await seedMember();
    await grantSkipCredit(memberId);
    const application = await seedApplication(memberId, 'submitted');
    const app = buildTestApp('submitted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${application.id}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ outcome: 'not_waitlisted' });

    await app.close();
  });

  it('402s with insufficient_credits when the member has no waitlist_skip balance', async () => {
    const memberId = await seedMember();
    const application = await seedApplication(memberId, 'waitlisted', 'standard');
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${application.id}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(402);
    expect(response.body).toEqual({ outcome: 'insufficient_credits' });

    await app.close();
  });

  it('400s for a malformed applicationId (not a uuid)', async () => {
    const memberId = await seedMember();
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post('/applications/not-a-uuid/waitlist-skip')
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(400);

    await app.close();
  });

  it('400s for a malformed idempotencyKey (not a uuid)', async () => {
    const memberId = await seedMember();
    const application = await seedApplication(memberId, 'waitlisted', 'standard');
    const app = buildTestApp('waitlisted');
    await app.ready();

    const response = await request(app.server)
      .post(`/applications/${application.id}/waitlist-skip`)
      .set(MEMBER_HEADER, memberId)
      .send({ idempotencyKey: 'not-a-uuid' });

    expect(response.status).toBe(400);

    await app.close();
  });
});
