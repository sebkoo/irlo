/**
 * ADR-0009 §3c — the admission state machine's pure core. A pure function
 * of (aggregate, event) → next aggregate | typed error, mirroring
 * subscription-transition.ts's split: this file's transition() is the
 * per-generation core (C30); applySubmission (C31) is the entry/
 * generation-spawning function, kept deliberately outside AdmissionEvent
 * for the same reason PurchaseEvent sits outside SubscriptionEvent there —
 * every other event transitions an *existing* aggregate; a submission
 * decides whether one exists to transition at all. No I/O: the executor
 * (C32–C33) wraps this with persistence and the admission_events audit log.
 */

export type AdmissionState =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'waitlisted'
  | 'accepted'
  | 'member'
  | 'rejected'
  | 'withdrawn';

export type AdmissionLane = 'standard' | 'priority';

export interface AdmissionAggregate {
  state: AdmissionState;
  /** Set by decision(reject); read by applySubmission's reapply guard. Null for every other state. */
  cooldownUntil: Date | null;
  /**
   * ADR-0009 §3c: meaningful only in the `waitlisted` context ("lane ∈
   * {standard, priority}"); null everywhere else, same nullable-outside-its-
   * context shape as `cooldownUntil`. `auto_triage`/`decision(defer)`
   * default a null lane to 'standard' on first entry into `waitlisted`, but
   * preserve an existing non-null lane on re-entry — §3c's "one jump per
   * application" (skip_consumed's guard) reads as a per-generation fact, not
   * a per-visit-to-waitlisted one, so a promotion earned before a defer
   * sends the application back to under_review must survive the round trip.
   */
  lane: AdmissionLane | null;
}

export type DecisionOutcome = 'accept' | 'reject' | 'defer';

/**
 * I9: every decision/audit event carries actor + reason code — spelled out
 * as required fields (not a runtime guard) so a caller physically cannot
 * construct a DecisionEvent without them; TypeScript enforces the ADR
 * invariant at the call site instead of this function having to check it.
 * `review_open`'s "actor holds can(review))" guard and `withdraw`'s "actor =
 * applicant" guard are deliberately NOT checked here — both are
 * authorization concerns (C28–C29's capability middleware, and auth of any
 * shape generally) that must hold *before* this pure function is ever
 * called, the same way JWS/webhook-signature verification precedes the
 * subscription reducer (I12's verify-then-queue) rather than living inside
 * it. `auto_triage`'s queue-depth guard and `queue_advanced`'s
 * slot-opened/head-of-queue guards are the same shape: they decide *whether*
 * the executor fires the event at all, not *how* the event resolves once
 * fired, so both are unconditionally valid here once dispatched.
 */
export type AdmissionEvent =
  | { type: 'auto_triage' }
  | { type: 'review_open' }
  | { type: 'queue_advanced' }
  | { type: 'decision'; outcome: 'accept'; actor: string; reasonCode: string }
  | { type: 'decision'; outcome: 'reject'; actor: string; reasonCode: string; cooldownUntil: Date }
  | { type: 'decision'; outcome: 'defer'; actor: string; reasonCode: string }
  | { type: 'skip_consumed' }
  | { type: 'onboarding_complete' }
  | { type: 'withdraw'; actor: string };

export interface InvalidTransitionError {
  code: 'invalid_transition';
  state: AdmissionState;
  eventType: AdmissionEvent['type'];
}

/**
 * `skip_consumed`'s "lane = standard (one jump per application)" guard
 * (ADR-0009 §3c) failing because the application is already in the
 * priority lane. I11 ("skip consumption is atomic with the lane move —
 * both or neither") means the caller (C35's executor) must not debit the
 * ledger when this fires — the credit stays available for a different
 * application.
 */
export interface AlreadyPriorityError {
  code: 'already_priority';
}

/**
 * `skip_consumed` fired against an application whose lane context doesn't
 * exist at all — lane is only meaningful in the `waitlisted` state (§3c:165).
 * Distinct from `already_priority` (which is specifically "already jumped")
 * and from the generic `invalid_transition` (which would misreport this as
 * an off-graph event rather than a context-eligibility failure) — named
 * honestly so the caller can't confuse a submitted/under_review application
 * with one that already used its jump.
 */
export interface NotWaitlistedError {
  code: 'not_waitlisted';
  state: AdmissionState;
}

/**
 * The double-approve race (ADR-0009 §3c): "a repeat identical decision is a
 * recorded no-op; a conflicting decision on an already-decided application
 * is a typed domain error. Never a second admission." Distinct from
 * InvalidTransitionError (an off-graph event that was never valid from this
 * state) — this is specifically a decision landing on a state some *other*
 * decision already produced.
 */
export interface ConflictingDecisionError {
  code: 'conflicting_decision';
  state: AdmissionState;
  outcome: DecisionOutcome;
}

export type AdmissionTransitionError =
  InvalidTransitionError | ConflictingDecisionError | AlreadyPriorityError | NotWaitlistedError;

export type TransitionResult =
  | { ok: true; aggregate: AdmissionAggregate; noop?: true }
  | { ok: false; error: AdmissionTransitionError };

function ok(aggregate: AdmissionAggregate): TransitionResult {
  return { ok: true, aggregate };
}

function invalid(state: AdmissionState, eventType: AdmissionEvent['type']): TransitionResult {
  return { ok: false, error: { code: 'invalid_transition', state, eventType } };
}

const DECISION_TARGET: Record<DecisionOutcome, AdmissionState> = {
  accept: 'accepted',
  reject: 'rejected',
  defer: 'waitlisted',
};

