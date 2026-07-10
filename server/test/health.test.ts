import { describe, expect, it } from 'vitest';

import { healthStatus } from '../src/health.js';

describe('healthStatus (canary)', () => {
  it('reports ok with the injected timestamp', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = healthStatus(now);

    expect(result).toEqual({
      status: 'ok',
      service: 'irlo-server',
      timestamp: '2026-07-10T12:00:00.000Z',
    });
  });
});
