import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { members } from './members.js';

/**
 * ADR-0009 subscription aggregate projection, keyed
 * (provider, providerSubscriptionId, generation). Generation exists because
 * Apple reuses originalTransactionId on resubscribe-after-expiry; a new
 * generation is a fresh row, never a resurrected terminal one (I6).
 *
 * Deliberately not yet columns (deferred to their consuming milestone, not
 * omitted by oversight): `offer` (aggregate context) — the raw detail already
 * lives in payment_events.payload, the log is the truth; and a
 * reconciliation `superseded_by` provenance pointer (ADR-0009 Q3, Stage 5).
 */
export const subscriptionProviderEnum = pgEnum('subscription_provider', ['apple', 'stripe']);

export const subscriptionStateEnum = pgEnum('subscription_state', [
  'trial',
  'active',
  'grace',
  'billing_retry',
  'expired',
  'refunded',
]);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    provider: subscriptionProviderEnum('provider').notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    generation: integer('generation').notNull().default(1),
    state: subscriptionStateEnum('state').notNull(),
    productId: text('product_id').notNull(),
    willRenew: boolean('will_renew').notNull().default(true),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    // Last applied provider effective time — idempotency layer 3's
    // per-generation monotonic guard (ADR-0009 I5/I5a).
    highWater: timestamp('high_water', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('subscriptions_provider_sub_id_generation_key').on(
      table.provider,
      table.providerSubscriptionId,
      table.generation,
    ),
  ],
);
