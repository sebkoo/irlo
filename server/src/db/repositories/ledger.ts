import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import { isUniqueViolation } from '../pg-errors.js';
import { ledgerEntries } from '../schema/index.js';

export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// Schema-derived (ADR-0003 D2) — id/createdAt are caller-irrelevant (both
// have DB defaults); entryType stays in lockstep with the pgEnum instead of
// a hand-duplicated union.
export type AppendLedgerEntryInput = Omit<typeof ledgerEntries.$inferInsert, 'id' | 'createdAt'>;

export interface LedgerRepository {
  /**
   * Idempotent on naturalKey (ADR-0009 I3, idempotency layer 2): replaying
   * the same economic fact under a different envelope adds no row and
   * returns the original.
   */
  append(input: AppendLedgerEntryInput): Promise<LedgerEntry>;
  /**
   * Σ(credit) − Σ(debit) for this (member, creditType). grant/reversal rows
   * (irlo.plus periods) never participate — they carry no countable
   * quantity. May be negative (I2, decision 4) — no clamping.
   */
  getBalance(memberId: string, creditType: string): Promise<number>;
}

export function createLedgerRepository(db: Db['db']): LedgerRepository {
  return {
    async append(input) {
      try {
        const [row] = await db.insert(ledgerEntries).values(input).returning();
        /* c8 ignore next -- an insert with no returning-conflict clause always
         * returns exactly one row when it doesn't throw. */
        if (!row) throw new Error('ledger entry insert returned no row');
        return row;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [existing] = await db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.naturalKey, input.naturalKey));
        /* c8 ignore next -- the unique constraint that just fired guarantees
         * a matching row exists. */
        if (!existing) throw error;
        return existing;
      }
    },

    async getBalance(memberId, creditType) {
      const [result] = await db
        .select({
          balance: sql<string>`coalesce(sum(case
            when ${ledgerEntries.entryType} = 'credit' then ${ledgerEntries.quantity}
            when ${ledgerEntries.entryType} = 'debit' then -${ledgerEntries.quantity}
            else 0
          end), 0)`,
        })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.memberId, memberId), eq(ledgerEntries.creditType, creditType)));
      /* c8 ignore next -- coalesce(..., 0) guarantees a row and a non-null value. */
      return Number(result?.balance ?? 0);
    },
  };
}
