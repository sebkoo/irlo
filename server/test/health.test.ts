import { healthStatusSchema } from '@irlo/contracts';
import { describe, expect, it } from 'vitest';

import { healthStatus } from '../src/health.js';

describe('healthStatus (canary)', () => {
  it('reports ok and satisfies the shared contract', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = healthStatus(now);

    expect(healthStatusSchema.parse(result)).toEqual({
      status: 'ok',
      service: 'irlo-server',
      timestamp: '2026-07-10T12:00:00.000Z',
    });
  });
});
