/**
 * The `pg_advisory_xact_lock` key for `consumeWaitlistSkip` — keyed on
 * memberId alone, not per-application: the ledger's derived waitlist_skip
 * balance is per-member, so concurrent skip attempts against *different*
 * applications for the same member must still serialize on this one key,
 * mirroring `subscription-lock-key.ts`'s single-source-of-truth reasoning.
 */
export function waitlistSkipLockKey(memberId: string): string {
  return `waitlist_skip:${memberId}`;
}
