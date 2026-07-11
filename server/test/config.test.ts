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

describe('.env.example Runtime section (contract sync)', () => {
  it('pins exactly the keys serverEnvSchema declares', () => {
    const examplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
    const vars = parseDotenvSection(examplePath, '# --- Runtime ---');

    expect(Object.keys(vars).sort()).toEqual(Object.keys(serverEnvSchema.shape).sort());
  });

  it('parses against serverEnvSchema', () => {
    const examplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
    const vars = parseDotenvSection(examplePath, '# --- Runtime ---');

    const result = serverEnvSchema.safeParse(vars);

    expect(result.success).toBe(true);
  });
});
