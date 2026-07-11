import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  type SubscriptionAggregateWithContext,
} from '../../src/domain/subscription-transition.js';

const T1 = new Date('2026-01-01T00:00:00Z');
const T2 = new Date('2026-01-15T00:00:00Z');
const T3 = new Date('2026-02-01T00:00:00Z');

describe('I5a — stale-but-economic events (ADR-0009 §3f)', () => {
  it('a stale renewal still merges its period context and reports superseded, but does not change state', () => {
    // highWater already at T3 (raised by a later context event); a renewal
    // effective at T2 < T3 arrives late.
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'grace',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T3,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewed' },
      effectiveAt: T2,
      periodEnd: T2,
    });

    // State transition suppressed — grace→active never happens for this
    // stale event, even though 'renewed' would normally cause it.
    expect(result.aggregate.state).toBe('grace');
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('superseded');
    // Period context still merges monotonically — never regresses, and a
    // stale event's period end still counts if it's newer than what's on
    // file (T2 > T1 here).
    expect(result.aggregate.currentPeriodEnd).toEqual(T2);
    // highWater itself is untouched by a stale event — it only tracks the
    // latest effectiveAt actually applied.
    expect(result.aggregate.highWater).toEqual(T3);
  });

  it('period context merges monotonically — a stale event never regresses an already-later period end', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T3,
      highWater: T3,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewed' },
      effectiveAt: T2,
      periodEnd: T1,
    });

    expect(result.aggregate.currentPeriodEnd).toEqual(T3);
    expect(result.disposition).toBe('superseded');
  });

  it('a non-stale event applies normally and advances highWater to its effectiveAt', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'grace',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewed' },
      effectiveAt: T2,
      periodEnd: T2,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.stateChanged).toBe(true);
    expect(result.disposition).toBe('applied');
    expect(result.aggregate.currentPeriodEnd).toEqual(T2);
    expect(result.aggregate.highWater).toEqual(T2);
  });

  it('a non-stale self-loop (active --renewed--> active) reports stateChanged: false, still applied', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'active',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewed' },
      effectiveAt: T2,
      periodEnd: T2,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('applied');
    expect(result.aggregate.currentPeriodEnd).toEqual(T2);
    expect(result.aggregate.highWater).toEqual(T2);
  });

  it('the first event ever applied (highWater null) is never considered stale', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'trial',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: null,
      highWater: null,
    };

    const result = applyEvent(aggregate, {
      event: { type: 'renewed' },
      effectiveAt: T1,
      periodEnd: T1,
    });

    expect(result.aggregate.state).toBe('active');
    expect(result.disposition).toBe('applied');
    expect(result.aggregate.highWater).toEqual(T1);
  });

  it('a non-stale terminal-absorbed event is reported no_op_terminal, not applied', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'expired',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    const result = applyEvent(aggregate, { event: { type: 'renewed' }, effectiveAt: T2 });

    expect(result.aggregate.state).toBe('expired');
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('no_op_terminal');
    expect(result.aggregate.highWater).toEqual(T2);
  });

  it('an invalid (off-graph) event reports its typed error and leaves state, period context, and highWater untouched', () => {
    const aggregate: SubscriptionAggregateWithContext = {
      state: 'trial',
      willRenew: true,
      productId: 'irlo.plus.monthly',
      currentPeriodEnd: T1,
      highWater: T1,
    };

    // periodEnd included deliberately: an off-graph event must not
    // contribute period context either, even though it carries one.
    const result = applyEvent(aggregate, {
      event: { type: 'grace_exhausted' },
      effectiveAt: T2,
      periodEnd: T3,
    });

    expect(result.aggregate.state).toBe('trial');
    expect(result.stateChanged).toBe(false);
    expect(result.disposition).toBe('invalid');
    expect(result.aggregate.currentPeriodEnd).toEqual(T1);
    expect(result.error).toEqual({
      code: 'invalid_transition',
      state: 'trial',
      eventType: 'grace_exhausted',
    });
    expect(result.aggregate.highWater).toEqual(T1);
  });
});
