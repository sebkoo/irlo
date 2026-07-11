import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import { subscriptions } from '../schema/index.js';

// Schema-derived (ADR-0003 D2) — id/createdAt/updatedAt are caller-irrelevant
// (all three have DB defaults or are repository-managed).
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionProvider = SubscriptionRow['provider'];

export type CreateSubscriptionGenerationInput = Omit<
  typeof subscriptions.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

export type UpdateSubscriptionGenerationInput = Partial<
  Pick<
    typeof subscriptions.$inferInsert,
    'state' | 'willRenew' | 'productId' | 'currentPeriodEnd' | 'highWater'
  >
>;

export interface SubscriptionsRepository {
  /**
   * The highest-generation row for (provider, providerSubscriptionId), or
   * undefined if this subscription id has never been seen — the input
   * `applyPurchase` (ADR-0009 §3b's `[*]` entry transitions) needs to decide
   * whether to spawn a fresh generation or treat a purchase signal as a
   * live no-op.
   */
  getLatestGeneration(
    provider: SubscriptionProvider,
    providerSubscriptionId: string,
  ): Promise<SubscriptionRow | undefined>;
  /**
   * `applyPurchase`'s 'generation_created' path — always a fresh row, never
   * an update to an existing one (I6: terminal generations never resurrect).
   */
  createGeneration(input: CreateSubscriptionGenerationInput): Promise<SubscriptionRow>;
  /** `applyEvent`'s output — mutable context/state fields on an existing generation. */
  updateGeneration(id: string, patch: UpdateSubscriptionGenerationInput): Promise<SubscriptionRow>;
}

export function createSubscriptionsRepository(db: Db['db']): SubscriptionsRepository {
  return {
    async getLatestGeneration(provider, providerSubscriptionId) {
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, provider),
            eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
          ),
        )
        .orderBy(desc(subscriptions.generation))
        .limit(1);
      return row;
    },

    async createGeneration(input) {
      const [row] = await db.insert(subscriptions).values(input).returning();
      /* c8 ignore next -- an insert with no returning-conflict clause always
       * returns exactly one row when it doesn't throw. */
      if (!row) throw new Error('subscription generation insert returned no row');
      return row;
    },

    async updateGeneration(id, patch) {
      // updatedAt uses the DB's own clock (sql`now()`), not the app
      // server's (`new Date()`) — createdAt/the row's initial updatedAt
      // come from Postgres's defaultNow() at insert time, and comparing a
      // DB-clock timestamp against an app-clock one is only safe if the two
      // clocks are perfectly synced, which they aren't guaranteed to be.
      const [row] = await db
        .update(subscriptions)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(subscriptions.id, id))
        .returning();
      /* c8 ignore next -- updating by primary key on a row the caller just
       * fetched or created always matches exactly one row. */
      if (!row) throw new Error('subscription generation update matched no row');
      return row;
    },
  };
}
