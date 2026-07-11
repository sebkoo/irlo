import { describe, expect, it } from 'vitest';

import { serverEnvSchema } from '../src/index.js';

describe('serverEnvSchema (canary)', () => {
  it('applies defaults when runtime vars are absent', () => {
    const parsed = serverEnvSchema.parse({});

    expect(parsed).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'debug',
    });
  });

  it('coerces PORT from a string to a number', () => {
    const parsed = serverEnvSchema.parse({ PORT: '4000' });

    expect(parsed.PORT).toBe(4000);
  });

  it('rejects an invalid NODE_ENV', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'staging' });

    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric PORT', () => {
    const result = serverEnvSchema.safeParse({ PORT: 'not-a-port' });

    expect(result.success).toBe(false);
  });
});
