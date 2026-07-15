import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createMembersRepository } from '../../src/db/repositories/members.js';
import { createRailIdentitiesRepository } from '../../src/db/repositories/rail-identities.js';
import { createSubscriptionsRepository } from '../../src/db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents, subscriptions } from '../../src/db/schema/index.js';
import { MemoryLogStream } from '../support/memory-log-stream.js';
import { startTestDb, stopTestDb, type TestDb } from '../support/testcontainers-postgres.js';

const WEBHOOK_SECRET = 'whsec_test_route_fixture_secret';

let testDb: TestDb;
let memberId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  memberId = (await createMembersRepository(testDb.db).create()).id;
}, 120_000);

afterAll(async () => {
  await stopTestDb(testDb);
});

function buildTestApp(loggerStream: MemoryLogStream) {
  return buildApp({
    loggerStream,
    db: testDb.db,
    config: {
      NODE_ENV: 'test',
      PORT: 3000,
      LOG_LEVEL: 'debug',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
  });
}

/**
 * Sends the exact given bytes as the request body — never JSON-reserialized
 * by supertest. Must pass the raw string, not `Buffer.from(payload)`:
 * superagent's `.send()` special-cases a Buffer argument by JSON-encoding
 * the Buffer object itself (`{"type":"Buffer","data":[...]}`) whenever
 * Content-Type is `application/json`, which corrupts the payload before it
 * ever reaches signature verification.
 */
function postSignedWebhook(
  app: ReturnType<typeof buildTestApp>,
  payload: string,
  signature: string,
) {
  return request(app.server)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);
}

function signedFixture(eventObject: Record<string, unknown>) {
  const payload = JSON.stringify(eventObject);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature };
}

function baseEvent(overrides: { id: string; type: string; created: number; data: unknown }) {
  return {
    object: 'event',
    api_version: '2025-01-01',
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    ...overrides,
  };
}

