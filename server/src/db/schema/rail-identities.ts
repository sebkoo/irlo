import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { members } from './members.js';
import { subscriptionProviderEnum } from './subscriptions.js';

/**
 * ADR-0011: the member↔payment-rail identity mapping — edge identity data,
 * not an aggregate or projection (I14's single-write-path rule doesn't
 * govern it; the transition executor neither reads nor writes this table).
 * One member : many identities — a support-recreated Stripe Customer keeps
 * its old row so the replaced customer's late refund/chargeback webhooks
 * still resolve (§3a/§3f). UNIQUE(provider, external_id) makes an identity
 * map to at most one member, ever (L3): a conflicting claim is a typed
 * error, never a silent repoint. Rows are immutable — no member_id UPDATE
 * exists on this table (L4); corrections are audited operator delete +
 * recreate. Reusing `subscriptionProviderEnum` here is a deliberate naming
 * trade-off (§3a): the enum outgrows its prefix, but a rename buys no
 * behavioral payoff until a second non-subscription consumer exists.
 */
export const railIdentities = pgTable(
  'rail_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    provider: subscriptionProviderEnum('provider').notNull(),
    externalId: text('external_id').notNull(),
    // Provenance: 'checkout_session' | 'checkout_session_completed' | 'minted'
    // | 'client_transaction' | 'operator' | 'reconciliation' — free text over
    // an enum for the same reason payment_events.source is (§3a).
    linkedVia: text('linked_via').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('rail_identities_provider_external_id_key').on(table.provider, table.externalId),
    index('rail_identities_member_id_provider_idx').on(table.memberId, table.provider),
  ],
);
