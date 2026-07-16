import { describe, expect, it } from 'vitest';

import {
  waitlistSkipParamsSchema,
  waitlistSkipRequestSchema,
  waitlistSkipResponseSchema,
} from '../src/index.js';

describe('waitlistSkipParamsSchema (canary)', () => {
  it('accepts a well-formed applicationId', () => {
    const parsed = waitlistSkipParamsSchema.parse({
      applicationId: '4f6f1c9e-2b3a-4c8a-9d0e-1a2b3c4d5e6f',
    });

    expect(parsed.applicationId).toBe('4f6f1c9e-2b3a-4c8a-9d0e-1a2b3c4d5e6f');
  });

  it('rejects a non-uuid applicationId', () => {
    const result = waitlistSkipParamsSchema.safeParse({ applicationId: 'not-a-uuid' });

    expect(result.success).toBe(false);
  });
});

describe('waitlistSkipRequestSchema (canary)', () => {
  it('accepts a well-formed request', () => {
    const parsed = waitlistSkipRequestSchema.parse({
      idempotencyKey: '4f6f1c9e-2b3a-4c8a-9d0e-1a2b3c4d5e6f',
    });

    expect(parsed.idempotencyKey).toBe('4f6f1c9e-2b3a-4c8a-9d0e-1a2b3c4d5e6f');
  });

  it('rejects a non-uuid idempotencyKey', () => {
    const result = waitlistSkipRequestSchema.safeParse({ idempotencyKey: 'not-a-uuid' });

    expect(result.success).toBe(false);
  });
});

describe('waitlistSkipResponseSchema (canary)', () => {
  it.each([
    'applied',
    'not_found',
    'already_priority',
    'not_waitlisted',
    'insufficient_credits',
  ] as const)('accepts outcome %s', (outcome) => {
    expect(waitlistSkipResponseSchema.parse({ outcome }).outcome).toBe(outcome);
  });

  it('rejects an outcome outside the catalog', () => {
    const result = waitlistSkipResponseSchema.safeParse({ outcome: 'made_up_outcome' });

    expect(result.success).toBe(false);
  });
});
