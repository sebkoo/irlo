/**
 * ADR-0009 §3b — the subscription state machine's pure core. A pure
 * function of (aggregate, event) → next aggregate | typed error, per
 * ADR-0005's pattern. No I/O: the executor (a later slice) wraps this with
 * idempotency layer 3 (the monotonic highWater guard) and persistence.
 */

export type SubscriptionState =
  'trial' | 'active' | 'grace' | 'billing_retry' | 'expired' | 'refunded';

export interface SubscriptionAggregate {
  state: SubscriptionState;
  willRenew: boolean;
}

export type SubscriptionEvent =
  | { type: 'renewed' }
  | { type: 'renewal_failed'; graceOffered: boolean }
  | { type: 'grace_exhausted' }
  | { type: 'period_expired'; retriesExhausted: boolean }
  | { type: 'refunded' };

export interface InvalidTransitionError {
  code: 'invalid_transition';
  state: SubscriptionState;
  eventType: SubscriptionEvent['type'];
}

export type TransitionResult =
  | { ok: true; aggregate: SubscriptionAggregate; noop?: true }
  | { ok: false; error: InvalidTransitionError };

function ok(aggregate: SubscriptionAggregate): TransitionResult {
  return { ok: true, aggregate };
}

function invalid(state: SubscriptionState, eventType: SubscriptionEvent['type']): TransitionResult {
  return { ok: false, error: { code: 'invalid_transition', state, eventType } };
}

export function transition(
  aggregate: SubscriptionAggregate,
  event: SubscriptionEvent,
): TransitionResult {
  const { state } = aggregate;

  // I6: terminal states absorb everything — no exceptions, including refund.
  // A literal comparison (not a Set/function lookup) so TS narrows `state`
  // for the switch below, keeping it provably exhaustive with no default.
  if (state === 'expired' || state === 'refunded') {
    return { ok: true, aggregate, noop: true };
  }

  // Refund is reachable from every non-terminal state (ADR-0004 refinement 2).
  if (event.type === 'refunded') {
    return ok({ ...aggregate, state: 'refunded' });
  }

  switch (state) {
    case 'trial':
      if (event.type === 'renewed') return ok({ ...aggregate, state: 'active' });
      if (event.type === 'period_expired') return ok({ ...aggregate, state: 'expired' });
      return invalid(state, event.type);

    case 'active':
      if (event.type === 'renewed') return ok({ ...aggregate, state: 'active' });
      if (event.type === 'renewal_failed') {
        return ok({ ...aggregate, state: event.graceOffered ? 'grace' : 'billing_retry' });
      }
      if (event.type === 'period_expired' && !aggregate.willRenew) {
        return ok({ ...aggregate, state: 'expired' });
      }
      return invalid(state, event.type);

    case 'grace':
      if (event.type === 'renewed') return ok({ ...aggregate, state: 'active' });
      if (event.type === 'grace_exhausted') return ok({ ...aggregate, state: 'billing_retry' });
      return invalid(state, event.type);

    case 'billing_retry':
      if (event.type === 'renewed') return ok({ ...aggregate, state: 'active' });
      if (event.type === 'period_expired' && event.retriesExhausted) {
        return ok({ ...aggregate, state: 'expired' });
      }
      return invalid(state, event.type);
  }
}
