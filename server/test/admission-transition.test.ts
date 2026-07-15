import { describe, expect, it } from 'vitest';

import { applySubmission, transition } from '../src/domain/admission-transition.js';

const COOLDOWN = new Date('2026-08-01T00:00:00Z');

describe('admission transition function (ADR-0009 §3c, C30)', () => {
  describe('draft', () => {
    it('draft --withdraw--> withdrawn', () => {
      const result = transition(
        { state: 'draft', cooldownUntil: null },
        { type: 'withdraw', actor: 'member:m1' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'withdrawn', cooldownUntil: null } });
    });

    it('rejects an off-graph event with a typed invalid-transition error', () => {
      const result = transition({ state: 'draft', cooldownUntil: null }, { type: 'auto_triage' });

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'draft', eventType: 'auto_triage' },
      });
    });
  });

  describe('submitted', () => {
    it('submitted --auto_triage--> waitlisted', () => {
      const result = transition(
        { state: 'submitted', cooldownUntil: null },
        { type: 'auto_triage' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'waitlisted', cooldownUntil: null } });
    });

    it('submitted --review_open--> under_review', () => {
      const result = transition(
        { state: 'submitted', cooldownUntil: null },
        { type: 'review_open' },
      );

      expect(result).toEqual({
        ok: true,
        aggregate: { state: 'under_review', cooldownUntil: null },
      });
    });

    it('submitted --withdraw--> withdrawn', () => {
      const result = transition(
        { state: 'submitted', cooldownUntil: null },
        { type: 'withdraw', actor: 'member:m1' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'withdrawn', cooldownUntil: null } });
    });

    it('rejects an off-graph event', () => {
      const result = transition(
        { state: 'submitted', cooldownUntil: null },
        { type: 'queue_advanced' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'submitted', eventType: 'queue_advanced' },
      });
    });
  });

  describe('under_review', () => {
    it('under_review --decision(accept)--> accepted', () => {
      const result = transition(
        { state: 'under_review', cooldownUntil: null },
        { type: 'decision', outcome: 'accept', actor: 'reviewer:r1', reasonCode: 'fit' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'accepted', cooldownUntil: null } });
    });

    it('under_review --decision(reject)--> rejected, sets cooldownUntil', () => {
      const result = transition(
        { state: 'under_review', cooldownUntil: null },
        {
          type: 'decision',
          outcome: 'reject',
          actor: 'reviewer:r1',
          reasonCode: 'not_a_fit',
          cooldownUntil: COOLDOWN,
        },
      );

      expect(result).toEqual({
        ok: true,
        aggregate: { state: 'rejected', cooldownUntil: COOLDOWN },
      });
    });

    it('under_review --decision(defer)--> waitlisted', () => {
      const result = transition(
        { state: 'under_review', cooldownUntil: null },
        { type: 'decision', outcome: 'defer', actor: 'reviewer:r1', reasonCode: 'more_signal' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'waitlisted', cooldownUntil: null } });
    });

    it('under_review --withdraw--> withdrawn', () => {
      const result = transition(
        { state: 'under_review', cooldownUntil: null },
        { type: 'withdraw', actor: 'member:m1' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'withdrawn', cooldownUntil: null } });
    });

    it('rejects an off-graph event', () => {
      const result = transition(
        { state: 'under_review', cooldownUntil: null },
        { type: 'auto_triage' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'under_review', eventType: 'auto_triage' },
      });
    });
  });

  describe('waitlisted', () => {
    it('waitlisted --queue_advanced--> under_review', () => {
      const result = transition(
        { state: 'waitlisted', cooldownUntil: null },
        { type: 'queue_advanced' },
      );

      expect(result).toEqual({
        ok: true,
        aggregate: { state: 'under_review', cooldownUntil: null },
      });
    });

    it('waitlisted --withdraw--> withdrawn', () => {
      const result = transition(
        { state: 'waitlisted', cooldownUntil: null },
        { type: 'withdraw', actor: 'member:m1' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'withdrawn', cooldownUntil: null } });
    });

    it('rejects an off-graph event', () => {
      const result = transition(
        { state: 'waitlisted', cooldownUntil: null },
        { type: 'onboarding_complete' },
      );

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'invalid_transition',
          state: 'waitlisted',
          eventType: 'onboarding_complete',
        },
      });
    });

    describe('double-approve race (ADR-0009 §3c) — waitlisted counts as an already-decided (defer) outcome', () => {
      it('a repeat decision(defer) is a recorded no-op', () => {
        const result = transition(
          { state: 'waitlisted', cooldownUntil: null },
          { type: 'decision', outcome: 'defer', actor: 'reviewer:r2', reasonCode: 'more_signal' },
        );

        expect(result).toEqual({
          ok: true,
          aggregate: { state: 'waitlisted', cooldownUntil: null },
          noop: true,
        });
      });

      it('a conflicting decision(accept) is a typed conflicting-decision error, never a second admission', () => {
        const result = transition(
          { state: 'waitlisted', cooldownUntil: null },
          { type: 'decision', outcome: 'accept', actor: 'reviewer:r2', reasonCode: 'fit' },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'conflicting_decision', state: 'waitlisted', outcome: 'accept' },
        });
      });

      it('a conflicting decision(reject) is a typed conflicting-decision error', () => {
        const result = transition(
          { state: 'waitlisted', cooldownUntil: null },
          {
            type: 'decision',
            outcome: 'reject',
            actor: 'reviewer:r2',
            reasonCode: 'not_a_fit',
            cooldownUntil: COOLDOWN,
          },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'conflicting_decision', state: 'waitlisted', outcome: 'reject' },
        });
      });
    });
  });

  describe('accepted', () => {
    it('accepted --onboarding_complete--> member', () => {
      const result = transition(
        { state: 'accepted', cooldownUntil: null },
        { type: 'onboarding_complete' },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'member', cooldownUntil: null } });
    });

    it('rejects an off-graph event (withdraw is not reachable from accepted)', () => {
      const result = transition(
        { state: 'accepted', cooldownUntil: null },
        { type: 'withdraw', actor: 'member:m1' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'accepted', eventType: 'withdraw' },
      });
    });

    describe('double-approve race — accepted is an already-decided (accept) outcome', () => {
      it('a repeat decision(accept) is a recorded no-op — never a second admission', () => {
        const result = transition(
          { state: 'accepted', cooldownUntil: null },
          { type: 'decision', outcome: 'accept', actor: 'reviewer:r2', reasonCode: 'fit' },
        );

        expect(result).toEqual({
          ok: true,
          aggregate: { state: 'accepted', cooldownUntil: null },
          noop: true,
        });
      });

      it('a conflicting decision(reject) is a typed conflicting-decision error', () => {
        const result = transition(
          { state: 'accepted', cooldownUntil: null },
          {
            type: 'decision',
            outcome: 'reject',
            actor: 'reviewer:r2',
            reasonCode: 'not_a_fit',
            cooldownUntil: COOLDOWN,
          },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'conflicting_decision', state: 'accepted', outcome: 'reject' },
        });
      });

      it('a conflicting decision(defer) is a typed conflicting-decision error', () => {
        const result = transition(
          { state: 'accepted', cooldownUntil: null },
          { type: 'decision', outcome: 'defer', actor: 'reviewer:r2', reasonCode: 'more_signal' },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'conflicting_decision', state: 'accepted', outcome: 'defer' },
        });
      });
    });
  });

  describe('rejected (terminal)', () => {
    it('rejects a non-decision event with a typed invalid-transition error', () => {
      const result = transition(
        { state: 'rejected', cooldownUntil: COOLDOWN },
        { type: 'onboarding_complete' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'rejected', eventType: 'onboarding_complete' },
      });
    });

    it('a repeat decision(reject) is a recorded no-op', () => {
      const result = transition(
        { state: 'rejected', cooldownUntil: COOLDOWN },
        {
          type: 'decision',
          outcome: 'reject',
          actor: 'reviewer:r2',
          reasonCode: 'not_a_fit',
          cooldownUntil: COOLDOWN,
        },
      );

      expect(result).toEqual({
        ok: true,
        aggregate: { state: 'rejected', cooldownUntil: COOLDOWN },
        noop: true,
      });
    });

    it('a conflicting decision(accept) is a typed conflicting-decision error', () => {
      const result = transition(
        { state: 'rejected', cooldownUntil: COOLDOWN },
        { type: 'decision', outcome: 'accept', actor: 'reviewer:r2', reasonCode: 'fit' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'conflicting_decision', state: 'rejected', outcome: 'accept' },
      });
    });

    it('a conflicting decision(defer) is a typed conflicting-decision error', () => {
      const result = transition(
        { state: 'rejected', cooldownUntil: COOLDOWN },
        { type: 'decision', outcome: 'defer', actor: 'reviewer:r2', reasonCode: 'more_signal' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'conflicting_decision', state: 'rejected', outcome: 'defer' },
      });
    });
  });

  describe('terminal absorption — member/withdrawn accept no valid outgoing event, decision or otherwise', () => {
    it.each(['member', 'withdrawn'] as const)(
      '%s rejects a decision event as invalid (not under_review, not an already-decided outcome)',
      (state) => {
        const result = transition(
          { state, cooldownUntil: null },
          { type: 'decision', outcome: 'accept', actor: 'reviewer:r1', reasonCode: 'fit' },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'invalid_transition', state, eventType: 'decision' },
        });
      },
    );

    it.each(['member', 'withdrawn'] as const)(
      '%s rejects a non-decision event as invalid',
      (state) => {
        const result = transition(
          { state, cooldownUntil: null },
          { type: 'withdraw', actor: 'member:m1' },
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'invalid_transition', state, eventType: 'withdraw' },
        });
      },
    );
  });
});

