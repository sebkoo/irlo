import { and, eq } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import {
  isForeignKeyViolation,
  isInvalidTextRepresentation,
  isUniqueViolation,
} from '../db/pg-errors.js';
import type { SubscriptionProvider } from '../db/repositories/subscriptions.js';
import { paymentEvents, railIdentities } from '../db/schema/index.js';

export interface ConsumeLinkageEventInput {
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  effectiveAt: Date;
  provider: SubscriptionProvider;
  /** The rail's own payer id — Stripe Customer id today. Null means the session carried none (ADR-0011 §3b `unattributable`). */
  externalId: string | null;
  /** The server-set member id echoed back inside the signed session (ADR-0011 Q2's legitimacy chain). Null means the session carried none (`unattributable`). */
  clientReferenceId: string | null;
}

export type ConsumeLinkageEventResult =
  | { outcome: 'linked' | 'already_linked' }
  | { outcome: 'duplicate' }
  | { outcome: 'conflict' }
  | { outcome: 'member_not_found' }
  | { outcome: 'unattributable' };

/**
 * ADR-0011 §3b's `checkout.session.completed` backstop — an idempotent
 * upsert from the session's (customer, client_reference_id), both
 * server-set evidence echoed back under Stripe's signature (Q2's
 * legitimacy chain). No new `payment_events.disposition` value: `linked`
 * and `already_linked` both write `applied`; `conflict`, `member_not_found`,
 * and `unattributable` write no inbox row at all (mirrors ADR-0009 §3h's
 * `invalid` — retrying never resolves them, so there's nothing to dedupe).
 *
 * Unlike the other three consumers, the disposition here is only knowable
 * *after* attempting the link insert — there's no existing aggregate row to
 * read first, only the `UNIQUE(provider, external_id)` constraint (L3), so
 * the insert attempt itself is the decision. The nested transaction
 * (SAVEPOINT) around it is the same discipline as the ledger-insert
 * SAVEPOINTs in consume-purchase-event.ts / consume-consumable-refund.ts: a
 * caught violation would otherwise abort every later statement in the outer
 * transaction, including the inbox insert below.
 *
 * No `pg_advisory_xact_lock`, for the same reason as
 * consume-consumable-refund.ts: there is no aggregate row to protect a
 * read-then-decide race against. Postgres's own unique-index insert
 * semantics already serialize two concurrent claims on the same
 * `(provider, external_id)` — the second blocks until the first commits,
 * then either hits 23505 (classified below) or proceeds.
 */
export async function consumeLinkageEvent(
  db: Db['db'],
  input: ConsumeLinkageEventInput,
): Promise<ConsumeLinkageEventResult> {
  if (input.externalId === null || input.clientReferenceId === null) {
    // Returns before touching the database at all — a session our checkout
    // endpoint didn't create carries no evidence to even attempt a claim
    // against (§3b `unattributable`).
    return { outcome: 'unattributable' };
  }
  const externalId = input.externalId;
  const clientReferenceId = input.clientReferenceId;

  try {
    return await db.transaction(async (tx) => {
      let disposition: 'linked' | 'already_linked';

      try {
        await tx.transaction(async (tx2) => {
          await tx2.insert(railIdentities).values({
            memberId: clientReferenceId,
            provider: input.provider,
            externalId,
            linkedVia: 'checkout_session_completed',
          });
        });
        disposition = 'linked';
      } catch (error) {
        if (isForeignKeyViolation(error) || isInvalidTextRepresentation(error)) {
          // client_reference_id names no member — deleted between session
          // creation and completion, never valid (23503), or not even a
          // well-formed uuid (22P02, e.g. a session our own checkout
          // endpoint didn't create). All three are the same outcome: a
          // malformed value never resolves on redelivery any more than a
          // deleted member does, so it gets the identical "returns before
          // the inbox insert" treatment rather than an uncaught 5xx that
          // would have Stripe retrying something for ~3 days that will
          // never succeed. 22P02 can only originate from the uuid
          // memberId column here — `provider` is server-set and typed
          // (SubscriptionProvider), never sourced from the untrusted
          // payload, so it can't also raise 22P02 and be misclassified
          // into this bucket. Revisit this comment if provider ever
          // starts being read from caller input.
          return { outcome: 'member_not_found' };
        }
        /* c8 ignore next -- every constraint this insert can trip on
         * validly-typed input is already classified above (23505, 23503,
         * 22P02); reaching this rethrow needs a genuine infra fault
         * (connection loss mid-transaction), the same class of failure the
         * route-level "genuine transient infra fault" test exercises, not
         * duplicated per-consumer elsewhere in this codebase either. */
        if (!isUniqueViolation(error)) throw error;

        // (provider, externalId) already links to someone — L5's one
        // indexed read decides which outcome this is. Safe to read here:
        // Postgres's own insert-conflict blocking already forced this
        // transaction to wait for the conflicting insert to resolve before
        // the violation above was even raised.
        const [existing] = await tx
          .select({ memberId: railIdentities.memberId })
          .from(railIdentities)
          .where(
            and(
              eq(railIdentities.provider, input.provider),
              eq(railIdentities.externalId, externalId),
            ),
          );

        if (existing?.memberId !== clientReferenceId) {
          // L3: a conflicting claim is a typed error + alert, never a
          // silent repoint — returns before the inbox insert, exactly the
          // shape ADR-0009 §3h already blessed for `invalid`.
          return { outcome: 'conflict' };
        }
        disposition = 'already_linked';
      }

      // Inbox insert last here (not first, unlike the other three
      // consumers) — the disposition above was only knowable after the
      // link-insert attempt settled, not from a prior read.
      await tx.insert(paymentEvents).values({
        source: input.source,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        effectiveAt: input.effectiveAt,
        disposition: 'applied',
      });

      return { outcome: disposition };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: 'duplicate' };
    }
    throw error;
  }
}
