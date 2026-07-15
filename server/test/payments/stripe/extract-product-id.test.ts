import { describe, expect, it } from 'vitest';

import { extractProductIdFromInvoice } from '../../../src/payments/stripe/extract-product-id.js';

describe('extractProductIdFromInvoice (ADR-0011 slice C route wiring — new-generation productId)', () => {
  it('resolves a bare price id string on the first line item (the common webhook shape)', () => {
    const result = extractProductIdFromInvoice({
      lines: { data: [{ pricing: { price_details: { price: 'price_monthly' } } }] },
    });

    expect(result).toEqual({ ok: true, productId: 'price_monthly' });
  });

  it('resolves an expanded Price object via its id', () => {
    const result = extractProductIdFromInvoice({
      lines: { data: [{ pricing: { price_details: { price: { id: 'price_yearly' } } } }] },
    });

    expect(result).toEqual({ ok: true, productId: 'price_yearly' });
  });

  it('reports unresolvable, not a throw, when there are no line items', () => {
    const result = extractProductIdFromInvoice({ lines: { data: [] } });

    expect(result).toEqual({ ok: false });
  });

  it('reports unresolvable when the first line item has no pricing', () => {
    const result = extractProductIdFromInvoice({ lines: { data: [{ pricing: null }] } });

    expect(result).toEqual({ ok: false });
  });

  it('reports unresolvable when pricing has no price_details', () => {
    const result = extractProductIdFromInvoice({
      lines: { data: [{ pricing: {} }] },
    });

    expect(result).toEqual({ ok: false });
  });
});
