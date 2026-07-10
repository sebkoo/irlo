import { describe, expect, it } from 'vitest';

import { healthStatusSchema } from '../src/index.js';

describe('healthStatusSchema (canary)', () => {
  it('accepts a well-formed health payload', () => {
    const parsed = healthStatusSchema.parse({
      status: 'ok',
      service: 'irlo-server',
      timestamp: '2026-07-10T12:00:00.000Z',
    });

    expect(parsed.status).toBe('ok');
  });

  it('rejects a malformed timestamp', () => {
    const result = healthStatusSchema.safeParse({
      status: 'ok',
      service: 'irlo-server',
      timestamp: 'not-a-date',
    });

    expect(result.success).toBe(false);
  });
});
