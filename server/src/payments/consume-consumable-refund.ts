import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { SubscriptionProvider } from '../db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents } from '../db/schema/index.js';

export interface ConsumeConsumableRefundInput {
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  effectiveAt: Date;
  provider: SubscriptionProvider;
  refundId: string;
  memberId: string;
  /** 'spark' | 'undo' | 'waitlist_skip' — the countable consumable bucket being refunded. */
  creditType: string;
  quantity: number;
}

export type ConsumeConsumableRefundResult = { outcome: 'applied' } | { outcome: 'duplicate' };

/**
 * ADR-0009 I2's negative-balance debt path — a provider refund of an
 * already-(possibly-)spent consumable pack (spark/undo/waitlist.skip).
 * A **different aggregate entirely** from the subscription economic events
 * (`consumePurchaseEvent`, `consumeSubscriptionEconomicEvent`): no
 * generation, no state machine, nothing to lock. This appends a `debit`
 * row — distinct from a spend-debit (member-initiated consumption, guarded
 * by `balance >= qty`) only by provenance (a provider refund id, not a
 * client-minted idempotency key), never by `entryType` alone, per I2. This
 * function deliberately never guards the resulting balance: I2 decision 4
 * makes a refund-induced negative balance member debt, not an error —
 * Σ(ledger rows) stays the single source of truth with no clamping.
 * Today's Stripe rail sells only the irlo.plus subscription
 * (`normalize-event.ts`'s own comment), so nothing calls this yet — same
 * position C23's ledger/inbox repositories were in before Stage 3 wired
 * them. Ready for Stage 4's Apple ONE_TIME_CHARGE refund wiring.
 *
 * No `pg_advisory_xact_lock` here, unlike the subscription-aggregate
 * functions — deliberately, not an oversight. There is no aggregate row to
 * protect a decision against: this function only ever performs two
 * independently-unique-constrained inserts (`payment_events`,
 * `ledger_entries`), and Postgres's own unique-index insert semantics
 * already serialize concurrent identical inserts (the second blocks until
 * the first commits, then either hits 23505 or proceeds) — no extra
 * coordination adds anything.
 */
export async function consumeConsumableRefund(
  db: Db['db'],
  input: ConsumeConsumableRefundInput,
): Promise<ConsumeConsumableRefundResult> {
  try {
    return await db.transaction(async (tx) => {
      // No reducer decision here — always 'applied' (there's no state to
      // supersede or absorb into a terminal generation).
      await tx.insert(paymentEvents).values({
        source: input.source,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        effectiveAt: input.effectiveAt,
        disposition: 'applied',
      });

      // Nested transaction (SAVEPOINT) for the same reason as
      // consume-purchase-event.ts / consume-subscription-economic-event.ts:
      // a caught unique violation on a bare `tx.insert` would otherwise
      // leave the outer transaction aborted for every statement after it,
      // and Postgres silently downgrades a subsequent plain `COMMIT` on an
      // aborted transaction to a `ROLLBACK` with no client-visible error —
      // which would discard the inbox row already staged above.
      try {
        await tx.transaction(async (tx2) => {
          await tx2.insert(ledgerEntries).values({
            memberId: input.memberId,
            entryType: 'debit',
            creditType: input.creditType,
            quantity: input.quantity,
            periodStart: null,
            periodEnd: null,
            naturalKey: `${input.provider}:refund:${input.refundId}`,
          });
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }

      return { outcome: 'applied' as const };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}
