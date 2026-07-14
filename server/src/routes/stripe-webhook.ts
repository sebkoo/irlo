import type { FastifyInstance } from 'fastify';

import type { Db } from '../db/client.js';
import { consumeContextEvent } from '../payments/consume-context-event.js';
import type { ConsumeContextEventResult } from '../payments/consume-context-event.js';
import { consumeSubscriptionEconomicEvent } from '../payments/consume-subscription-economic-event.js';
import type { ConsumeSubscriptionEconomicEventResult } from '../payments/consume-subscription-economic-event.js';
import { extractSubscriptionIdFromInvoice } from '../payments/stripe/extract-subscription-id.js';
import { normalizeStripeEvent } from '../payments/stripe/normalize-event.js';
import { verifyStripeWebhookEvent } from '../payments/stripe/verify-webhook.js';

export interface RegisterStripeWebhookRouteOptions {
  webhookSecret: string;
}

/**
 * ADR-0009 §3h — Stripe webhook HTTP response mapping (this is the section
 * to cite for the disposition→status table below; §3e is dual-rail
 * reconciliation authority, unrelated to HTTP transport).
 *
 * Response codes, per §3h:
 * - 2xx: every outcome the transactional inbox (§3d) has recorded as
 *   handled — `applied`/`duplicate`/`superseded`/`no_op_terminal` — plus
 *   `unsupported` Stripe event types (genuinely out of catalog scope, not
 *   an error) and the not-yet-implemented dispatch branches below, which
 *   are alerted rather than retried since redelivery on Stripe's own
 *   timescale won't resolve them (see per-branch comments).
 * - 400: signature verification failure — not transient, redelivery won't
 *   help.
 * - 5xx: `no_matching_generation` (Stripe's delivery ordering isn't
 *   guaranteed — §3b — so redelivery genuinely may resolve this once the
 *   generation-creating event lands) and any uncaught infra-level error
 *   from a consumer function (a genuine DB/connection fault — Fastify's
 *   default error handler responds 500 for an unhandled rejection, which
 *   is exactly the §3h-correct status for this case, so no explicit
 *   try/catch wraps the consumer calls below).
 *
 * Known gaps this route stubs rather than silently mishandles — each logs
 * an error (operator alert) and returns 5xx, distinct from `invalid`
 * transitions (§3h's 2xx+alert case): these ARE potentially actionable
 * once their blocker clears, just not today, so Stripe's retry schedule is
 * left running rather than told to stop:
 * - `purchase_event` (`customer.subscription.created` + `invoice.paid`
 *   `subscription_create`): blocked on member↔customer linkage, which does
 *   not exist yet (`NEXT_STEPS.md` — ADR-0011, a named escalation-gated
 *   design item, Stage 3).
 * - `subscription_event` other than `renewed` (i.e. `renewal_failed`,
 *   `grace_exhausted`, `period_expired`): no consumer function exists yet
 *   for these state-only transitions (`NEXT_STEPS.md` — "left to a
 *   follow-up executor", pre-dates this route).
 * - `charge.refunded` (→ `refunded`): `Stripe.Charge` carries no
 *   subscription/invoice linkage in this SDK/API version (only
 *   `payment_intent`, itself requiring a further hop to reach an invoice's
 *   subscription) — resolving one needs a live Stripe API call, out of
 *   scope for this route's local-signature-only verification. Recorded in
 *   `NEXT_STEPS.md` as "refund routing via payment_intent→invoice→
 *   subscription resolution", a named follow-up — a technical-limitation
 *   stub, not a domain gap.
 */
