import type Stripe from 'stripe';

export type ExtractProductIdResult = { ok: true; productId: string } | { ok: false };

/**
 * Only the fields this function actually reads from an Invoice's first line
 * item's pricing — not the full `Stripe.InvoiceLineItem` type, which this
 * SDK version nests price info under `pricing.price_details.price` (having
 * replaced the older flat `line.price` field this codebase never depended
 * on). Same "Pick only what's read" pattern as `extract-subscription-id.ts`.
 */
export interface MinimalInvoiceLines {
  lines: {
    data: {
      pricing: {
        price_details?: { price: string | Pick<Stripe.Price, 'id'> };
      } | null;
    }[];
  };
}

/**
 * Resolves the price id a first-ever purchase should record as
 * `productId` (`consumePurchaseEvent`'s required field for the
 * generation-spawning path — an existing generation instead inherits its
 * own row's `productId` on renewal, never re-derived from the invoice).
 * Reads only the invoice's first line item, mirroring
 * `normalize-event.ts`'s `customer.subscription.updated` items-diffing
 * convention (`items.data[0]`) for the same reason: a subscription's
 * generation-defining product is its first/only priced line.
 *
 * Never throws — same discriminated-result convention as
 * `extractSubscriptionIdFromInvoice`: an invoice with no resolvable price
 * on its first line is an expected, routine "can't determine yet" outcome
 * for this pure function, never an exceptional one. In practice a
 * `subscription_create` invoice (the only `billing_reason` that reaches
 * this function's caller) always carries a priced line by Stripe's own
 * object model — reaching `{ ok: false }` there would be a real
 * data-integrity fault, not a legitimate non-subscription-invoice case
 * the way `extractSubscriptionIdFromInvoice`'s `ok: false` routinely is.
 */
export function extractProductIdFromInvoice(invoice: MinimalInvoiceLines): ExtractProductIdResult {
  const priceRef = invoice.lines.data[0]?.pricing?.price_details?.price;

  if (priceRef === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    productId: typeof priceRef === 'string' ? priceRef : priceRef.id,
  };
}
