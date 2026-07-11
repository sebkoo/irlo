import type Stripe from 'stripe';

import type { SubscriptionEvent } from '../../domain/subscription-transition.js';

/**
 * ADR-0009 §3b's Stripe event-mapping table, the Stripe-rail counterpart to
 * Apple's Server Notifications V2 mapping. Pure: takes a verified Stripe
 * event, returns the provider-agnostic normalized event the reducer
 * (`server/src/domain/subscription-transition.ts`) understands — no I/O, no
 * idempotency (that's the executor's job, same split as the reducer itself).
 *
 * Only `event.type` is read here, not the full Stripe.Event payload, so the
 * parameter is narrowed to that — real fixtures don't need to be fully
 * populated to exercise this function.
 */
export type NormalizedStripeEvent =
  | { kind: 'subscription_event'; event: SubscriptionEvent }
  | { kind: 'unsupported'; stripeEventType: string };

/**
 * Stripe has no native grace period (unlike Apple's GRACE_PERIOD subtype):
 * ADR-0009 §3b defines a policy grace window instead, aligned to Stripe's
 * Smart Retries schedule. Fixed true for now — every Stripe payment failure
 * offers grace; revisit if a future product tier needs to withhold it.
 */
const STRIPE_GRACE_POLICY = true;

export function normalizeStripeEvent(event: Pick<Stripe.Event, 'type'>): NormalizedStripeEvent {
  switch (event.type) {
    case 'invoice.payment_failed':
      return {
        kind: 'subscription_event',
        event: { type: 'renewal_failed', graceOffered: STRIPE_GRACE_POLICY },
      };

    case 'customer.subscription.deleted':
      // Stripe only fires this once retries (if any) are exhausted or the
      // period ends after cancel_at_period_end — either way, by the time
      // this event arrives there's nothing left to retry. transition()'s
      // own guards (willRenew for active, retriesExhausted for
      // billing_retry) decide whether this is reachable from the current
      // state; this normalizer doesn't need to distinguish the two paths.
      return {
        kind: 'subscription_event',
        event: { type: 'period_expired', retriesExhausted: true },
      };

    case 'charge.refunded':
      return { kind: 'subscription_event', event: { type: 'refunded' } };

    default:
      return { kind: 'unsupported', stripeEventType: event.type };
  }
}
