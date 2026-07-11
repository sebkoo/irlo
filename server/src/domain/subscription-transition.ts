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

/**
 * ADR-0009 idempotency layer 3 (I5/I5a) — the monotonic highWater guard,
 * wrapping C24's transition() without modifying it. currentPeriodEnd and
 * highWater live here, on the persisted superset of the pure core's
 * aggregate, so transition()'s signature stays untouched.
 */
export interface SubscriptionAggregateWithContext extends SubscriptionAggregate {
  productId: string;
  currentPeriodEnd: Date | null;
  highWater: Date | null;
}

/**
 * ADR-0009 §3b's context-only events — DID_CHANGE_RENEWAL_STATUS,
 * DID_CHANGE_RENEWAL_PREF, RENEWAL_EXTENDED and their Stripe counterparts.
 * None of these appear in `SubscriptionEvent`: they never move `state`, so
 * they bypass `transition()` (and I6's terminal-absorption check, which is
 * specifically about state) entirely — see `applyContextEvent` below.
 * `offer` is deliberately not tracked here, matching the subscriptions
 * schema's own deferral (`server/src/db/schema/subscriptions.ts`): the raw
 * detail lives in `payment_events.payload`, the log is the truth.
 */
export type ContextEvent =
  | { type: 'autorenew_set'; willRenew: boolean }
  | { type: 'plan_changed'; productId: string }
  | { type: 'renewal_extended' };

function isContextEvent(event: SubscriptionEvent | ContextEvent): event is ContextEvent {
  return (
    event.type === 'autorenew_set' ||
    event.type === 'plan_changed' ||
    event.type === 'renewal_extended'
  );
}

function applyContextEvent(
  aggregate: SubscriptionAggregateWithContext,
  event: ContextEvent,
): SubscriptionAggregateWithContext {
  switch (event.type) {
    case 'autorenew_set':
      return { ...aggregate, willRenew: event.willRenew };
    case 'plan_changed':
      return { ...aggregate, productId: event.productId };
    case 'renewal_extended':
      return aggregate;
  }
}

/**
 * Staleness here is effectiveAt-only (`effectiveAt < highWater`), so two
 * events sharing the same effectiveAt are both treated as non-stale.
 * ADR-0009's full ordering key is (effectiveAt, inbox_seq) — inbox_seq is
 * DB-assigned by the inbox repository, an executor-level concern this pure
 * function doesn't have access to. Same-effectiveAt tiebreaking is the
 * executor's job, not modeled here.
 */
export interface TimedSubscriptionEvent {
  event: SubscriptionEvent | ContextEvent;
  effectiveAt: Date;
  /** Present only for events that carry a new period end (e.g. renewed). */
  periodEnd?: Date;
}

/**
 * 'applied' | 'superseded' | 'no_op_terminal' map directly onto
 * `payment_events.disposition` (C21's schema enum). 'applied' means the
 * event's effects were committed — a state change, a context update
 * (autorenew_set, plan_changed, renewal_extended), or both; it does not by
 * itself imply `stateChanged`. 'invalid' does NOT map to the schema enum —
 * the schema enum has no slot for an off-graph event, deliberately: a domain
 * error isn't an idempotency outcome. The executor must not write an
 * 'invalid' result as a disposition value; route it to alerting/operator
 * review instead (mechanism TBD at executor-wiring time — this is the
 * documented seam, not a silent gap).
 */
export type ApplyEventDisposition = 'applied' | 'superseded' | 'no_op_terminal' | 'invalid';

export interface ApplyEventResult {
  aggregate: SubscriptionAggregateWithContext;
  stateChanged: boolean;
  disposition: ApplyEventDisposition;
  error?: InvalidTransitionError;
}

function mergePeriodEnd(current: Date | null, incoming: Date | undefined): Date | null {
  if (incoming === undefined) return current;
  if (current === null || incoming > current) return incoming;
  return current;
}

/**
 * ADR-0009 §3b's `[*] --> trial|active` entry transitions — a purchase (or
 * Apple RESUBSCRIBE) event. Deliberately outside `SubscriptionEvent`: every
 * other event transitions an *existing* aggregate; a purchase decides
 * whether one exists to transition at all. `latestGeneration` is that
 * generation's aggregate — the highest-numbered one on record for this
 * (provider, providerSubscriptionId) — or null if none has ever been
 * created (this member's first purchase on this subscription id).
 */
export interface PurchaseEvent {
  type: 'purchased';
  /** Trial entry vs immediate active entry — ADR-0009 §3b's `[offer present]` guard. */
  offerPresent: boolean;
}