export function registerStripeWebhookRoute(
  app: FastifyInstance,
  db: Db['db'],
  options: RegisterStripeWebhookRouteOptions,
): void {
  app.register((scoped) => {
    // Raw body preserved exactly, as a Buffer — Stripe's HMAC signature is
    // computed over the undecoded bytes, not over a JSON-reparsed object
    // (whitespace/key-order changes across a parse+reserialize round trip
    // would break verification even for a semantically identical payload).
    // `app.register`'s plugin encapsulation scopes this content-type
    // parser to this plugin context only — /health and any future
    // JSON-body route on the parent app are unaffected.
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scoped.post('/webhooks/stripe', async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string') {
        return reply.code(400).send({ error: 'missing_signature' });
      }

      const rawBody = request.body;
      /* c8 ignore next 4 -- unreachable given the scoped parseAs: 'buffer'
       * parser above always hands application/json requests a Buffer;
       * defensive against a future parser change, not a real runtime path. */
      if (!Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const verification = verifyStripeWebhookEvent(rawBody, signature, options.webhookSecret);
      if (!verification.ok) {
        return reply.code(400).send({ error: verification.error.code });
      }

      const event = verification.event;
      const effectiveAt = new Date(event.created * 1000);
      const normalized = normalizeStripeEvent(event);

      if (normalized.kind === 'unsupported') {
        request.log.info(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: unsupported event type, no-op',
        );
        return reply.code(200).send({ outcome: 'unsupported' });
      }

      if (normalized.kind === 'purchase_event') {
        // Blocked on member<->customer linkage (ADR-0011) — see doc
        // comment above. 5xx: potentially actionable once linkage lands,
        // not a permanent domain gap, so Stripe's retry schedule stays on.
        request.log.error(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: purchase_event blocked on member<->customer linkage (ADR-0011)',
        );
        return reply.code(500).send({ error: 'member_linkage_not_implemented' });
      }

      if (normalized.kind === 'context_event') {
        /* c8 ignore next 7 -- unreachable: today context_event only ever
         * originates from customer.subscription.updated (see
         * normalize-event.ts's own §3b coverage comment) — a real routing
         * bug, not a known stub, if this ever fires, hence 5xx + alert
         * rather than a silent 2xx no-op. Same defensive shape as the
         * invoice.paid guard below. */
        if (event.type !== 'customer.subscription.updated') {
          request.log.error(
            { eventId: event.id, eventType: event.type },
            'stripe webhook: context_event from an unexpected Stripe event type',
          );
          return reply.code(500).send({ error: 'unexpected_context_event_source' });
        }

        const result = await consumeContextEvent(db, {
          source: 'stripe',
          eventId: event.id,
          eventType: event.type,
          payload: event,
          effectiveAt,
          provider: 'stripe',
          providerSubscriptionId: event.data.object.id,
          events: normalized.events,
        });
        return reply.code(statusForRecordedOutcome(result)).send({ outcome: result.outcome });
      }

      // normalized.kind === 'subscription_event' from here.
      if (event.type === 'charge.refunded') {
        request.log.error(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: charge.refunded subscription-id extraction not implemented (payment_intent->invoice->subscription needs a live API call)',
        );
        return reply.code(500).send({ error: 'refund_routing_not_implemented' });
      }

      if (normalized.event.type !== 'renewed') {
        // renewal_failed | grace_exhausted | period_expired: no consumer
        // function exists yet for these state-only transitions (see doc
        // comment above) — genuinely actionable once one ships, so 5xx
        // (Stripe retries), not the "will never resolve" 2xx+alert §3h
        // reserves for invalid transitions.
        request.log.error(
          { eventId: event.id, eventType: event.type, normalizedType: normalized.event.type },
          'stripe webhook: no consumer implemented yet for this subscription event type',
        );
        return reply.code(500).send({ error: 'not_yet_implemented' });
      }

      // Only invoice.paid (billing_reason=subscription_cycle) normalizes
      // to 'renewed' today — see normalize-event.ts's §3b coverage.
      /* c8 ignore next 7 -- unreachable: same defensive shape as the
       * context_event branch above (only invoice.paid ever normalizes to
       * 'renewed' today — see normalize-event.ts's §3b coverage) — a real
       * routing bug if it ever fires, not a known stub. */
      if (event.type !== 'invoice.paid') {
        request.log.error(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: renewed event from an unexpected Stripe event type',
        );
        return reply.code(500).send({ error: 'unexpected_renewed_event_source' });
      }

      const routingKey = extractSubscriptionIdFromInvoice(event.data.object);
      if (!routingKey.ok) {
        request.log.error(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: invoice has no resolvable subscription linkage',
        );
        return reply.code(500).send({ error: 'routing_key_unresolved' });
      }

      const result = await consumeSubscriptionEconomicEvent(db, {
        source: 'stripe',
        eventId: event.id,
        eventType: event.type,
        payload: event,
        effectiveAt,
        provider: 'stripe',
        providerSubscriptionId: routingKey.providerSubscriptionId,
        event: normalized.event,
        // The invoice's own id is renewed's ledger natural key (ADR-0009
        // I3) — distinct from the subscription id above.
        providerReferenceId: event.data.object.id,
        periodEnd: new Date(event.data.object.period_end * 1000),
        periodStart: new Date(event.data.object.period_start * 1000),
      });
      return reply.code(statusForRecordedOutcome(result)).send({ outcome: result.outcome });
    });
  });
}

/**
 * ADR-0009 §3h: every outcome either consumer function returns other than
 * `no_matching_generation` means the fact is already recorded — 2xx, never
 * retry. `no_matching_generation` is the one outcome §3h routes to 5xx
 * (an ordering race Stripe's own retry schedule can resolve) rather than
 * 2xx, and it's the only outcome value the two result types share that
 * isn't a `payment_events.disposition` value at all (the function returns
 * before the inbox insert) — see §3h's own table for the full reasoning.
 */
function statusForRecordedOutcome(
  result: ConsumeContextEventResult | ConsumeSubscriptionEconomicEventResult,
): number {
  return result.outcome === 'no_matching_generation' ? 500 : 200;
}
