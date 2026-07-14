import { fileURLToPath } from 'node:url';

import { serverEnvSchema } from '@irlo/contracts';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { parseDotenvSection } from './support/dotenv.js';

describe('loadConfig (canary)', () => {
  it('parses process.env into a typed ServerEnv', () => {
    const config = loadConfig({ NODE_ENV: 'production', PORT: '8080', LOG_LEVEL: 'warn' });

    expect(config).toEqual({ NODE_ENV: 'production', PORT: 8080, LOG_LEVEL: 'warn' });
  });

  it('throws when a runtime var is malformed', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});

describe('.env.example contract sync', () => {
  const examplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
  const runtime = () => parseDotenvSection(examplePath, '# --- Runtime ---');
  const datastores = () =>
    parseDotenvSection(examplePath, '# --- Datastores (docker-compose dev env, C19) ---');

  it('schema declares exactly the Runtime keys plus DATABASE_URL (C20) and STRIPE_WEBHOOK_SECRET (ADR-0009 §3h)', () => {
    // REDIS_URL and STRIPE_SECRET_KEY stay schema-less until their first
    // consumer lands (queues/presence; a live Stripe API call respectively).
    const expected = [...Object.keys(runtime()), 'DATABASE_URL', 'STRIPE_WEBHOOK_SECRET'].sort();

    expect(Object.keys(serverEnvSchema.shape).sort()).toEqual(expected);
  });

  it('Runtime plus Datastores DATABASE_URL parses against serverEnvSchema', () => {
    const result = serverEnvSchema.safeParse({
      ...runtime(),
      DATABASE_URL: datastores()['DATABASE_URL'],
    });

    expect(result.success).toBe(true);
  });
});
