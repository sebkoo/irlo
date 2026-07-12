import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { SubscriptionProvider } from '../db/repositories/subscriptions.js';
import { ledgerEntries, paymentEvents, subscriptions } from '../db/schema/index.js';
import {
  applyPurchase,
  type PurchaseEvent,
  type SubscriptionAggregateWithContext,
} from '../domain/subscription-transition.js';

export interface ConsumePurchaseEventInput {
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  effectiveAt: Date;
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  memberId: string;
  event: PurchaseEvent;
  productId: string;
  /** The provider transaction/invoice id backing this purchase — ADR-0009 I3's ledger natural key. */
  invoiceOrTransactionId: string;
  periodEnd?: Date;
  periodStart?: Date;
}

export type ConsumePurchaseEventResult =
  { outcome: 'generation_created' | 'no_op_live' } | { outcome: 'duplicate' };

function lockKeyFor(provider: SubscriptionProvider, providerSubscriptionId: string): string {
  return `subscription:${provider}:${providerSubscriptionId}`;
}

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
 * ADR-0009's `[*] --> trial|active` entry transition (`applyPurchase`),
 * generation-spawning included — the one economic event that may run
 * against a `(provider, providerSubscriptionId)` with **no row yet** (the
 * first-ever purchase). That's why this is a separate function from
 * `consumeSubscriptionEconomicEvent` (renewed/refunded, which only ever
 * touch an existing generation) rather than one shared function: the
 * concurrency-control needs genuinely differ.
 *
 * Locking is layered, not either/or:
 * - `pg_advisory_xact_lock(hashtextextended(...))`, keyed on
 *   `(provider, providerSubscriptionId)`, is taken FIRST — it's the only
 *   thing that protects the zero-row generation-creation decision (two
 *   concurrent first purchases would otherwise both read "no generation
 *   exists" and race to create generation 1; `SELECT ... FOR UPDATE` cannot
 *   protect a row that doesn't exist yet). `hashtextextended` (a full
 *   64-bit hash) is used over `hashtext` (32-bit) to shrink the collision
 *   space — a collision only causes two *unrelated* aggregates to
 *   spuriously serialize against each other for the duration of a
 *   transaction; it can never cause an incorrect result, since the lock is
 *   purely a mutual-exclusion gate, not a source of truth.
 * - `SELECT ... FOR UPDATE` is still taken on the row once the read shows
 *   one exists. This is what actually makes this function and
 *   `consumeContextEvent` (unmodified — it already uses `FOR UPDATE`)
 *   mutually serialize on an existing row: Postgres's own row-level locking
 *   (automatic on `FOR UPDATE`/`UPDATE`) requires no special coordination
 *   between the two. An advisory lock alone would NOT have been sufficient
 *   here — a plain, non-locking `SELECT` under READ COMMITTED never blocks
 *   on someone else's row lock, so a function that only took the advisory
 *   lock could compute its decision from a stale pre-commit read of a
 *   concurrent `consumeContextEvent`'s in-flight change and then silently
 *   overwrite it (a lost update, not a benign gap).
 *
 * Net: the only genuinely unserialized window is the *no-row* case, and the
 * only function that can ever touch a no-row aggregate is this one racing
 * itself — exactly what the advisory lock closes.
 *
 * Ordering mirrors `consumeContextEvent`: the reducer is pure, so the
 * disposition is knowable from a read before any write — the inbox row
 * goes in first. Money facts are always recorded (ADR-0009's stated
 * philosophy for I5a and terminal-generation continuations, generalized
 * here): the ledger grant append happens unconditionally, whether this
 * purchase creates a fresh generation or lands on an already-live one — a
 * genuinely new transaction/invoice id still records its grant even on the
 * `no_op_live` path, idempotent via the ledger's own natural key (I3).
 */
export async function consumePurchaseEvent(
  db: Db['db'],
  input: ConsumePurchaseEventInput,
): Promise<ConsumePurchaseEventResult> {
  try {
    return await db.transaction(async (tx) => {
      const lockKey = lockKeyFor(input.provider, input.providerSubscriptionId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [latest] = await tx
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

      const purchaseResult = applyPurchase(latest ? toAggregate(latest) : null, input.event, {
        effectiveAt: input.effectiveAt,
        productId: input.productId,
        // exactOptionalPropertyTypes: omit the key entirely when absent.
        ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd }),
      });

      // 'generation_created' maps onto the schema's existing 'applied' — it
      // fits ('applied' already means "the event's effects were
      // committed," and a new generation row is exactly that).
      // 'no_op_live' has its own schema slot (ADR-0009 "Decisions
      // recorded" §6) — distinct from 'superseded' (I5/I5a staleness,
      // irrelevant here) and 'no_op_terminal' (this generation is live,
      // not terminal).
      const disposition =
        purchaseResult.disposition === 'generation_created' ? 'applied' : 'no_op_live';

      // Inbox insert first — the disposition above came from a read, no
      // write has happened yet. A unique violation here means a duplicate
      // delivery (same eventId) raced us; it propagates uncaught, aborting
      // the whole transaction (nothing commits), classified outside.
      await tx.insert(paymentEvents).values({
        source: input.source,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        effectiveAt: input.effectiveAt,
        disposition,
      });

      // Money facts are always recorded, independent of the
      // generation-creation decision above — idempotent via the ledger's
      // own natural key (I3): a different envelope of the same economic
      // fact adds no second row. Wrapped in a nested transaction
      // (SAVEPOINT) deliberately: a caught unique violation on a bare
      // `tx.insert` would otherwise leave the *outer* transaction in
      // Postgres's aborted state for every statement after it — including
      // the inbox row already staged above — and a subsequent plain
      // `COMMIT` on an aborted transaction is silently downgraded to a
      // `ROLLBACK` by Postgres with no client-visible error, so the whole
      // transaction (not just this insert) would vanish without this
      // function ever seeing a thrown error. `ROLLBACK TO SAVEPOINT`
      // isolates the failure to this one insert.
      try {
        await tx.transaction(async (tx2) => {
          await tx2.insert(ledgerEntries).values({
            memberId: input.memberId,
            entryType: 'grant',
            creditType: 'irlo_plus',
            productId: input.productId,
            quantity: null,
            periodStart: input.periodStart ?? null,
            periodEnd: purchaseResult.aggregate.currentPeriodEnd,
            naturalKey: `${input.provider}:invoice:${input.invoiceOrTransactionId}`,
          });
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }

      if (purchaseResult.isNewGeneration) {
        await tx.insert(subscriptions).values({
          memberId: input.memberId,
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId,
          generation: (latest?.generation ?? 0) + 1,
          state: purchaseResult.aggregate.state,
          productId: purchaseResult.aggregate.productId,
          willRenew: purchaseResult.aggregate.willRenew,
          currentPeriodEnd: purchaseResult.aggregate.currentPeriodEnd,
          highWater: purchaseResult.aggregate.highWater,
        });
      }

      return { outcome: purchaseResult.disposition };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}
