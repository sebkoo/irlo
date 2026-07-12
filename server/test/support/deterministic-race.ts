import type { Pool, PoolClient } from 'pg';

export interface RaceViaAdvisoryLockOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Deterministic-interleaving harness for the economic-event executor's
 * advisory-lock-protected functions (`consumePurchaseEvent`,
 * `consumeSubscriptionEconomicEvent` — ADR-0009). Pre-holds the exact same
 * advisory lock the production code takes (`pg_advisory_xact_lock` on
 * `hashtextextended(lockKey, 0)`), starts every racer (each blocks
 * immediately trying to acquire it), and only releases once `pg_locks`
 * confirms every racer is genuinely blocked on *this* key specifically —
 * not a hope-it-races `Promise.all` that might accidentally serialize via
 * pool/event-loop scheduling without ever exercising real contention.
 *
 * The `classid`/`objid` filter mirrors Postgres's own internal encoding for
 * the single-`bigint` advisory-lock form (high 32 bits → classid, low 32
 * bits → objid, objsubid = 1) — verified empirically against a live
 * Postgres 17 container before relying on it here, not assumed. Without
 * this filter, a parallel-running test file's unrelated advisory-lock
 * waiters could pollute the blocked-count. Both halves are masked with
 * `& 4294967295` and cast to `oid` (`pg_locks.classid`/`objid`'s own
 * column type, which is unsigned) rather than `::int` — a plain `::int`
 * cast intermittently raised "integer out of range": `hashtextextended`'s
 * low 32 bits are a full unsigned range, and roughly half of all possible
 * hashes produce an unsigned value above `int4`'s signed max (2147483647),
 * confirmed empirically with a handful of real keys before this fix.
 *
 * Polls via the holder's own already-checked-out client (not a fresh
 * `pool.query()`, which would need a connection beyond the caller's
 * `racers.length + 1` pool budget and could deadlock against the very
 * racers it's waiting on).
 *
 * Does not control *which* racer wins — exactly-once correctness doesn't
 * depend on winner identity, only on the resulting outcome set (e.g. "one
 * commits, one gets `duplicate`") — so callers assert on the set of
 * settled results, not on which racer produced which.
 */
export async function raceViaAdvisoryLock<T>(
  pool: Pool,
  lockKey: string,
  racers: readonly (() => Promise<T>)[],
  options: RaceViaAdvisoryLockOptions = {},
): Promise<PromiseSettledResult<T>[]> {
  const pollIntervalMs = options.pollIntervalMs ?? 20;
  const timeoutMs = options.timeoutMs ?? 5000;

  const holder: PoolClient = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

    const inFlight = racers.map((racer) => racer());

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await holder.query<{ n: number }>(
        `select count(*)::int as n from pg_locks
         where locktype = 'advisory' and not granted and objsubid = 1
           and classid = (((hashtextextended($1, 0) >> 32) & 4294967295))::oid
           and objid   = ((hashtextextended($1, 0) & 4294967295))::oid`,
        [lockKey],
      );
      if ((rows[0]?.n ?? 0) >= racers.length) break;
      if (Date.now() > deadline) {
        const confirmed = rows[0]?.n ?? 0;
        throw new Error(
          `raceViaAdvisoryLock: timed out after ${String(timeoutMs)}ms waiting for ` +
            `${String(racers.length)} waiter(s) on '${lockKey}' — only ${String(confirmed)} confirmed blocked`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    await holder.query('COMMIT');
    return await Promise.allSettled(inFlight);
  } finally {
    holder.release();
  }
}
