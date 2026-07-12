import {
  bigserial,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * ADR-0009 idempotency layer 1 (the transactional inbox). Every processed
 * event — webhook, client JWS submission, or reconciliation correction —
 * lands here exactly once via the UNIQUE(source, event_id) constraint,
 * inserted in the same transaction as its effects.
 */
export const paymentEventDispositionEnum = pgEnum('payment_event_disposition', [
  'applied',
  'duplicate',
  'superseded',
  'no_op_terminal',
  // ADR-0009 addendum (see "Decisions recorded" §6): a purchase/resubscribe
  // event that lands on an already-live generation (a different envelope of
  // an economic fact whose ledger row already exists, or a genuinely
  // redundant purchase signal). Distinct from 'superseded' (I5/I5a
  // staleness — this isn't about highWater) and 'no_op_terminal' (the
  // generation here is live, not terminal).
  'no_op_live',
]);

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Free text, not an enum: providers/sources are expected to grow
    // (ADR-0009 "Future trends" — a third rail should cost a row, not a migration).
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type'),
    payload: jsonb('payload').notNull(),
    // Provider effective time (Apple signedDate / Stripe event.created) — the
    // basis of the (effectiveAt, inboxSeq) total order (ADR-0009 idempotency
    // layer 3).
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    inboxSeq: bigserial('inbox_seq', { mode: 'bigint' }),
    disposition: paymentEventDispositionEnum('disposition').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('payment_events_source_event_id_key').on(table.source, table.eventId)],
);
