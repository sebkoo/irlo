import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '../client.js';
import { railIdentities } from '../schema/index.js';

// Schema-derived (ADR-0003 D2).
export type RailIdentityRow = typeof railIdentities.$inferSelect;
export type RailIdentityProvider = RailIdentityRow['provider'];

export type CreateRailIdentityLinkInput = Omit<
  typeof railIdentities.$inferInsert,
  'id' | 'createdAt'
>;

export interface RailIdentitiesRepository {
  /**
   * ADR-0011 §3b's link-creation call — every caller (the checkout-session
   * endpoint, the `checkout.session.completed` backstop, audited operator
   * action) goes through this one insert. `UNIQUE(provider, external_id)`
   * (L3) rejects a conflicting claim as a raw unique-violation error,
   * deliberately uncaught — the same no-catch-recover discipline as
   * `SubscriptionsRepository.createGeneration`, because a conflicting claim
   * on an identity means concurrent or fraudulent processing, not benign
   * redelivery, and must surface rather than be silently absorbed. No
   * update method exists on this interface (L4): a correction is an
   * audited operator delete + recreate, never a mutation of this row.
   */
  createLink(input: CreateRailIdentityLinkInput): Promise<RailIdentityRow>;
  /**
   * The webhook-time resolver (L5: one indexed read on the
   * `UNIQUE(provider, external_id)` constraint). Returns just the member
   * id — the only field `consumePurchaseEvent`'s signature needs — rather
   * than a full row or a join through `members`, per the module's
   * existing minimal-shape convention (ADR-0011 §3b: "triplet detail, not
   * an ADR concern").
   */
  resolveMemberByRailIdentity(
    provider: RailIdentityProvider,
    externalId: string,
  ): Promise<string | undefined>;
  /**
   * Reverse lookup for checkout-time Customer reuse (ADR-0011 §3a: "take
   * the newest row for (member, provider)") — slice D's future caller.
   * Read-only; no write path exists in this direction.
   */
  getLatestIdentity(
    memberId: string,
    provider: RailIdentityProvider,
  ): Promise<RailIdentityRow | undefined>;
}

export function createRailIdentitiesRepository(db: Db['db']): RailIdentitiesRepository {
  return {
    async createLink(input) {
      const [row] = await db.insert(railIdentities).values(input).returning();
      /* c8 ignore next -- an insert with no returning-conflict clause always
       * returns exactly one row when it doesn't throw. */
      if (!row) throw new Error('rail identity link insert returned no row');
      return row;
    },

    async resolveMemberByRailIdentity(provider, externalId) {
      const [row] = await db
        .select({ memberId: railIdentities.memberId })
        .from(railIdentities)
        .where(
          and(eq(railIdentities.provider, provider), eq(railIdentities.externalId, externalId)),
        );
      return row?.memberId;
    },

    async getLatestIdentity(memberId, provider) {
      const [row] = await db
        .select()
        .from(railIdentities)
        .where(and(eq(railIdentities.memberId, memberId), eq(railIdentities.provider, provider)))
        .orderBy(desc(railIdentities.createdAt))
        .limit(1);
      return row;
    },
  };
}
