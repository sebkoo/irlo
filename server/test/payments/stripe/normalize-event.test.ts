import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../../src/payments/stripe/normalize-event.js';

describe('normalizeStripeEvent (ADR-0009 §3b — Stripe event-mapping table)', () => {
  it('invoice.payment_failed normalizes to renewal_failed with the policy grace window', () => {
    const result = normalizeStripeEvent({ type: 'invoice.payment_failed' });

    expect(result).toEqual({
      kind: 'subscription_event',
      event: { type: 'renewal_failed', graceOffered: true },
    });
  });

  it('customer.subscription.deleted normalizes to period_expired with retries exhausted', () => {
    const result = normalizeStripeEvent({ type: 'customer.subscription.deleted' });

    expect(result).toEqual({
      kind: 'subscription_event',
      event: { type: 'period_expired', retriesExhausted: true },
    });
  });

  it('charge.refunded normalizes to refunded', () => {
    const result = normalizeStripeEvent({ type: 'charge.refunded' });

    expect(result).toEqual({
      kind: 'subscription_event',
      event: { type: 'refunded' },
    });
  });

  it('an event type outside this mapping is reported unsupported, not silently dropped', () => {
    const result = normalizeStripeEvent({ type: 'customer.subscription.paused' });

    expect(result).toEqual({
      kind: 'unsupported',
      stripeEventType: 'customer.subscription.paused',
    });
  });
});
