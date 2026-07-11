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
 *
 * §3b coverage — every Stripe row's disposition, so the mapping stays
 * auditable (an unmapped row silently falling into `'unsupported'` is
 * indistinguishable from a genuinely out-of-scope event otherwise):
 * - Mapped here: invoice.payment_failed, customer.subscription.deleted,
 *   charge.refunded (see the three cases below).
 * - Deferred to a follow-up triplet, each needs payload branching this
 *   type-only switch can't do: invoice.paid (billing_reason distinguishes
 *   'purchased', routed to applyPurchase, from 'renewed', routed to
 *   applyEvent); customer.subscription.updated (previous_attributes
 *   diffing distinguishes autorenew_set from plan_changed);
 *   charge.dispute.closed (only a `status: 'lost'` dispute is refund-
 *   equivalent — a 'won' dispute isn't a subscription event at all).
 * - Not a subscription-state event, so intentionally never mapped here:
 *   checkout.session.completed (member↔customer linkage — the executor's
 *   job, not the reducer's).
 * - Everything else genuinely falls to `'unsupported'`.
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
      // ADR-0009 §3b qualifies this "(subscription invoice charge)":
      // correct today because the Stripe rail only sells the irlo.plus
      // subscription (ADR-0004) — every Stripe charge is a subscription
      // invoice charge. Revisit if a future non-subscription Stripe
      // product (a one-time charge) is added; this would need to branch
      // on whether the refunded charge is actually invoice-linked.
      return { kind: 'subscription_event', event: { type: 'refunded' } };

    default:
      return { kind: 'unsupported', stripeEventType: event.type };
  }
}
