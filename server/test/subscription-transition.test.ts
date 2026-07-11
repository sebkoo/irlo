import { describe, expect, it } from 'vitest';

import { transition } from '../src/domain/subscription-transition.js';

describe('subscription transition function (ADR-0009 §3b, C24)', () => {
  describe('trial', () => {
    it('trial --renewed--> active (conversion)', () => {
      const result = transition({ state: 'trial', willRenew: true }, { type: 'renewed' });

      expect(result).toEqual({ ok: true, aggregate: { state: 'active', willRenew: true } });
    });

    it('trial --period_expired--> expired', () => {
      const result = transition(
        { state: 'trial', willRenew: true },
        { type: 'period_expired', retriesExhausted: false },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'expired', willRenew: true } });
    });

    it('rejects an off-graph event with a typed invalid-transition error', () => {
      const result = transition({ state: 'trial', willRenew: true }, { type: 'grace_exhausted' });

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'trial', eventType: 'grace_exhausted' },
      });
    });
  });

  describe('active', () => {
    it('active --renewed--> active (new period, self-loop)', () => {
      const result = transition({ state: 'active', willRenew: true }, { type: 'renewed' });

      expect(result).toEqual({ ok: true, aggregate: { state: 'active', willRenew: true } });
    });

    it('active --renewal_failed[graceOffered]--> grace', () => {
      const result = transition(
        { state: 'active', willRenew: true },
        { type: 'renewal_failed', graceOffered: true },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'grace', willRenew: true } });
    });

    it('active --renewal_failed[no grace]--> billing_retry', () => {
      const result = transition(
        { state: 'active', willRenew: true },
        { type: 'renewal_failed', graceOffered: false },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'billing_retry', willRenew: true } });
    });

    it('active --period_expired[willRenew=false]--> expired (voluntary cancel)', () => {
      const result = transition(
        { state: 'active', willRenew: false },
        { type: 'period_expired', retriesExhausted: false },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'expired', willRenew: false } });
    });

    it('rejects period_expired while willRenew=true — not a modeled edge', () => {
      const result = transition(
        { state: 'active', willRenew: true },
        { type: 'period_expired', retriesExhausted: false },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'active', eventType: 'period_expired' },
      });
    });
  });

  describe('grace', () => {
    it('grace --renewed--> active (recovery)', () => {
      const result = transition({ state: 'grace', willRenew: true }, { type: 'renewed' });

      expect(result).toEqual({ ok: true, aggregate: { state: 'active', willRenew: true } });
    });

    it('grace --grace_exhausted--> billing_retry', () => {
      const result = transition({ state: 'grace', willRenew: true }, { type: 'grace_exhausted' });

      expect(result).toEqual({ ok: true, aggregate: { state: 'billing_retry', willRenew: true } });
    });

    it('rejects an off-graph event', () => {
      const result = transition(
        { state: 'grace', willRenew: true },
        { type: 'period_expired', retriesExhausted: true },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'grace', eventType: 'period_expired' },
      });
    });
  });

  describe('billing_retry', () => {
    it('billing_retry --renewed--> active (recovery)', () => {
      const result = transition({ state: 'billing_retry', willRenew: true }, { type: 'renewed' });

      expect(result).toEqual({ ok: true, aggregate: { state: 'active', willRenew: true } });
    });

    it('billing_retry --period_expired[retries exhausted]--> expired', () => {
      const result = transition(
        { state: 'billing_retry', willRenew: true },
        { type: 'period_expired', retriesExhausted: true },
      );

      expect(result).toEqual({ ok: true, aggregate: { state: 'expired', willRenew: true } });
    });

    it('rejects period_expired while retries are not exhausted — not a modeled edge', () => {
      const result = transition(
        { state: 'billing_retry', willRenew: true },
        { type: 'period_expired', retriesExhausted: false },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'billing_retry', eventType: 'period_expired' },
      });
    });

    it('rejects an off-graph event', () => {
      const result = transition(
        { state: 'billing_retry', willRenew: true },
        { type: 'grace_exhausted' },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_transition', state: 'billing_retry', eventType: 'grace_exhausted' },
      });
    });
  });

  describe('refund — reachable from every non-terminal state', () => {
    it.each(['trial', 'active', 'grace', 'billing_retry'] as const)(
      '%s --refunded--> refunded',
      (state) => {
        const result = transition({ state, willRenew: true }, { type: 'refunded' });

        expect(result).toEqual({ ok: true, aggregate: { state: 'refunded', willRenew: true } });
      },
    );
  });

  describe('terminal absorption (I6) — expired/refunded never transition out, no exceptions', () => {
    it.each(['expired', 'refunded'] as const)(
      '%s absorbs a renewed event as a recorded no-op',
      (state) => {
        const result = transition({ state, willRenew: true }, { type: 'renewed' });

        expect(result).toEqual({ ok: true, aggregate: { state, willRenew: true }, noop: true });
      },
    );

    it.each(['expired', 'refunded'] as const)(
      '%s absorbs a refunded event too — even the refund event itself does not reopen it',
      (state) => {
        const result = transition({ state, willRenew: true }, { type: 'refunded' });

        expect(result).toEqual({ ok: true, aggregate: { state, willRenew: true }, noop: true });
      },
    );
  });
});
