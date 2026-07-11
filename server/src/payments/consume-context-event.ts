import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { paymentEvents, subscriptions } from '../db/schema/index.js';
import {
  applyEvent,
  type ContextEvent,
  type SubscriptionAggregateWithContext,
} from '../domain/subscription-transition.js';

export type SubscriptionProvider = typeof subscriptions.$inferSelect.provider;

export interface ConsumeContextEventInput {
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  effectiveAt: Date;
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  event: ContextEvent;
  /**
   * Present only for `renewal_extended` (Apple's RENEWAL_EXTENDED — Stripe
   * has no equivalent today). Without this, `renewal_extended` would report
   * 'applied' while extending nothing: its entire effect is `applyEvent`'s
   * period-context merge, which needs a periodEnd to merge.
   */
  periodEnd?: Date;
}

export type ConsumeContextEventResult =
  | { outcome: 'applied' | 'superseded' }
  | { outcome: 'duplicate' }
  | { outcome: 'no_matching_generation' };

/**
 * ADR-0009 I4 (transactional inbox) applied to context-only events
 * (autorenew_set, plan_changed, renewal_extended). Provider-agnostic —
 * lives outside `payments/stripe/` deliberately, since it operates purely
 * on the normalized `ContextEvent` the reducer understands, not on any
 * Stripe-specific payload shape; Apple's rail (Stage 4) feeds the same
 * function through its own normalizer. Never touches the ledger: context
 * events carry no economic fact by construction (ADR-0009 §3b), so there's
 * nothing to write there. Economic subscription events (renewed,
 * refunded, …) and generation-spawning purchase events need ledger writes
 * and lock-a-nonexistent-row handling this function doesn't do — deferred
 * to their own follow-up executor functions.
 *
 * Ordering (design-reviewed): the reducer is pure, so its disposition is
 * knowable from a READ (current subscription state) before any write — the
 * inbox row goes in FIRST, not last. `SELECT ... FOR UPDATE` locks the
 * target generation for the transaction's duration, serializing concurrent
 * deliveries for the same (provider, providerSubscriptionId) so the
 * read-then-decide-then-write sequence is race-free without a SAVEPOINT: a
 * `(source, event_id)` conflict on the inbox insert aborts the whole
 * transaction (nothing commits) and is caught OUTSIDE the transaction,
 * classified as 'duplicate' — the first delivery already did everything;
 * this one contributes nothing, by construction, not by recovery.
 */
export async function consumeContextEvent(
  db: Db['db'],
  input: ConsumeContextEventInput,
): Promise<ConsumeContextEventResult> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, input.provider),
            eq(subscriptions.providerSubscriptionId, input.providerSubscriptionId),
          ),
        )
        .orderBy(desc(subscriptions.generation))
        .limit(1)
        .for('update');

      if (!existing) {
        return { outcome: 'no_matching_generation' as const };
      }

      const aggregate: SubscriptionAggregateWithContext = {
        state: existing.state,
        willRenew: existing.willRenew,
        productId: existing.productId,
        currentPeriodEnd: existing.currentPeriodEnd,
        highWater: existing.highWater,
      };

      const result = applyEvent(aggregate, {
        event: input.event,
        effectiveAt: input.effectiveAt,
        // exactOptionalPropertyTypes: omit the key entirely when absent,
        // rather than passing periodEnd: undefined explicitly.
        ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd }),
      });

      // Narrow BEFORE writing: ApplyEventDisposition includes 'invalid' and
      // 'no_op_terminal', neither of which has a slot in the schema's
      // disposition enum (the documented seam in subscription-transition.ts).
      // Context events never actually produce either — applyEvent's
      // isContextEvent dispatch bypasses transition() (the only source of
      // those two values) entirely for this event family — but that's a
      // runtime guarantee TS can't see through applyEvent's shared return
      // type, so it's asserted here, not cast.
      /* c8 ignore next 2 -- unreachable for a ContextEvent input (see the
       * comment above), not merely untested. */
      if (result.disposition !== 'applied' && result.disposition !== 'superseded') {
        throw new Error(`unexpected disposition '${result.disposition}' for a context event`);
      }
      const disposition = result.disposition;

      // Inbox insert FIRST — the disposition above came from a read, no
      // write has happened yet. A unique violation here means a duplicate
      // delivery raced us; it propagates uncaught, aborting the whole
      // transaction (nothing below runs, nothing commits), and is
      // classified outside the transaction.
      await tx.insert(paymentEvents).values({
        source: input.source,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        effectiveAt: input.effectiveAt,
        disposition,
      });

      await tx
        .update(subscriptions)
        .set({
          state: result.aggregate.state,
          willRenew: result.aggregate.willRenew,
          productId: result.aggregate.productId,
          currentPeriodEnd: result.aggregate.currentPeriodEnd,
          highWater: result.aggregate.highWater,
        })
        .where(eq(subscriptions.id, existing.id));

      return { outcome: disposition };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}
