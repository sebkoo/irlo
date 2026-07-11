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

  describe('invoice.paid — billing_reason branching', () => {
    it('subscription_create with a zero-total invoice normalizes to purchased(offerPresent: true) — a trial', () => {
      const result = normalizeStripeEvent({
        type: 'invoice.paid',
        data: { object: { billing_reason: 'subscription_create', total: 0 } },
      });

      expect(result).toEqual({
        kind: 'purchase_event',
        event: { type: 'purchased', offerPresent: true },
      });
    });

    it('subscription_create with a nonzero-total invoice normalizes to purchased(offerPresent: false) — no trial', () => {
      const result = normalizeStripeEvent({
        type: 'invoice.paid',
        data: { object: { billing_reason: 'subscription_create', total: 999 } },
      });

      expect(result).toEqual({
        kind: 'purchase_event',
        event: { type: 'purchased', offerPresent: false },
      });
    });

    it('subscription_cycle normalizes to renewed', () => {
      const result = normalizeStripeEvent({
        type: 'invoice.paid',
        data: { object: { billing_reason: 'subscription_cycle', total: 999 } },
      });

      expect(result).toEqual({
        kind: 'subscription_event',
        event: { type: 'renewed' },
      });
    });

    it('a billing_reason outside subscription_create/subscription_cycle is reported unsupported', () => {
      const result = normalizeStripeEvent({
        type: 'invoice.paid',
        data: { object: { billing_reason: 'subscription_update', total: 0 } },
      });

      expect(result).toEqual({
        kind: 'unsupported',
        stripeEventType: 'invoice.paid',
      });
    });
  });
});
