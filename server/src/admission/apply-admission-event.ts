import { eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { admissionEvents, applications } from '../db/schema/index.js';
import {
  transition,
  type AdmissionAggregate,
  type AdmissionEvent,
  type AdmissionTransitionError,
} from '../domain/admission-transition.js';

export interface ApplyAdmissionEventInput {
  applicationId: string;
  event: AdmissionEvent;
  /**
   * The audit row's actor/reasonCode for event types that carry none of
   * their own (auto_triage, review_open, queue_advanced,
   * onboarding_complete — their guards are executor/authorization concerns
   * outside the pure core, see admission-transition.ts's doc comment), yet
   * I9 still requires every admission_events row to have an actor. For
   * decision/withdraw events, these fields are IGNORED — the row is
   * written from `event.actor`/`event.reasonCode` instead (see
   * `auditActor`/`auditReasonCode` below), so the append-only log can never
   * disagree with the domain event it's auditing, even if a caller passes
   * a mismatched value here by mistake.
   */
  actor: string;
  reasonCode: string | null;
}

export type ApplyAdmissionEventResult =
  | { outcome: 'applied' | 'noop' }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition' | 'conflicting_decision'; error: AdmissionTransitionError };

function toAggregate(row: typeof applications.$inferSelect): AdmissionAggregate {
  return { state: row.state, cooldownUntil: row.cooldownUntil };
}

function admissionEventLogType(
  event: AdmissionEvent,
): (typeof admissionEvents.$inferSelect)['event'] {
  if (event.type === 'decision') {
    if (event.outcome === 'accept') return 'decision_accept';
    if (event.outcome === 'reject') return 'decision_reject';
    return 'decision_defer';
  }
  return event.type;
}

/** decision/withdraw events carry their own actor — that's the audit source of truth, never the input's. */
function auditActor(event: AdmissionEvent, inputActor: string): string {
  if (event.type === 'decision' || event.type === 'withdraw') return event.actor;
  return inputActor;
}

/** Only decision events carry a reasonCode; every other event falls back to the caller-supplied value (typically null). */
function auditReasonCode(event: AdmissionEvent, inputReasonCode: string | null): string | null {
  if (event.type === 'decision') return event.reasonCode;
  return inputReasonCode;
}

/**
 * ADR-0009 §3c's per-generation events (auto_triage, review_open,
 * queue_advanced, decision, onboarding_complete, withdraw), wiring
 * `transition()` (C30) into the applications/admission_events tables.
 *
 * `SELECT ... FOR UPDATE` locks the target row for the transaction's
 * duration — the same read-then-decide-then-write shape as
 * `consumeContextEvent`, race-free without a SAVEPOINT or advisory lock
 * since the reducer's decision is knowable from a read before any write,
 * and (unlike `submitApplication`) there is always an existing row to lock
 * here — no zero-row case to protect.
 *
 * The audit row is written only on a genuine ok result (`applied` or
 * `noop`) — never on `invalid_transition`/`conflicting_decision` —
 * mirroring subscription-transition.ts's own documented rule that
 * `'invalid'` never becomes a persisted disposition. A rejected decision
 * attempt (the double-approve race) is real information, but it is
 * signaled to the caller via the typed result, not by writing a row to
 * the append-only audit-of-record.
 */
export async function applyAdmissionEvent(
  db: Db['db'],
  input: ApplyAdmissionEventInput,
): Promise<ApplyAdmissionEventResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .for('update');

    if (!existing) return { outcome: 'not_found' };

    const result = transition(toAggregate(existing), input.event);

    if (!result.ok) {
      return { outcome: result.error.code, error: result.error };
    }

    await tx.insert(admissionEvents).values({
      applicationId: input.applicationId,
      event: admissionEventLogType(input.event),
      actor: auditActor(input.event, input.actor),
      reasonCode: auditReasonCode(input.event, input.reasonCode),
    });

    if (!result.noop) {
      await tx
        .update(applications)
        .set({
          state: result.aggregate.state,
          cooldownUntil: result.aggregate.cooldownUntil,
          updatedAt: sql`now()`,
        })
        .where(eq(applications.id, input.applicationId));
    }

    return { outcome: result.noop ? 'noop' : 'applied' };
  });
}