export function transition(aggregate: AdmissionAggregate, event: AdmissionEvent): TransitionResult {
  const { state } = aggregate;

  // §3c:165 — lane only exists in the waitlisted context; every other state
  // gets its own honest reason rather than the generic invalid_transition or
  // a misleading already_priority.
  if (event.type === 'skip_consumed' && state !== 'waitlisted') {
    return { ok: false, error: { code: 'not_waitlisted', state } };
  }

  if (event.type === 'decision') {
    const target = DECISION_TARGET[event.outcome];

    // accepted/rejected/waitlisted are the three decision *outcomes* —
    // whichever event actually produced them (waitlisted is also
    // auto_triage's target, but a repeat/conflicting decision lands the
    // same way regardless of path taken). A decision arriving here again
    // is either the same one recorded twice (no-op) or a genuinely
    // different one racing it (typed error) — never applied a second time.
    if (state === 'accepted' || state === 'rejected' || state === 'waitlisted') {
      if (state === target) return { ok: true, aggregate, noop: true };
      return { ok: false, error: { code: 'conflicting_decision', state, outcome: event.outcome } };
    }

    if (state !== 'under_review') return invalid(state, event.type);

    if (event.outcome === 'reject') {
      return ok({ ...aggregate, state: 'rejected', cooldownUntil: event.cooldownUntil });
    }
    if (event.outcome === 'defer') {
      return ok({ ...aggregate, state: target, lane: aggregate.lane ?? 'standard' });
    }
    return ok({ ...aggregate, state: target });
  }

  switch (state) {
    case 'draft':
      if (event.type === 'withdraw') return ok({ ...aggregate, state: 'withdrawn' });
      return invalid(state, event.type);

    case 'submitted':
      if (event.type === 'auto_triage') {
        return ok({ ...aggregate, state: 'waitlisted', lane: aggregate.lane ?? 'standard' });
      }
      if (event.type === 'review_open') return ok({ ...aggregate, state: 'under_review' });
      if (event.type === 'withdraw') return ok({ ...aggregate, state: 'withdrawn' });
      return invalid(state, event.type);

    case 'under_review':
      if (event.type === 'withdraw') return ok({ ...aggregate, state: 'withdrawn' });
      return invalid(state, event.type);

    case 'waitlisted':
      if (event.type === 'queue_advanced') return ok({ ...aggregate, state: 'under_review' });
      if (event.type === 'withdraw') return ok({ ...aggregate, state: 'withdrawn' });
      if (event.type === 'skip_consumed') {
        if (aggregate.lane === 'priority')
          return { ok: false, error: { code: 'already_priority' } };
        return ok({ ...aggregate, lane: 'priority' });
      }
      return invalid(state, event.type);

    case 'accepted':
      if (event.type === 'onboarding_complete') return ok({ ...aggregate, state: 'member' });
      return invalid(state, event.type);

    case 'member':
    case 'rejected':
    case 'withdrawn':
      return invalid(state, event.type);
  }
}

const ADMISSION_TERMINALS: readonly AdmissionState[] = ['member', 'rejected', 'withdrawn'];

/**
 * ADR-0009 §3c's `submit` guards, evaluated externally and passed in —
 * `crewOpen` (no crews table exists yet; Stage 6 wires the real capacity
 * check) and `cooldownElapsed` (computed by the caller against the wall
 * clock from the latest generation's `cooldownUntil`, mirroring
 * subscription-transition.ts's caller-supplied effectiveAt/highWater — this
 * pure function never touches the clock directly).
 */
export interface SubmissionGuards {
  crewOpen: boolean;
  cooldownElapsed: boolean;
}

export type SubmissionError =
  | { code: 'crew_not_open' }
  /** The "no live application for (member, crew)" guard — a double-admission attempt. */
  | { code: 'already_applied' }
  | { code: 'cooldown_active' };

export interface SubmissionResult {
  ok: true;
  aggregate: AdmissionAggregate;
  isNewGeneration: true;
}

export type ApplySubmissionResult = SubmissionResult | { ok: false; error: SubmissionError };

/**
 * ADR-0009 §3c's `submit` event / §3b refinement 8's reapply rule,
 * mirroring `applyPurchase`'s generation-spawn decision. Unlike a purchase
 * signal's benign at-least-once redelivery (`no_op_live`), a submit against
 * an already-live generation is a genuine user-initiated conflict, not a
 * provider replay — so it's a typed error here, never a silent no-op:
 * "double-admission attempt is a typed domain error."
 *
 * `latestGeneration === null` (never applied to this crew) and a terminal
 * `latestGeneration` (I6-style absorption: member/rejected/withdrawn never
 * resurrect) both spawn a fresh generation directly at `submitted` —
 * `draft` is bypassed the same way `applyPurchase` skips any pre-trial
 * state, since §3c's event table has no `[*] -> draft` event, only
 * `submit: draft -> submitted`.
 */
export function applySubmission(
  latestGeneration: AdmissionAggregate | null,
  guards: SubmissionGuards,
): ApplySubmissionResult {
  if (!guards.crewOpen) return { ok: false, error: { code: 'crew_not_open' } };

  const isTerminal =
    latestGeneration !== null && ADMISSION_TERMINALS.includes(latestGeneration.state);

  if (latestGeneration !== null && !isTerminal) {
    return { ok: false, error: { code: 'already_applied' } };
  }

  if (isTerminal && !guards.cooldownElapsed) {
    return { ok: false, error: { code: 'cooldown_active' } };
  }

  return {
    ok: true,
    aggregate: { state: 'submitted', cooldownUntil: null, lane: null },
    isNewGeneration: true,
  };
}
