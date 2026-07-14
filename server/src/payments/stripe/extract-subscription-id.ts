import type Stripe from 'stripe';

export type ExtractSubscriptionIdResult =
  { ok: true; providerSubscriptionId: string } | { ok: false };

/**
 * Only the fields this function actually reads from an Invoice's parent
 * linkage — not the full `Stripe.Invoice['parent']` type, which requires
 * `quote_details`/`type` and a fully-populated `Subscription` object
 * neither this function nor its test fixtures need (same "Pick only what's
 * read" pattern as `normalize-event.ts`'s `MinimalSubscriptionDiff`).
 */
export interface MinimalInvoiceParent {
  parent: {
    subscription_details: {
      subscription: string | Pick<Stripe.Subscription, 'id'>;
    } | null;
  } | null;
}

/**
 * Resolves the provider subscription id from a Stripe Invoice's parent
 * linkage (`invoice.parent.subscription_details.subscription`) — the
 * nested shape Stripe's API moved to, replacing an older flat
 * `invoice.subscription` field this codebase never depended on. Handles
 * both the common webhook case (a bare id string) and an expanded
 * Subscription object, without assuming which one arrives.
 *
 * Never throws: an invoice with no subscription linkage (a non-subscription
 * invoice, or one whose parent type isn't `subscription_details` at all) is
 * an expected, routine outcome for any invoice this rail shouldn't have
 * dispatched a subscription-economic event for in the first place — not an
 * exceptional condition. Same discriminated-result convention as
 * `verifyStripeWebhookEvent`/`normalizeStripeEvent`.
 */
export function extractSubscriptionIdFromInvoice(
  invoice: MinimalInvoiceParent,
): ExtractSubscriptionIdResult {
  // Only `parent` and `subscription_details` are nullable per Stripe's own
  // type (`SubscriptionDetails.subscription` is `string | Subscription`,
  // never null) — optional chaining collapses either nullable hop to
  // `undefined`, which is the only "missing" value this ever sees.
  const subscription = invoice.parent?.subscription_details?.subscription;

  if (subscription === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    providerSubscriptionId: typeof subscription === 'string' ? subscription : subscription.id,
  };
}
