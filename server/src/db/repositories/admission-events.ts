import type { Db } from '../client.js';
import { admissionEvents } from '../schema/index.js';

// Schema-derived (ADR-0003 D2) — id/createdAt are caller-irrelevant (both
// have DB defaults).
export type AdmissionEventRow = typeof admissionEvents.$inferSelect;

export type AppendAdmissionEventInput = Omit<
  typeof admissionEvents.$inferInsert,
  'id' | 'createdAt'
>;

export interface AdmissionEventsRepository {
  /**
   * I9's append-only audit log — actor, event, reason code, timestamp.
   * Unlike the ledger/inbox repositories, there is no natural key to dedupe
   * on: admission events are locally-invoked actions (submit, decision,
   * withdraw, …), not at-least-once provider redeliveries, so there is
   * nothing here to idempotently collapse — every call appends a new row.
   */
  append(input: AppendAdmissionEventInput): Promise<AdmissionEventRow>;
}

export function createAdmissionEventsRepository(db: Db['db']): AdmissionEventsRepository {
  return {
    async append(input) {
      const [row] = await db.insert(admissionEvents).values(input).returning();
      /* c8 ignore next -- an insert with no returning-conflict clause always
       * returns exactly one row when it doesn't throw. */
      if (!row) throw new Error('admission event insert returned no row');
      return row;
    },
  };
}
