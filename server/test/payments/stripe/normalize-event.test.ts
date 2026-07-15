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

  describe('checkout.session.completed — ADR-0011 §3b linkage_event', () => {
    it('a session with both customer and client_reference_id normalizes to a linkage_event carrying both', () => {
      const result = normalizeStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { customer: 'cus_123', client_reference_id: 'member-abc' } },
      });

      expect(result).toEqual({
        kind: 'linkage_event',
        event: { customer: 'cus_123', clientReferenceId: 'member-abc' },
      });
    });

    it("a session missing client_reference_id still normalizes to a linkage_event — null propagates, unattributable is the consumer's call, not the normalizer's", () => {
      const result = normalizeStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { customer: 'cus_123', client_reference_id: null } },
      });

      expect(result).toEqual({
        kind: 'linkage_event',
        event: { customer: 'cus_123', clientReferenceId: null },
      });
    });

    it('a session missing customer still normalizes to a linkage_event — null propagates', () => {
      const result = normalizeStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { customer: null, client_reference_id: 'member-abc' } },
      });

      expect(result).toEqual({
        kind: 'linkage_event',
        event: { customer: null, clientReferenceId: 'member-abc' },
      });
    });
  });

  describe('customer.subscription.updated — previous_attributes diffing', () => {
    it('a changed cancel_at_period_end normalizes to a single-fact autorenew_set envelope, willRenew inverse of the current flag', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: { cancel_at_period_end: false, items: { data: [{ price: { id: 'price_x' } }] } },
          previous_attributes: { cancel_at_period_end: true },
        },
      });

      expect(result).toEqual({
        kind: 'context_event',
        events: [{ type: 'autorenew_set', willRenew: true }],
      });
    });

    it('a changed items normalizes to a single-fact plan_changed envelope with the new price id as productId', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_yearly' } }] },
          },
          previous_attributes: { items: { data: [{ price: { id: 'price_monthly' } }] } },
        },
      });

      expect(result).toEqual({
        kind: 'context_event',
        events: [{ type: 'plan_changed', productId: 'price_yearly' }],
      });
    });

    it('a changed items with no resolvable current price id is reported unsupported, not a corrupted plan_changed', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: { cancel_at_period_end: false, items: { data: [] } },
          previous_attributes: { items: { data: [{ price: { id: 'price_monthly' } }] } },
        },
      });

      expect(result).toEqual({
        kind: 'unsupported',
        stripeEventType: 'customer.subscription.updated',
      });
    });

    it('neither cancel_at_period_end nor items changed (e.g. a metadata-only update) is reported unsupported', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: { cancel_at_period_end: false, items: { data: [{ price: { id: 'price_x' } }] } },
          previous_attributes: {},
        },
      });

      expect(result).toEqual({
        kind: 'unsupported',
        stripeEventType: 'customer.subscription.updated',
      });
    });

    it('ADR-0009 §3g: when both cancel_at_period_end and items changed in the same event, both facts are emitted in one envelope — plan_changed first, then autorenew_set, neither dropped', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_yearly' } }] },
          },
          previous_attributes: {
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
        },
      });

      expect(result).toEqual({
        kind: 'context_event',
        events: [
          { type: 'plan_changed', productId: 'price_yearly' },
          { type: 'autorenew_set', willRenew: true },
        ],
      });
    });

    it('ADR-0009 §3g: an unresolvable items diff does not discard a genuine sibling autorenew_set fact in the same envelope', () => {
      const result = normalizeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: { cancel_at_period_end: false, items: { data: [] } },
          previous_attributes: {
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_monthly' } }] },
          },
        },
      });

      expect(result).toEqual({
        kind: 'context_event',
        events: [{ type: 'autorenew_set', willRenew: true }],
      });
    });
  });
});
