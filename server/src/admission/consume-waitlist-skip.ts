import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { applications, ledgerEntries } from '../db/schema/index.js';

import { applyAdmissionEvent } from './apply-admission-event.js';
import { waitlistSkipLockKey } from './waitlist-skip-lock-key.js';

export interface ConsumeWaitlistSkipInput {
  memberId: string;
  applicationId: string;
  /**
   * Client-minted UUID (ADR-0009 §3d layer 2, §3d/Q6's spend recipe) — a
   * network retry carrying the same key replays the original success,
   * never a second debit.
   */
  idempotencyKey: string;
}

export interface ConsumeWaitlistSkipResult {
  outcome: 'applied' | 'not_found' | 'already_priority' | 'not_waitlisted' | 'insufficient_credits';
}

function skipNaturalKey(memberId: string, idempotencyKey: string): string {
  return `waitlist_skip:spend:${memberId}:${idempotencyKey}`;
}

/**
 * ADR-0009 §3d/Q6's spend recipe applied to §3c's `skip_consumed` — the
 * first client-initiated *spend*-debit consumer (waitlist.skip). Reuses
 * `applyAdmissionEvent` (C33) for the domain effect (lane promotion +
 * `admission_events` audit row) rather than re-deriving the FOR-UPDATE +
 * `transition()` + audit-write shape: its own `db.transaction` becomes a
 * SAVEPOINT nested inside this function's outer transaction, so the lane
 * move and the ledger debit commit or roll back together (I11 — "both or
 * neither").
 *
 * Guard order mirrors Q6 exactly — natural-key replay check first, then
 * the balance guard, then the domain effect, and only once both guards
 * pass does the ledger debit get written:
 * - Checking the natural key *first* (not just an insert-then-catch) is
 *   what keeps a genuine retry from ever reaching `applyAdmissionEvent` a
 *   second time — by the time a retry arrives, the original success has
 *   already promoted the lane to `priority`, so re-running the domain
 *   guard would misreport `already_priority` for what is actually a benign
 *   replay.
 * - The balance guard runs before the domain effect (not after) so an
 *   insufficient-credits caller never has a lane promotion to roll back —
 *   the same ordering Q6 itself specifies (guard, *then* apply the effect).
 *
 * The advisory lock, keyed on memberId alone (`waitlistSkipLockKey`), is
 * what makes a plain (non-`FOR UPDATE`) balance read safe: every concurrent
 * spend attempt for this member's waitlist_skip credits — regardless of
 * which application — serializes on it, so there is no window for two
 * different idempotency keys to both act on a stale pre-debit balance.
 * `applyAdmissionEvent`'s own `FOR UPDATE` on the applications row is what
 * then serializes this function against any other admission-event writer
 * touching the same application.
 */
export async function consumeWaitlistSkip(
  db: Db['db'],
  input: ConsumeWaitlistSkipInput,
): Promise<ConsumeWaitlistSkipResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${waitlistSkipLockKey(input.memberId)}, 0))`,
    );

    const naturalKey = skipNaturalKey(input.memberId, input.idempotencyKey);
    const [existingDebit] = await tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.naturalKey, naturalKey));
    if (existingDebit) return { outcome: 'applied' };

    const [application] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, input.applicationId));
    // A caller cannot spend their credits against someone else's
    // application — an ownership mismatch is reported identically to a
    // nonexistent id, never leaking that the row exists for another member.
    if (!application?.memberId || application.memberId !== input.memberId) {
      return { outcome: 'not_found' };
    }

    const [balanceRow] = await tx
      .select({
        balance: sql<string>`coalesce(sum(case
          when ${ledgerEntries.entryType} = 'credit' then ${ledgerEntries.quantity}
          when ${ledgerEntries.entryType} = 'debit' then -${ledgerEntries.quantity}
          else 0
        end), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.memberId, input.memberId),
          eq(ledgerEntries.creditType, 'waitlist_skip'),
        ),
      );
    /* c8 ignore next -- coalesce(..., 0) guarantees a row and a non-null value. */
    const balance = Number(balanceRow?.balance ?? 0);
    if (balance < 1) return { outcome: 'insufficient_credits' };

    const result = await applyAdmissionEvent(tx, {
      applicationId: input.applicationId,
      event: { type: 'skip_consumed' },
      actor: `member:${input.memberId}`,
      reasonCode: null,
    });

    if (result.outcome === 'already_priority' || result.outcome === 'not_waitlisted') {
      return { outcome: result.outcome };
    }
    /* c8 ignore next 4 -- not_found is unreachable (the row was just
     * confirmed to exist above, still locked by this same transaction);
     * noop/invalid_transition never occur for skip_consumed — transition()'s
     * own handling of this event never returns them (admission-transition.ts). */
    if (result.outcome !== 'applied') {
      throw new Error(
        `consumeWaitlistSkip: unexpected applyAdmissionEvent outcome '${result.outcome}'`,
      );
    }

    await tx.insert(ledgerEntries).values({
      memberId: input.memberId,
      entryType: 'debit',
      creditType: 'waitlist_skip',
      productId: 'waitlist.skip',
      quantity: 1,
      naturalKey,
    });

    return { outcome: 'applied' };
  });
}
