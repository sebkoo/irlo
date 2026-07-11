import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  type SubscriptionAggregateWithContext,
} from '../../src/domain/subscription-transition.js';

const T1 = new Date('2026-01-01T00:00:00Z');
const T2 = new Date('2026-01-15T00:00:00Z');
const T3 = new Date('2026-02-01T00:00:00Z');

describe('context-only events (ADR-0009 §3b) — autorenew_set, plan_changed, renewal_extended', () => {
  it('autorenew_set flips willRenew without changing state', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'autorenew_set', willRenew: false },
      effectiveAt: T2,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.aggregate.willRenew).toBe(false);
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('applied');
    expect(result.aggregate.highWater).toEqual(T2);
  });

  it('plan_changed updates productId without changing state', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'plan_changed', productId: 'irlo.plus.yearly' },
      effectiveAt: T2,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.aggregate.productId).toBe('irlo.plus.yearly');
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('applied');
  });

  it('renewal_extended merges the carried periodEnd without changing state', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewal_extended' },
      effectiveAt: T2,
      periodEnd: T3,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.aggregate.currentPeriodEnd).toEqual(T3);
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('applied');
  });

  it('a stale context event is superseded — its field update is suppressed, only periodEnd still merges', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T3,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'autorenew_set', willRenew: false },
      effectiveAt: T2,
      periodEnd: T2,
    });

    expect(result.aggregate.willRenew).toBe(true);
    expect(result.disposition).toBe('superseded');
    expect(result.aggregate.currentPeriodEnd).toEqual(T2);
    expect(result.aggregate.highWater).toEqual(T3);
  });

  it('a context event on a terminal-state aggregate still applies — I6 governs state transitions, not context', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'expired',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'autorenew_set', willRenew: false },
      effectiveAt: T2,
    });

    expect(result.aggregate.state).toBe('expired');
    expect(result.aggregate.willRenew).toBe(false);
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('applied');
  });
});
