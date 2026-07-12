import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { SubscriptionProvider } from '../db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents, subscriptions } from '../db/schema/index.js';
import {
  applyEvent,
  type SubscriptionAggregateWithContext,
  type SubscriptionEvent,
} from '../domain/subscription-transition.js';

import { subscriptionLockKey } from './subscription-lock-key.js';

export interface ConsumeSubscriptionEconomicEventInput {
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  effectiveAt: Date;
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  event: Extract<SubscriptionEvent, { type: 'renewed' } | { type: 'refunded' }>;
  /**
   * The provider transaction/invoice id (for `renewed`) or refund id (for
   * `refunded`) — ADR-0009 I3's ledger natural key. Distinct row shapes:
   * `renewed` appends a `grant`, `refunded` a `reversal` (§3a's two shapes
   * for irlo.plus periods) — never a bare `debit`, which is the consumable
   * refund-debit path (`consumeConsumableRefund`, a different aggregate
   * entirely — this function never touches consumable balances).
   */
  providerReferenceId: string;
  periodEnd?: Date;
  periodStart?: Date;
}

export type ConsumeSubscriptionEconomicEventResult =
  | { outcome: 'applied' | 'superseded' | 'no_op_terminal' }
  | { outcome: 'duplicate' }
  | { outcome: 'no_matching_generation' };

function toAggregate(row: typeof subscriptions.$inferSelect): SubscriptionAggregateWithContext {
  return {
    state: row.state,
    willRenew: row.willRenew,
    productId: row.productId,
    currentPeriodEnd: row.currentPeriodEnd,
    highWater: row.highWater,
  };
}

/**
 * ADR-0009's `renewed`/`refunded` economic events applied to an **existing**
 * subscription generation via `applyEvent` — the sibling of
 * `consumePurchaseEvent` (generation-spawning `purchased`, which is the only
 * one of the three that may run against a no-row aggregate; renewed/refunded
 * only make sense post-purchase). Narrowly typed to just these two —
 * `renewal_failed`/`grace_exhausted`/`period_expired` move no money (Q2: "a
 * failed payment moves no money") and are left to a follow-up executor, same
 * deferral style as `consume-context-event.ts`'s own doc comment.
 *
 * Locking mirrors `consumePurchaseEvent`: the same
 * `pg_advisory_xact_lock(hashtextextended(subscriptionLockKey(...)))` is
 * taken first (so the two functions serialize against each other on the
 * same aggregate, not just against same-function racers), then
 * `SELECT ... FOR UPDATE` on the row — which, unlike `consumePurchaseEvent`,
 * always exists here or this call is a `no_matching_generation` no-op; the
 * `FOR UPDATE` is what makes this function and `consumeContextEvent`
 * (unmodified, already-shipped) mutually serialize on that row via ordinary
 * Postgres row-level locking.
 *
 * Money facts are always recorded (ADR-0009 I5a's philosophy, plus the
 * terminal-generation continuation rule in §3b: "an economic event
 * addressed to a terminal generation appends its ledger row ... plus an
 * audited no-op transition"): the ledger append happens unconditionally,
 * whatever `applyEvent` decides — applied, superseded (I5a), or
 * no_op_terminal all still append. `renewed`/`refunded` can never actually
 * produce `applyEvent`'s 'invalid' disposition (see the assertion below),
 * so all three schema-enum values map straight through with no translation
 * seam, unlike `consumePurchaseEvent`'s `no_op_live`.
 */
export async function consumeSubscriptionEconomicEvent(
  db: Db['db'],
  input: ConsumeSubscriptionEconomicEventInput,
): Promise<ConsumeSubscriptionEconomicEventResult> {
  try {
    return await db.transaction(async (tx) => {
      const lockKey = subscriptionLockKey(input.provider, input.providerSubscriptionId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

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

      const result = applyEvent(toAggregate(existing), {
        event: input.event,
        effectiveAt: input.effectiveAt,
        // exactOptionalPropertyTypes: omit the key entirely when absent.
        ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd }),
      });

      // Narrow BEFORE writing: ApplyEventDisposition includes 'invalid',
      // which has no slot in the schema's disposition enum. `renewed` is
      // valid from every non-terminal state and `refunded` is handled
      // unconditionally before transition()'s switch (ADR-0009 §3b) — so
      // 'invalid' can never actually occur for this function's event union.
      // That's a runtime guarantee TS can't see through applyEvent's shared
      // return type, so it's asserted here, not cast.
      /* c8 ignore next 9 -- unreachable for renewed/refunded (see comment above). */
      if (
        result.disposition !== 'applied' &&
        result.disposition !== 'superseded' &&
        result.disposition !== 'no_op_terminal'
      ) {
        throw new Error(
          `unexpected disposition '${result.disposition}' for a renewed/refunded event`,
        );
      }
      const disposition = result.disposition;

      // Inbox insert first — same read-then-decide-then-write ordering as
      // consumeContextEvent/consumePurchaseEvent: the disposition came from
      // a read, no write has happened yet.
      await tx.insert(paymentEvents).values({
        source: input.source,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        effectiveAt: input.effectiveAt,
        disposition,
      });

      // Money facts are always recorded, independent of the disposition
      // above (I5a; terminal-generation continuation). Nested transaction
      // (SAVEPOINT) deliberately: a caught unique violation on a bare
      // `tx.insert` would otherwise leave the *outer* transaction aborted
      // for every statement after it, and a subsequent plain `COMMIT` on an
      // aborted transaction is silently downgraded to a `ROLLBACK` by
      // Postgres with no client-visible error — see
      // consume-purchase-event.ts's identical comment, where this was
      // caught via a race test during development.
      const ledgerFields =
        input.event.type === 'renewed'
          ? {
              entryType: 'grant' as const,
              naturalKey: `${input.provider}:invoice:${input.providerReferenceId}`,
              periodStart: input.periodStart ?? null,
              periodEnd: result.aggregate.currentPeriodEnd,
            }
          : {
              entryType: 'reversal' as const,
              naturalKey: `${input.provider}:refund:${input.providerReferenceId}`,
              periodStart: null,
              periodEnd: null,
            };

      try {
        await tx.transaction(async (tx2) => {
          await tx2.insert(ledgerEntries).values({
            memberId: existing.memberId,
            entryType: ledgerFields.entryType,
            creditType: 'irlo_plus',
            productId: result.aggregate.productId,
            quantity: null,
            periodStart: ledgerFields.periodStart,
            periodEnd: ledgerFields.periodEnd,
            naturalKey: ledgerFields.naturalKey,
          });
        });
      } catch (error) {
        /* c8 ignore next -- unreachable via this function's public inputs:
         * memberId comes from an already-valid existing row (never
         * caller-supplied, unlike consumePurchaseEvent's generation-creation
         * path), and every other ledger column is either a hardcoded
         * literal or derived from a validated aggregate — there is no
         * reachable way to make this insert fail with anything other than
         * the unique-violation branch below. Kept (not deleted) as
         * defense-in-depth against a future caller-supplied field. */
        if (!isUniqueViolation(error)) throw error;
      }

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
