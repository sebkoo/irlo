import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { members } from './members.js';

/**
 * ADR-0009's single append-only ledger, in its two row shapes: countable
 * credit/debit rows (spark, undo, waitlist.skip) and time-bound grant/reversal
 * rows (irlo.plus periods). naturalKey is idempotency layer 2 (I3) — a
 * deterministic key per economic fact, unique regardless of which envelope
 * delivered it.
 */
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'credit',
  'debit',
  'grant',
  'reversal',
]);

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id),
  entryType: ledgerEntryTypeEnum('entry_type').notNull(),
  // The entitlement bucket this row affects: 'spark' | 'undo' | 'waitlist_skip' | 'irlo_plus'.
  creditType: text('credit_type').notNull(),
  // Catalog SKU that produced this row (e.g. 'spark.pack5'), informational.
  productId: text('product_id'),
  // Magnitude for credit/debit rows; null for grant/reversal (period-based).
  quantity: integer('quantity'),
  // Paid-period bounds for grant/reversal rows (irlo.plus); null for credit/debit.
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  naturalKey: text('natural_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
