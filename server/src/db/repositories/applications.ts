import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import { applications } from '../schema/index.js';

// Schema-derived (ADR-0003 D2) — id/createdAt/updatedAt are caller-irrelevant
// (all three have DB defaults or are repository-managed).
export type ApplicationRow = typeof applications.$inferSelect;

export type CreateApplicationGenerationInput = Omit<
  typeof applications.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

export type UpdateApplicationGenerationInput = Partial<
  Pick<typeof applications.$inferInsert, 'state' | 'cooldownUntil'>
>;

export interface ApplicationsRepository {
  /**
   * The highest-generation row for (memberId, crewId), or undefined if this
   * member has never applied to this crew — the input applySubmission
   * (ADR-0009 §3c's submit event) needs to decide whether to spawn a fresh
   * generation, block on an already-live one, or gate a reapply on cooldown.
   */
  getLatestGeneration(memberId: string, crewId: string): Promise<ApplicationRow | undefined>;
  /** applySubmission's generation-spawn path — always a fresh row, never an update to an existing one. */
  createGeneration(input: CreateApplicationGenerationInput): Promise<ApplicationRow>;
  /** transition()'s output — mutable state/cooldownUntil fields on an existing generation. */
  updateGeneration(id: string, patch: UpdateApplicationGenerationInput): Promise<ApplicationRow>;
}

export function createApplicationsRepository(db: Db['db']): ApplicationsRepository {
  return {
    async getLatestGeneration(memberId, crewId) {
      const [row] = await db
        .select()
        .from(applications)
        .where(and(eq(applications.memberId, memberId), eq(applications.crewId, crewId)))
        .orderBy(desc(applications.generation))
        .limit(1);
      return row;
    },

    async createGeneration(input) {
      const [row] = await db.insert(applications).values(input).returning();
      /* c8 ignore next -- an insert with no returning-conflict clause always
       * returns exactly one row when it doesn't throw. */
      if (!row) throw new Error('application generation insert returned no row');
      return row;
    },

    async updateGeneration(id, patch) {
      // updatedAt uses the DB's own clock (sql`now()`), not the app
      // server's (`new Date()`) — same reasoning as
      // SubscriptionsRepository.updateGeneration.
      const [row] = await db
        .update(applications)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(applications.id, id))
        .returning();
      /* c8 ignore next -- updating by primary key on a row the caller just
       * fetched or created always matches exactly one row. */
      if (!row) throw new Error('application generation update matched no row');
      return row;
    },
  };
}
