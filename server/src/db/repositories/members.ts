import { eq } from 'drizzle-orm';

import type { Db } from '../client.js';
import { members } from '../schema/index.js';

// Schema-derived (ADR-0003 D2: types generated from the schema, not
// hand-duplicated) — a future members column widens this automatically.
export type Member = typeof members.$inferSelect;

export interface MembersRepository {
  create(): Promise<Member>;
  getById(id: string): Promise<Member | undefined>;
}

/**
 * Stage 1's one repository — the pattern Stage 2 (C23+) replicates for the
 * ledger/admission tables C21 already created.
 */
export function createMembersRepository(db: Db['db']): MembersRepository {
  return {
    async create() {
      const [row] = await db.insert(members).values({}).returning();
      /* c8 ignore next -- an insert with no returning-conflict clause always
       * returns exactly one row; this guard only satisfies TS's array type,
       * forcing it via a mock would test the mock, not this code. */
      if (!row) throw new Error('member insert returned no row');
      return row;
    },
    async getById(id) {
      const [row] = await db.select().from(members).where(eq(members.id, id));
      return row;
    },
  };
}
