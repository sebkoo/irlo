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

describe('serverEnvSchema DATABASE_URL (C20)', () => {
  it('accepts a postgres:// connection URL', () => {
    const parsed = serverEnvSchema.parse({
      DATABASE_URL: 'postgres://irlo:irlo@localhost:5432/irlo_dev',
    });

    expect(parsed.DATABASE_URL).toBe('postgres://irlo:irlo@localhost:5432/irlo_dev');
  });

  it('accepts the postgresql:// protocol alias', () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: 'postgresql://irlo:irlo@localhost:5432/irlo_dev',
    });

    expect(result.success).toBe(true);
  });

  it('stays optional until the pool is boot-wired (Stage 2 flips it to required)', () => {
    const parsed = serverEnvSchema.parse({});

    expect(parsed.DATABASE_URL).toBeUndefined();
  });

  it('rejects a non-postgres protocol', () => {
    const result = serverEnvSchema.safeParse({ DATABASE_URL: 'http://localhost:5432/irlo_dev' });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed URL', () => {
    const result = serverEnvSchema.safeParse({ DATABASE_URL: 'not-a-url' });

    expect(result.success).toBe(false);
  });
});

describe('serverEnvSchema STRIPE_WEBHOOK_SECRET (ADR-0009 §3h)', () => {
  it('accepts a webhook signing secret', () => {
    const parsed = serverEnvSchema.parse({ STRIPE_WEBHOOK_SECRET: 'whsec_test123' });

    expect(parsed.STRIPE_WEBHOOK_SECRET).toBe('whsec_test123');
  });

  it('stays optional until the Stripe route is boot-wired', () => {
    const parsed = serverEnvSchema.parse({});

    expect(parsed.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });
});
