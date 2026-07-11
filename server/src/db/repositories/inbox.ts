import { and, eq } from 'drizzle-orm';

import type { Db } from '../client.js';
import { isUniqueViolation } from '../pg-errors.js';
import { paymentEvents } from '../schema/index.js';

export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type PaymentEventDisposition = PaymentEventRow['disposition'];

// Schema-derived (ADR-0003 D2) — id/inboxSeq/receivedAt are DB-generated,
// never caller-supplied.
export type TryInsertInboxEventInput = Omit<
  typeof paymentEvents.$inferInsert,
  'id' | 'inboxSeq' | 'receivedAt'
>;

export interface TryInsertInboxEventResult {
  /** false means this exact (source, event_id) envelope was already seen. */
  inserted: boolean;
  row: PaymentEventRow;
}

export interface InboxRepository {
  /**
   * ADR-0009 idempotency layer 1: enforces UNIQUE(source, event_id). On a
   * fresh envelope, inserts with the caller-supplied disposition — the
   * repository has no basis to choose one itself (see ADR-0009: disposition
   * reflects layers 1–3 combined, not this table alone). On exact
   * redelivery, inserts nothing and returns the original row untouched.
   */
  tryInsert(input: TryInsertInboxEventInput): Promise<TryInsertInboxEventResult>;
}

export function createInboxRepository(db: Db['db']): InboxRepository {
  return {
    async tryInsert(input) {
      try {
        const [row] = await db.insert(paymentEvents).values(input).returning();
        /* c8 ignore next -- an insert with no returning-conflict clause always
         * returns exactly one row when it doesn't throw. */
        if (!row) throw new Error('inbox event insert returned no row');
        return { inserted: true, row };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [existing] = await db
          .select()
          .from(paymentEvents)
          .where(
            and(eq(paymentEvents.source, input.source), eq(paymentEvents.eventId, input.eventId)),
          );
        /* c8 ignore next -- the unique constraint that just fired guarantees
         * a matching row exists. */
        if (!existing) throw error;
        return { inserted: false, row: existing };
      }
    },
  };
}
