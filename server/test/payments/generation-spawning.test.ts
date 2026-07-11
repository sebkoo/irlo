import { describe, expect, it } from 'vitest';

import { applyPurchase } from '../../src/domain/subscription-transition.js';

const T1 = new Date('2026-01-01T00:00:00Z');
const T2 = new Date('2026-01-15T00:00:00Z');

describe('generation-spawning on purchase/resubscribe (ADR-0009 §3b — [*] entry transitions)', () => {
  it('a first-ever purchase with no offer creates generation 1 at active', () => {
    const result = applyPurchase(
      null,
      { type: 'purchased', offerPresent: false },
      {
        effectiveAt: T1,
        periodEnd: T2,
        productId: 'irlo.plus.monthly',
      },
    );

    expect(result.isNewGeneration).toBe(true);
    expect(result.disposition).toBe('generation_created');
    expect(result.aggregate).toEqual({
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T2,
      highWater: T1,
    });
  });

  it('a first-ever purchase with an offer present creates generation 1 at trial', () => {
    const result = applyPurchase(
      null,
      { type: 'purchased', offerPresent: true },
      {
        effectiveAt: T1,
        productId: 'irlo.plus.monthly',
      },
    );

    expect(result.isNewGeneration).toBe(true);
    expect(result.aggregate.state).toBe('trial');
    expect(result.aggregate.currentPeriodEnd).toBeNull();
  });

  it('RESUBSCRIBE on a live generation is a recorded no-op — the existing generation is untouched', () => {
    const live = {
      state: 'active' as const,
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyPurchase(
      live,
      { type: 'purchased', offerPresent: false },
      {
        effectiveAt: T2,
        productId: 'irlo.plus.monthly',
      },
    );

    expect(result.isNewGeneration).toBe(false);
    expect(result.disposition).toBe('no_op_live');
    expect(result.aggregate).toBe(live);
  });

  it.each(['expired', 'refunded'] as const)(
    'RESUBSCRIBE on a %s (terminal) generation spawns a fresh generation at [*], not a resurrection',
    (terminalState) => {
      const terminal = {
        state: terminalState,
        willRenew: false,
        productId: 'irlo.plus.monthly',
        currentPeriodEnd: T1,
        highWater: T1,
      };

      const result = applyPurchase(
        terminal,
        { type: 'purchased', offerPresent: false },
        {
          effectiveAt: T2,
          periodEnd: T2,
          productId: 'irlo.plus.yearly',
        },
      );

      expect(result.isNewGeneration).toBe(true);
      expect(result.disposition).toBe('generation_created');
      // A fresh generation, not a mutation of the terminal one — the new
      // aggregate carries its own productId/period/highWater, none of it
      // inherited from the dead generation (I6: expired/refunded never
      // resurrect; continuation is always a new generation).
      expect(result.aggregate).toEqual({
        state: 'active',
        willRenew: true,
        productId: 'irlo.plus.yearly',
        currentPeriodEnd: T2,
        highWater: T2,
      });
    },
  );

  it('RESUBSCRIBE on a terminal generation with an offer present spawns the new generation at trial', () => {
    const terminal = {
      state: 'expired' as const,
      willRenew: false,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyPurchase(
      terminal,
      { type: 'purchased', offerPresent: true },
      {
        effectiveAt: T2,
        productId: 'irlo.plus.monthly',
      },
    );

    expect(result.isNewGeneration).toBe(true);
    expect(result.aggregate.state).toBe('trial');
  });
});
