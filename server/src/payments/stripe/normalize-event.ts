import type Stripe from 'stripe';

import type {
  ContextEvent,
  PurchaseEvent,
  SubscriptionEvent,
} from '../../domain/subscription-transition.js';

/**
 * ADR-0009 §3b's Stripe event-mapping table, the Stripe-rail counterpart to
 * Apple's Server Notifications V2 mapping. Pure: takes a verified Stripe
 * event, returns the provider-agnostic normalized event the reducer
 * (`server/src/domain/subscription-transition.ts`) understands — no I/O, no
 * idempotency (that's the executor's job, same split as the reducer itself).
 *
 * Each case reads only the fields it needs from the real Stripe types
 * (`Pick<Stripe.Invoice, ...>`, etc.), not the full `Stripe.Event` payload —
 * real fixtures don't need to be fully populated to exercise this function,
 * while tsc still catches a field rename in the SDK.
 *
 * §3b coverage — every Stripe row's disposition, so the mapping stays
 * auditable (an unmapped row silently falling into `'unsupported'` is
 * indistinguishable from a genuinely out-of-scope event otherwise):
 * - Mapped here: invoice.payment_failed, customer.subscription.deleted,
 *   charge.refunded, invoice.paid (billing_reason branches 'purchased' vs
 *   'renewed' vs unsupported), customer.subscription.updated
 *   (previous_attributes diffing branches autorenew_set vs plan_changed vs
 *   unsupported — see its own case below).
 * - Deferred to a follow-up triplet, needs payload branching this switch
 *   doesn't yet do: charge.dispute.closed (only a `status: 'lost'` dispute
 *   is refund-equivalent — a 'won' dispute isn't a subscription event at
 *   all).
 * - Not a subscription-state event, so intentionally never mapped here:
 *   checkout.session.completed (member↔customer linkage — the executor's
 *   job, not the reducer's).
 * - Everything else genuinely falls to `'unsupported'`.
 */
export type NormalizedStripeEvent =
  | { kind: 'subscription_event'; event: SubscriptionEvent }
  | { kind: 'context_event'; event: ContextEvent }
  | { kind: 'purchase_event'; event: PurchaseEvent }
  | { kind: 'unsupported'; stripeEventType: string };

/**
 * Only the field this normalizer actually reads from a subscription item —
 * its price id, for plan_changed's productId — not the full
 * `Stripe.SubscriptionItem`/`Stripe.ApiList` shape.
 */
interface MinimalSubscriptionItems {
  data: { price: Pick<Stripe.Price, 'id'> }[];
}

type MinimalSubscriptionDiff = Pick<Stripe.Subscription, 'cancel_at_period_end'> & {
  items: MinimalSubscriptionItems;
};

/**
 * Each handled Stripe event type paired with only the payload fields its
 * case actually reads — not `Stripe.Event` itself, which would force every
 * test fixture (including the type-only cases above) to populate the SDK's
 * full required-field set. The catch-all arm still types `type` as every
 * *other* real Stripe event-type literal (via `Exclude`), so a typo in a
 * case label would be a compile error, not a silent no-op.
 */
type StripeNormalizerInput =
  | { type: 'invoice.payment_failed' }
  | { type: 'customer.subscription.deleted' }
  | { type: 'charge.refunded' }
  | { type: 'invoice.paid'; data: { object: Pick<Stripe.Invoice, 'billing_reason' | 'total'> } }
  | {
      type: 'customer.subscription.updated';
      data: {
        object: MinimalSubscriptionDiff;
        previous_attributes?: Partial<MinimalSubscriptionDiff>;
      };
    }
  | {
      type: Exclude<
        Stripe.Event['type'],
        | 'invoice.payment_failed'
        | 'customer.subscription.deleted'
        | 'charge.refunded'
        | 'invoice.paid'
        | 'customer.subscription.updated'
      >;
    };

/**
 * Stripe has no native grace period (unlike Apple's GRACE_PERIOD subtype):
 * ADR-0009 §3b defines a policy grace window instead, aligned to Stripe's
 * Smart Retries schedule. Fixed true for now — every Stripe payment failure
 * offers grace; revisit if a future product tier needs to withhold it.
 */
const STRIPE_GRACE_POLICY = true;

export function normalizeStripeEvent(event: StripeNormalizerInput): NormalizedStripeEvent {
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

    case 'invoice.paid': {
      const { billing_reason, total } = event.data.object;

      if (billing_reason === 'subscription_create') {
        // No direct 'is this a trial' field on the Invoice itself — total
        // === 0 is Stripe's own signal that nothing was actually charged
        // (a trial-start invoice), a heuristic rather than an explicit
        // flag. Revisit if a future $0 non-trial promo makes this
        // ambiguous.
        return {
          kind: 'purchase_event',
          event: { type: 'purchased', offerPresent: total === 0 },
        };
      }

      if (billing_reason === 'subscription_cycle') {
        return { kind: 'subscription_event', event: { type: 'renewed' } };
      }

      // Other billing_reason values (subscription_update,
      // subscription_threshold, manual, ...) aren't in ADR-0009 §3b's
      // table — genuinely unsupported for now, not silently mis-mapped.
      return { kind: 'unsupported', stripeEventType: event.type };
    }

    case 'customer.subscription.updated': {
      const previous = event.data.previous_attributes;

      // items checked first: if a single update touched both fields (rare
      // — most dashboard/API actions send one focused change), plan_changed
      // wins. Not an ADR-0009 rule, a named precedence for an edge the ADR
      // doesn't address; locked by its own test. Revisit if this proves
      // wrong in practice (e.g. an autorenew_set signal getting dropped
      // during a combined update turns out to matter).
      if (previous?.items !== undefined) {
        const productId = event.data.object.items.data[0]?.price.id;

        // Defensive, not expected in practice: Stripe wouldn't fire an
        // items-changed diff against an item-less subscription. Reporting
        // unsupported (not a plan_changed with a fabricated productId) is
        // the honest outcome when there's nothing to resolve it to.
        if (productId === undefined) {
          return { kind: 'unsupported', stripeEventType: event.type };
        }

        return { kind: 'context_event', event: { type: 'plan_changed', productId } };
      }

      if (previous?.cancel_at_period_end !== undefined) {
        return {
          kind: 'context_event',
          event: {
            type: 'autorenew_set',
            willRenew: !event.data.object.cancel_at_period_end,
          },
        };
      }

      // Some other field changed (e.g. metadata) — not one §3b maps.
      return { kind: 'unsupported', stripeEventType: event.type };
    }

    default:
      return { kind: 'unsupported', stripeEventType: event.type };
  }
}
