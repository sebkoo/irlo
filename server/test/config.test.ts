import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { serverEnvSchema } from '@irlo/contracts';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

function parseDotenvSection(path: string, sectionHeader: string): Record<string, string> {
  const lines = readFileSync(path, 'utf-8').split('\n');
  const vars: Record<string, string> = {};
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('# ---')) {
      inSection = trimmed === sectionHeader;
      continue;
    }
    if (!inSection || trimmed === '' || trimmed.startsWith('#')) continue;

    const [key, ...rest] = trimmed.split('=');
    if (key) vars[key] = rest.join('=');
  }

  return vars;
}

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