describe('applySubmission (ADR-0009 §3c, C31 — generation-spawning entry, mirrors applyPurchase)', () => {
  it('a first-ever submission with no prior generation creates generation 1 at submitted', () => {
    const result = applySubmission(null, { crewOpen: true, cooldownElapsed: true });

    expect(result).toEqual({
      ok: true,
      aggregate: { state: 'submitted', cooldownUntil: null },
      isNewGeneration: true,
    });
  });

  it('a closed crew blocks submission even with no prior generation', () => {
    const result = applySubmission(null, { crewOpen: false, cooldownElapsed: true });

    expect(result).toEqual({ ok: false, error: { code: 'crew_not_open' } });
  });

  it('crew_not_open is checked before already_applied — a closed crew blocks even a colliding live generation', () => {
    const result = applySubmission(
      { state: 'under_review', cooldownUntil: null },
      { crewOpen: false, cooldownElapsed: true },
    );

    expect(result).toEqual({ ok: false, error: { code: 'crew_not_open' } });
  });

  describe('a live (non-terminal) generation already exists — double-admission attempt', () => {
    it.each(['draft', 'submitted', 'under_review', 'waitlisted', 'accepted'] as const)(
      'blocks submission with a typed already_applied error while the latest generation is %s',
      (state) => {
        const result = applySubmission(
          { state, cooldownUntil: null },
          { crewOpen: true, cooldownElapsed: true },
        );

        expect(result).toEqual({ ok: false, error: { code: 'already_applied' } });
      },
    );
  });

  describe('reapply after a terminal generation (I6-style absorption; ADR-0009 §3b refinement 8)', () => {
    it.each(['member', 'rejected', 'withdrawn'] as const)(
      'spawns a fresh generation at submitted once cooldown has elapsed, from a terminal %s generation',
      (state) => {
        const result = applySubmission(
          { state, cooldownUntil: null },
          { crewOpen: true, cooldownElapsed: true },
        );

        expect(result).toEqual({
          ok: true,
          aggregate: { state: 'submitted', cooldownUntil: null },
          isNewGeneration: true,
        });
      },
    );

    it.each(['member', 'rejected', 'withdrawn'] as const)(
      'blocks reapply with a typed cooldown_active error while cooldown has not elapsed, from a terminal %s generation',
      (state) => {
        const result = applySubmission(
          { state, cooldownUntil: COOLDOWN },
          { crewOpen: true, cooldownElapsed: false },
        );

        expect(result).toEqual({ ok: false, error: { code: 'cooldown_active' } });
      },
    );
  });
});
