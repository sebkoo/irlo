import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { admissionEvents, applications } from '../db/schema/index.js';
import { applySubmission, type AdmissionAggregate } from '../domain/admission-transition.js';

import { applicationLockKey } from './application-lock-key.js';

export interface SubmitApplicationInput {
  memberId: string;
  crewId: string;
  actor: string;
  crewOpen: boolean;
  cooldownElapsed: boolean;
}

export type SubmitApplicationResult =
  | { outcome: 'submitted'; applicationId: string }
  | { outcome: 'crew_not_open' | 'already_applied' | 'cooldown_active' };

function toAggregate(row: typeof applications.$inferSelect): AdmissionAggregate {
  return { state: row.state, cooldownUntil: row.cooldownUntil };
}

/**
 * ADR-0009 §3c's submit event / §3b refinement 8's reapply rule, wiring
 * `applySubmission` (C31) into the applications/admission_events tables.
 *
 * Locking mirrors `consumePurchaseEvent` exactly, for the same reason:
 * `pg_advisory_xact_lock`, keyed on `(memberId, crewId)`, is taken first —
 * the only thing that protects the zero-row generation-creation decision
 * (two concurrent first-ever submissions would otherwise both read "no
 * application exists" and race to create generation 1). `SELECT ... FOR
 * UPDATE` is still taken once a row exists, so this function and
 * `applyAdmissionEvent` (unmodified — it already uses `FOR UPDATE`)
 * mutually serialize on an existing row via ordinary Postgres row-level
 * locking, with no special coordination between the two.
 *
 * Unlike `consumePurchaseEvent`'s benign `no_op_live` outcome for a
 * duplicate provider redelivery, a colliding submit is a genuine
 * user-initiated conflict — its guard failures (`crew_not_open`,
 * `already_applied`, `cooldown_active`) write nothing to
 * `admission_events`: no admission action actually happened, so there is
 * nothing to audit.
 */
export async function submitApplication(
  db: Db['db'],
  input: SubmitApplicationInput,
): Promise<SubmitApplicationResult> {
  return db.transaction(async (tx) => {
    const lockKey = applicationLockKey(input.memberId, input.crewId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [latest] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.memberId, input.memberId), eq(applications.crewId, input.crewId)))
      .orderBy(desc(applications.generation))
      .limit(1)
      .for('update');

    const result = applySubmission(latest ? toAggregate(latest) : null, {
      crewOpen: input.crewOpen,
      cooldownElapsed: input.cooldownElapsed,
    });

    if (!result.ok) {
      return { outcome: result.error.code };
    }

    const [created] = await tx
      .insert(applications)
      .values({
        memberId: input.memberId,
        crewId: input.crewId,
        generation: (latest?.generation ?? 0) + 1,
        state: result.aggregate.state,
        lane: null,
        cooldownUntil: result.aggregate.cooldownUntil,
      })
      .returning();
    /* c8 ignore next -- an insert with no returning-conflict clause always
     * returns exactly one row when it doesn't throw. */
    if (!created) throw new Error('application generation insert returned no row');

    await tx.insert(admissionEvents).values({
      applicationId: created.id,
      event: 'submit',
      actor: input.actor,
      reasonCode: null,
    });

    return { outcome: 'submitted', applicationId: created.id };
  });
}
