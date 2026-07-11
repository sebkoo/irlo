import Stripe from 'stripe';

export interface WebhookVerificationError {
  code: 'signature_verification_failed';
  message: string;
}

export type VerifyWebhookResult =
  { ok: true; event: Stripe.Event } | { ok: false; error: WebhookVerificationError };

/**
 * ADR-0009 I12 — no effect from an unverified event: signature verification
 * precedes normalization (verify-then-queue). A pure wrapper around Stripe's
 * own HMAC verification (`Stripe.webhooks.constructEvent`, a static method —
 * no API key or live client instance needed, since verification is local
 * crypto against the endpoint's signing secret, not an API call).
 *
 * Never throws: an invalid signature is an expected, routine occurrence for
 * a public webhook endpoint (replay probes, a rotated-but-not-yet-redeployed
 * secret, a malformed request), not an exceptional condition — same
 * discriminated-result convention as every other function in this domain
 * (transition, applyEvent, applyPurchase, normalizeStripeEvent).
 */
export function verifyStripeWebhookEvent(
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
): VerifyWebhookResult {
  try {
    const event = Stripe.webhooks.constructEvent(payload, signatureHeader, secret);
    return { ok: true, event };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'signature_verification_failed',
        /* c8 ignore next -- Stripe's SDK (constructEvent) always throws an
         * Error subclass (StripeSignatureVerificationError); the fallback
         * guards against a non-Error throw this well-behaved library never
         * actually produces. */
        message: error instanceof Error ? error.message : 'unknown webhook verification error',
      },
    };
  }
}