async function seedGeneration(
  providerSubscriptionId: string,
  overrides: Partial<
    Parameters<ReturnType<typeof createSubscriptionsRepository>['createGeneration']>[0]
  > = {},
) {
  return createSubscriptionsRepository(testDb.db).createGeneration({
    memberId,
    provider: 'stripe',
    providerSubscriptionId,
    generation: 1,
    state: 'active',
    productId: 'price_monthly',
    willRenew: true,
    currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
    highWater: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

describe('POST /webhooks/stripe (ADR-0009 §3h — full route: verify, normalize, dispatch, HTTP mapping)', () => {
  it('a valid customer.subscription.updated (autorenew_set) is applied by the real consumer, 2xx, one inbox row', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_770_000_000,
        data: {
          object: {
            id: providerSubscriptionId,
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
          previous_attributes: { cancel_at_period_end: false },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.willRenew).toBe(false);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);

    await app.close();
  });

  it('a valid invoice.paid (subscription_cycle, renewed) is applied by the real consumer — state, period, and ledger all change', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId, {
      currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
    });
    const eventId = `evt_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;
    const newPeriodEnd = 1_769_904_000; // 2026-02-01T00:00:00Z
    const newPeriodStart = 1_767_225_600; // 2026-01-01T00:00:00Z

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_770_000_000,
        data: {
          object: {
            id: invoiceId,
            billing_reason: 'subscription_cycle',
            total: 999,
            period_end: newPeriodEnd,
            period_start: newPeriodStart,
            parent: { subscription_details: { subscription: providerSubscriptionId } },
          },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'applied' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.currentPeriodEnd).toEqual(new Date(newPeriodEnd * 1000));

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('grant');

    await app.close();
  });

  it('invoice.paid (subscription_cycle) with no resolvable subscription linkage — 500, alerted, nothing written', async () => {
    const eventId = `evt_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_770_000_000,
        data: {
          object: {
            id: invoiceId,
            billing_reason: 'subscription_cycle',
            total: 999,
            period_end: 1_769_904_000,
            period_start: 1_767_225_600,
            parent: null,
          },
        },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'routing_key_unresolved' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('invoice.payment_failed (renewal_failed) has no consumer yet — 500, alerted, nothing written', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.payment_failed',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'not_yet_implemented' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('charge.refunded has no subscription-id extraction yet (technical limitation) — 500, alerted, nothing written', async () => {
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'charge.refunded',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'refund_routing_not_implemented' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('purchase_event (new subscription) for a customer with no linked member is unlinked_customer — 500, alerted, nothing written (ADR-0009 §3h case (c), ADR-0011 §3d/§3f)', async () => {
    // ADR-0011 §3g item 1: this is the stub-branch fixture test mutated
    // into the unlinked_customer test — same assertion shape (5xx +
    // alert + zero rows), new meaning (no link found for this customer,
    // not "not implemented"). A fresh customer id with no rail_identities
    // row is the routine 5xx-until-linked case §3d designs for, not an
    // error condition.
    const eventId = `evt_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_700_000_000,
        data: { object: { billing_reason: 'subscription_create', total: 0, customer: customerId } },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'unlinked_customer' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('purchase_event (new subscription) with a null customer is unlinked_customer — no lookup attempted, same 5xx shape', async () => {
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_700_000_000,
        data: { object: { billing_reason: 'subscription_create', total: 0, customer: null } },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'unlinked_customer' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('purchase_event (new subscription) for a LINKED customer creates a generation — 200, ledger grant, inbox applied (ADR-0011 §3g item 2, golden path)', async () => {
    const eventId = `evt_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const periodStart = 1_767_225_600; // 2026-01-01T00:00:00Z
    const periodEnd = 1_769_904_000; // 2026-02-01T00:00:00Z

    await createRailIdentitiesRepository(testDb.db).createLink({
      memberId,
      provider: 'stripe',
      externalId: customerId,
      linkedVia: 'checkout_session',
    });

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_700_000_000,
        data: {
          object: {
            id: invoiceId,
            billing_reason: 'subscription_create',
            total: 999,
            customer: customerId,
            period_start: periodStart,
            period_end: periodEnd,
            parent: { subscription_details: { subscription: providerSubscriptionId } },
            lines: { data: [{ pricing: { price_details: { price: 'price_monthly' } } }] },
          },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'generation_created' });

    const [row] = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(row?.memberId).toBe(memberId);
    expect(row?.state).toBe('active');
    expect(row?.productId).toBe('price_monthly');
    expect(row?.currentPeriodEnd).toEqual(new Date(periodEnd * 1000));

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, `stripe:invoice:${invoiceId}`));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('grant');

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.disposition).toBe('applied');

    await app.close();
  });

  it('purchase_event (new subscription) for a LINKED customer with no resolvable subscription linkage — 500, alerted, nothing written', async () => {
    const eventId = `evt_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;

    await createRailIdentitiesRepository(testDb.db).createLink({
      memberId,
      provider: 'stripe',
      externalId: customerId,
      linkedVia: 'checkout_session',
    });

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'invoice.paid',
        created: 1_700_000_000,
        data: {
          object: {
            billing_reason: 'subscription_create',
            total: 999,
            customer: customerId,
            parent: null,
          },
        },
      }),
    );

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'routing_key_unresolved' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('the flagship out-of-order pair: an unlinked purchase 5xxes, checkout.session.completed links it, the SAME purchase envelope re-posted then succeeds (ADR-0011 §3g item 4 — the ADR-0011 centerpiece claim, executable)', async () => {
    const purchaseEventId = `evt_${randomUUID()}`;
    const linkageEventId = `evt_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const providerSubscriptionId = `sub_${randomUUID()}`;

    const purchaseFixture = signedFixture(
      baseEvent({
        id: purchaseEventId,
        type: 'invoice.paid',
        created: 1_700_000_000,
        data: {
          object: {
            id: invoiceId,
            billing_reason: 'subscription_create',
            total: 999,
            customer: customerId,
            period_start: 1_767_225_600,
            period_end: 1_769_904_000,
            parent: { subscription_details: { subscription: providerSubscriptionId } },
            lines: { data: [{ pricing: { price_details: { price: 'price_monthly' } } }] },
          },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    // 1. The purchase arrives first — no link exists yet. Stripe's own
    // retry schedule is what's supposed to resolve this (§3d), not a
    // parking mechanism.
    const firstAttempt = await postSignedWebhook(
      app,
      purchaseFixture.payload,
      purchaseFixture.signature,
    );
    expect(firstAttempt.status).toBe(500);
    expect(firstAttempt.body).toEqual({ error: 'unlinked_customer' });

    const generationRowsBeforeLink = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(generationRowsBeforeLink).toHaveLength(0);

    // 2. checkout.session.completed links the customer to the member —
    // the backstop path (ADR-0011 §3b).
    const linkageFixture = signedFixture(
      baseEvent({
        id: linkageEventId,
        type: 'checkout.session.completed',
        created: 1_700_000_100,
        data: { object: { customer: customerId, client_reference_id: memberId } },
      }),
    );
    const linkageResponse = await postSignedWebhook(
      app,
      linkageFixture.payload,
      linkageFixture.signature,
    );
    expect(linkageResponse.status).toBe(200);
    expect(linkageResponse.body).toEqual({ outcome: 'linked' });

    // 3. The SAME purchase envelope re-posted (Stripe redelivery
    // semantics on its own retry schedule) now resolves the member and
    // succeeds — the flagship claim: no parking, no replay machinery,
    // just the provider's own at-least-once retry landing after the
    // link exists.
    const redelivery = await postSignedWebhook(
      app,
      purchaseFixture.payload,
      purchaseFixture.signature,
    );
    expect(redelivery.status).toBe(200);
    expect(redelivery.body).toEqual({ outcome: 'generation_created' });

    const generationRowsAfterRetry = await testDb.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
    expect(generationRowsAfterRetry).toHaveLength(1);
    expect(generationRowsAfterRetry[0]?.memberId).toBe(memberId);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, purchaseEventId)));
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.disposition).toBe('applied');

    await app.close();
  });

  it('checkout.session.completed with a fresh customer creates a link — 200, linked, one inbox row (ADR-0011 §3b)', async () => {
    const eventId = `evt_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'checkout.session.completed',
        created: 1_700_000_000,
        data: { object: { customer: customerId, client_reference_id: memberId } },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'linked' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);

    await app.close();
  });

  it('checkout.session.completed conflicting with an existing different-member link — 2xx, alerted, no repoint, no inbox row (ADR-0011 L3)', async () => {
    const customerId = `cus_${randomUUID()}`;
    const firstEventId = `evt_${randomUUID()}`;
    const conflictEventId = `evt_${randomUUID()}`;
    const otherMemberId = (await createMembersRepository(testDb.db).create()).id;

    const loggerStream = new MemoryLogStream();
    const app = buildTestApp(loggerStream);
    await app.ready();

    const first = signedFixture(
      baseEvent({
        id: firstEventId,
        type: 'checkout.session.completed',
        created: 1_700_000_000,
        data: { object: { customer: customerId, client_reference_id: memberId } },
      }),
    );
    const firstResponse = await postSignedWebhook(app, first.payload, first.signature);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({ outcome: 'linked' });

    const conflicting = signedFixture(
      baseEvent({
        id: conflictEventId,
        type: 'checkout.session.completed',
        created: 1_700_000_001,
        data: { object: { customer: customerId, client_reference_id: otherMemberId } },
      }),
    );
    const conflictResponse = await postSignedWebhook(
      app,
      conflicting.payload,
      conflicting.signature,
    );

    expect(conflictResponse.status).toBe(200);
    expect(conflictResponse.body).toEqual({ outcome: 'conflict' });
    expect(loggerStream.parsedLines().some((line) => line['level'] === 50)).toBe(true);

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, conflictEventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('a bad signature is rejected with 400, before any DB write', async () => {
    const eventId = `evt_${randomUUID()}`;
    const payload = JSON.stringify(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );
    const wrongSignature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_wrong_secret',
    });

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, wrongSignature);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'signature_verification_failed' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('a request with no stripe-signature header is rejected with 400, before any DB write', async () => {
    const eventId = `evt_${randomUUID()}`;
    const payload = JSON.stringify(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await request(app.server)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'missing_signature' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(0);

    await app.close();
  });

  it('a JSON-reparsed body fails verification — proves the raw undecoded bytes are what gets checked', async () => {
    const eventId = `evt_${randomUUID()}`;
    const originalPayload = JSON.stringify(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: originalPayload,
      secret: WEBHOOK_SECRET,
    });
    // Same semantic content, different bytes (re-serialized with extra
    // whitespace) — a real risk if Fastify's default JSON body parser
    // (parse then re-stringify) were used instead of the raw-buffer parser.
    const reparsedPayload = JSON.stringify(JSON.parse(originalPayload), null, 2);
    expect(reparsedPayload).not.toBe(originalPayload);

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, reparsedPayload, signature);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'signature_verification_failed' });

    await app.close();
  });

  it('an unsupported Stripe event type is a recorded no-op, 2xx', async () => {
    const eventId = `evt_${randomUUID()}`;
    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.paused',
        created: 1_700_000_000,
        data: { object: {} },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'unsupported' });

    await app.close();
  });

  it('a redelivered event is a duplicate, 2xx, no second effect', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_770_000_000,
        data: {
          object: {
            id: providerSubscriptionId,
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
          previous_attributes: { cancel_at_period_end: false },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const first = await postSignedWebhook(app, payload, signature);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ outcome: 'applied' });

    const second = await postSignedWebhook(app, payload, signature);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ outcome: 'duplicate' });

    const inboxRows = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRows).toHaveLength(1);

    await app.close();
  });

  it('a context event for a never-seen subscription is a transient no_matching_generation, 5xx (Stripe should retry)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`; // never seeded
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_700_000_000,
        data: {
          object: {
            id: providerSubscriptionId,
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
          previous_attributes: { cancel_at_period_end: false },
        },
      }),
    );

    const app = buildTestApp(new MemoryLogStream());
    await app.ready();

    const response = await postSignedWebhook(app, payload, signature);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ outcome: 'no_matching_generation' });

    await app.close();
  });

  it('a genuine transient infra fault returns 5xx, and the identical redelivery succeeds once the fault clears', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    await seedGeneration(providerSubscriptionId);
    const eventId = `evt_${randomUUID()}`;

    const { payload, signature } = signedFixture(
      baseEvent({
        id: eventId,
        type: 'customer.subscription.updated',
        created: 1_770_000_000,
        data: {
          object: {
            id: providerSubscriptionId,
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
          previous_attributes: { cancel_at_period_end: false },
        },
      }),
    );

    // A separate, short-lived pool (never the shared testDb) so ending it
    // to simulate a connection fault can't break any other test in this
    // file.
    const flakyPool = new Pool({ connectionString: testDb.container.getConnectionUri() });
    const flakyDb = drizzle(flakyPool);
    const flakyApp = buildApp({
      loggerStream: new MemoryLogStream(),
      db: flakyDb,
      config: {
        NODE_ENV: 'test',
        PORT: 3000,
        LOG_LEVEL: 'debug',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      },
    });
    await flakyApp.ready();

    // Force every query on this pool to fail with a genuine connection
    // error — an infra fault, not a business-logic outcome — before the
    // request is sent.
    await flakyPool.end();

    const failedResponse = await postSignedWebhook(flakyApp, payload, signature);
    expect(failedResponse.status).toBe(500);

    await flakyApp.close();

    // No inbox row from the failed attempt — the transaction never committed.
    const inboxRowsAfterFailure = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRowsAfterFailure).toHaveLength(0);

    // The fault clears: a fresh pool, a fresh app, the identical redelivery.
    const recoveredApp = buildTestApp(new MemoryLogStream());
    await recoveredApp.ready();

    const retryResponse = await postSignedWebhook(recoveredApp, payload, signature);
    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body).toEqual({ outcome: 'applied' });

    const inboxRowsAfterRetry = await testDb.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.source, 'stripe'), eq(paymentEvents.eventId, eventId)));
    expect(inboxRowsAfterRetry).toHaveLength(1);

    await recoveredApp.close();
  });
});
