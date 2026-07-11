import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { members } from './members.js';

/**
 * ADR-0009 consumable-credit projection: balance = Σ(ledger_entries rows) for
 * this (member, creditType). May go negative from a provider reversal of an
 * already-spent grant (member debt, I2) — no CHECK(balance >= 0) here; the
 * debit-side guard belongs to the Stage 2 transition executor, not the schema.
 */
export const consumableBalances = pgTable(
  'consumable_balances',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    creditType: text('credit_type').notNull(),
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.creditType] })],
);