export type PurchaseDisposition = 'generation_created' | 'no_op_live';

export interface PurchaseResult {
  aggregate: SubscriptionAggregateWithContext;
  isNewGeneration: boolean;
  disposition: PurchaseDisposition;
}

function createGeneration(
  event: PurchaseEvent,
  timed: { effectiveAt: Date; periodEnd?: Date; productId: string },
): SubscriptionAggregateWithContext {
  return {
    state: event.offerPresent ? 'trial' : 'active',
    willRenew: true,
    productId: timed.productId,
    currentPeriodEnd: mergePeriodEnd(null, timed.periodEnd),
    highWater: timed.effectiveAt,
  };
}

/**
 * No generation on record, or the latest one is terminal (I6: expired and
 * refunded never resurrect — continuation is always a new generation) →
 * spawn a fresh generation at `[*]`. Otherwise the latest generation is
 * still live, and Apple's RESUBSCRIBE on an already-live subscription (or a
 * duplicate purchase signal) is a recorded no-op: the existing generation
 * is returned untouched, never re-created.
 */
export function applyPurchase(
  latestGeneration: SubscriptionAggregateWithContext | null,
  event: PurchaseEvent,
  timed: { effectiveAt: Date; periodEnd?: Date; productId: string },
): PurchaseResult {
  const isTerminal =
    latestGeneration !== null &&
    (latestGeneration.state === 'expired' || latestGeneration.state === 'refunded');

  if (latestGeneration === null || isTerminal) {
    return {
      aggregate: createGeneration(event, timed),
      isNewGeneration: true,
      disposition: 'generation_created',
    };
  }

  return {
    aggregate: latestGeneration,
    isNewGeneration: false,
    disposition: 'no_op_live',
  };
}

export function applyEvent(
  aggregate: SubscriptionAggregateWithContext,
  timed: TimedSubscriptionEvent,
): ApplyEventResult {
  const { event, effectiveAt, periodEnd } = timed;

  const stale = aggregate.highWater !== null && effectiveAt < aggregate.highWater;
  if (stale) {
    // I5a: period context still merges monotonically for a stale-but-economic
    // event — an older event can never shrink a period, but its period fact
    // still counts if it's newer than what's on file. The ledger append this
    // event may carry is the caller's concern (outside this pure function);
    // here, only the state transition is suppressed. highWater itself is
    // untouched, since it already reflects a later effectiveAt than this one.
    return {
      aggregate: {
        ...aggregate,
        currentPeriodEnd: mergePeriodEnd(aggregate.currentPeriodEnd, periodEnd),
      },
      stateChanged: false,
      disposition: 'superseded',
    };
  }

  if (isContextEvent(event)) {
    // Deliberately 'applied', even on a terminal aggregate: I6 absorbs
    // state transitions specifically, and C25 already established that
    // non-state fields (currentPeriodEnd, highWater) keep updating past a
    // terminal state — see the ok-branch below, which does the same for
    // period context on a no_op_terminal transition. A dead generation's
    // willRenew/productId affect nothing (a resubscribe is a new
    // generation), so recording the update as applied rather than
    // no_op_terminal is harmless and consistent with that established
    // reading, not a special case invented for context events.
    return {
      aggregate: {
        ...applyContextEvent(aggregate, event),
        currentPeriodEnd: mergePeriodEnd(aggregate.currentPeriodEnd, periodEnd),
        highWater: effectiveAt,
      },
      stateChanged: false,
      disposition: 'applied',
    };
  }

  const result = transition(aggregate, event);

  if (!result.ok) {
    // An off-graph event contributes no period context and doesn't advance
    // highWater — it represents no successfully-applied fact, economic or
    // otherwise, so nothing about it is trusted.
    return {
      aggregate,
      stateChanged: false,
      disposition: 'invalid',
      error: result.error,
    };
  }

  return {
    // Only `state` comes from `result.aggregate` — transition() never
    // touches willRenew or any other context field, so those default-carry
    // from `aggregate` unchanged. Spelled out (not `...result.aggregate`)
    // so a future transition() change that touches another field can't
    // silently ride along here uncovered by this line's own review.
    aggregate: {
      ...aggregate,
      state: result.aggregate.state,
      currentPeriodEnd: mergePeriodEnd(aggregate.currentPeriodEnd, periodEnd),
      highWater: effectiveAt,
    },
    stateChanged: !result.noop && result.aggregate.state !== aggregate.state,
    disposition: result.noop ? 'no_op_terminal' : 'applied',
  };
}
