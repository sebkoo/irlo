import { describe, expect, it } from 'vitest';

import { extractSubscriptionIdFromInvoice } from '../../../src/payments/stripe/extract-subscription-id.js';

describe('extractSubscriptionIdFromInvoice (ADR-0009 §3h route wiring — routing-key extraction)', () => {
  it('resolves a bare subscription id string (the common webhook shape)', () => {
    const result = extractSubscriptionIdFromInvoice({
      parent: {
        subscription_details: { subscription: 'sub_123' },
      },
    });

    expect(result).toEqual({ ok: true, providerSubscriptionId: 'sub_123' });
  });

  it('resolves an expanded Subscription object via its id', () => {
    const result = extractSubscriptionIdFromInvoice({
      parent: {
        subscription_details: { subscription: { id: 'sub_456' } },
      },
    });

    expect(result).toEqual({ ok: true, providerSubscriptionId: 'sub_456' });
  });

  it('reports unresolvable, not a throw, when parent is null (a non-subscription invoice)', () => {
    const result = extractSubscriptionIdFromInvoice({ parent: null });

    expect(result).toEqual({ ok: false });
  });

  it('reports unresolvable when subscription_details is null (a non-subscription invoice)', () => {
    const result = extractSubscriptionIdFromInvoice({
      parent: { subscription_details: null },
    });

    expect(result).toEqual({ ok: false });
  });
});
