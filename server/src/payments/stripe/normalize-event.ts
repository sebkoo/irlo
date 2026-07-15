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
 *   unsupported — see its own case below), checkout.session.completed
 *   (member↔customer linkage — ADR-0011 §3b; a `linkage_event`, not a
 *   subscription-state event, so it carries no `SubscriptionEvent`. A null
 *   `customer`/`client_reference_id` still normalizes here — classifying
 *   that as `unattributable` is the linkage consumer's job, not this pure
 *   mapping's).
 * - Deferred to a follow-up triplet, needs payload branching this switch
 *   doesn't yet do: charge.dispute.closed (only a `status: 'lost'` dispute
 *   is refund-equivalent — a 'won' dispute isn't a subscription event at
 *   all).
 * - Everything else genuinely falls to `'unsupported'`.
 *
 * `context_event`'s `events` is an ordered, non-empty list rather than a
 * single fact (ADR-0009 §3g): a single `customer.subscription.updated` can
 * change both `items` and `cancel_at_period_end` at once, and both facts
 * must reach the executor — dropping the second silently regressed the
 * voluntary-cancel path (§3g's own "the gap"). The executor
 * (`consumeContextEvent`) folds every fact of one envelope in a single
 * transaction under one inbox row, preserving I4's "one Stripe event = one
 * atomic unit" rather than splitting into per-fact inbox rows.
 */
export type NormalizedStripeEvent =
  | { kind: 'subscription_event'; event: SubscriptionEvent }
  | { kind: 'context_event'; events: readonly [ContextEvent, ...ContextEvent[]] }
  | { kind: 'purchase_event'; event: PurchaseEvent }
  | { kind: 'linkage_event'; event: LinkageEvent }
  | { kind: 'unsupported'; stripeEventType: string };

/**
 * ADR-0011 §3b: the session's server-set evidence, echoed back under
 * Stripe's signature — `customer` and `client_reference_id` were both set
 * by *our* server at checkout-session creation (§3b's legitimacy chain), so
 * this is the linkage backstop's raw material, not yet validated. Either
 * field can be null (a session our checkout endpoint didn't create, or one
 * created before this field was set) — the linkage consumer, not this pure
 * mapping, classifies a null as `unattributable`.
 */
export interface LinkageEvent {
  customer: string | null;
  clientReferenceId: string | null;
}

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
 * `Stripe.Checkout.Session.customer` is typed for the (expandable) REST
 * response, so it's a `string | Customer | DeletedCustomer | null` even
 * though webhook payloads never carry an expanded object. Narrows to just
 * the id, honestly handling the object shape rather than asserting it away.
 */
function rawCustomerId(customer: Stripe.Checkout.Session['customer']): string | null {
  if (customer === null) return null;
  /* c8 ignore next -- unreachable via a real webhook delivery: Stripe's
   * expand param has no webhook counterpart, so `customer` is always the
   * bare id string here, never the Customer/DeletedCustomer object arms
   * this type only carries because it's shared with the REST response. */
  return typeof customer === 'string' ? customer : customer.id;
}

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
      type: 'checkout.session.completed';
      data: { object: Pick<Stripe.Checkout.Session, 'customer' | 'client_reference_id'> };
    }
  | {
      type: Exclude<
        Stripe.Event['type'],
        | 'invoice.payment_failed'
        | 'customer.subscription.deleted'
        | 'charge.refunded'
        | 'invoice.paid'
        | 'customer.subscription.updated'
        | 'checkout.session.completed'
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
      const facts: ContextEvent[] = [];

      // items checked first — an ordering, not a precedence: both facts
      // below are collected into one envelope (ADR-0009 §3g), so this only
      // fixes their order in the resulting list, not which one "wins".
      if (previous?.items !== undefined) {
        const productId = event.data.object.items.data[0]?.price.id;

        // Defensive, not expected in practice: Stripe wouldn't fire an
        // items-changed diff against an item-less subscription. Skipping
        // just this fact (not the whole event) is the honest outcome —
        // fabricating a plan_changed with no resolvable productId would be
        // wrong, but so would discarding a genuine sibling autorenew_set
        // fact in the same envelope over an unrelated field's malformed
        // diff (§3g).
        if (productId !== undefined) {
          facts.push({ type: 'plan_changed', productId });
        }
      }

      if (previous?.cancel_at_period_end !== undefined) {
        facts.push({
          type: 'autorenew_set',
          willRenew: !event.data.object.cancel_at_period_end,
        });
      }

      // Empty means either no field we map changed (e.g. metadata-only),
      // or the only field(s) that did change produced no resolvable fact —
      // §3g's own caveat: never emit an empty-list envelope.
      if (facts.length === 0) {
        return { kind: 'unsupported', stripeEventType: event.type };
      }

      return {
        kind: 'context_event',
        events: facts as [ContextEvent, ...ContextEvent[]],
      };
    }

    case 'checkout.session.completed':
      return {
        kind: 'linkage_event',
        event: {
          // Webhooks never expand relations (Stripe's expand param has no
          // webhook counterpart), so `customer` is always the bare id
          // string in a real payload — the object/DeletedCustomer arms
          // only exist because Stripe.Checkout.Session's type is shared
          // with the (expandable) REST response.
          customer: rawCustomerId(event.data.object.customer),
          clientReferenceId: event.data.object.client_reference_id,
        },
      };

    default:
      return { kind: 'unsupported', stripeEventType: event.type };
  }
}
