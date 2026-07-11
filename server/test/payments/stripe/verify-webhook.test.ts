import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { verifyStripeWebhookEvent } from '../../../src/payments/stripe/verify-webhook.js';

const SECRET = 'whsec_test_fixture_secret';

function fixturePayload(type: string): string {
  return JSON.stringify({
    id: 'evt_test_fixture',
    object: 'event',
    api_version: '2025-01-01',
    created: 1700000000,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: { id: 'obj_test_fixture' } },
  });
}

describe('verifyStripeWebhookEvent (ADR-0009 I12 — verify-then-queue)', () => {
  it('a correctly signed payload verifies and returns the parsed event', () => {
    const payload = fixturePayload('invoice.paid');
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

    const result = verifyStripeWebhookEvent(payload, signature, SECRET);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe('invoice.paid');
      expect(result.event.id).toBe('evt_test_fixture');
    }
  });

  it('a signature generated with the wrong secret fails verification', () => {
    const payload = fixturePayload('invoice.paid');
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_test_wrong_secret',
    });

    const result = verifyStripeWebhookEvent(payload, signature, SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('signature_verification_failed');
    }
  });

  it('a payload tampered with after signing fails verification', () => {
    const originalPayload = fixturePayload('invoice.paid');
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: originalPayload,
      secret: SECRET,
    });
    const tamperedPayload = fixturePayload('customer.subscription.deleted');

    const result = verifyStripeWebhookEvent(tamperedPayload, signature, SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('signature_verification_failed');
    }
  });

  it('a malformed signature header fails verification, not a thrown exception', () => {
    const payload = fixturePayload('invoice.paid');

    const result = verifyStripeWebhookEvent(payload, 'not-a-real-signature-header', SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('signature_verification_failed');
      expect(typeof result.error.message).toBe('string');
    }
  });
});
