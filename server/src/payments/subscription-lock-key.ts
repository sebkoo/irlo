import type { SubscriptionProvider } from '../db/repositories/subscriptions.js';

/**
 * The `pg_advisory_xact_lock` key format shared by every economic-event
 * executor function that touches a subscription aggregate
 * (`consumePurchaseEvent`, `consumeSubscriptionEconomicEvent`) — a single
 * source of truth so the two independently-triggered functions serialize
 * against each other on the *same* lock, not two similar-looking-but-
 * different strings. Test harnesses that pre-hold this lock
 * (`raceViaAdvisoryLock`) must build the identical string.
 */
export function subscriptionLockKey(
  provider: SubscriptionProvider,
  providerSubscriptionId: string,
): string {
  return `subscription:${provider}:${providerSubscriptionId}`;
}
