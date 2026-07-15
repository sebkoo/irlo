/**
 * The `pg_advisory_xact_lock` key format for `submitApplication` — the one
 * admission function that can touch a zero-row `(memberId, crewId)` state,
 * mirroring `subscription-lock-key.ts`'s single-source-of-truth reasoning.
 * Test harnesses that pre-hold this lock (`raceViaAdvisoryLock`) must build
 * the identical string.
 */
export function applicationLockKey(memberId: string, crewId: string): string {
  return `application:${memberId}:${crewId}`;
}
