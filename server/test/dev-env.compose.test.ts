import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseDotenvSection } from './support/dotenv.js';

const composePath = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));
const envExamplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
const DATASTORES_HEADER = '# --- Datastores (docker-compose dev env, C19) ---';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envExampleUrl(key: string): URL {
  const value = parseDotenvSection(envExamplePath, DATASTORES_HEADER)[key];
  if (!value) throw new Error(`${key} missing from .env.example Datastores section`);
  return new URL(value);
}

function composeService(name: string): Record<string, unknown> {
  const doc: unknown = parse(readFileSync(composePath, 'utf-8'));
  if (!isRecord(doc)) throw new Error('docker-compose.yml is not a mapping');
  const services = doc['services'];
  if (!isRecord(services)) throw new Error('docker-compose.yml has no services mapping');
  const service = services[name];
  if (!isRecord(service)) throw new Error(`service "${name}" missing`);
  return service;
}

function expectPinnedImage(service: Record<string, unknown>, repository: string): void {
  const image = service['image'];
  if (typeof image !== 'string') throw new Error(`${repository} image is not a string`);
  const [repo, tag] = image.split(':');
  expect(repo).toBe(repository);
  expect(tag).toBeTruthy();
  expect(tag).not.toBe('latest');
}

describe('docker-compose dev env (contract sync with .env.example, C19)', () => {
  it('defines a postgres service matching DATABASE_URL', () => {
    const url = envExampleUrl('DATABASE_URL');
    const postgres = composeService('postgres');
    const env = postgres['environment'];
    if (!isRecord(env)) throw new Error('postgres.environment missing');

    expect(env['POSTGRES_USER']).toBe(url.username);
    expect(env['POSTGRES_PASSWORD']).toBe(url.password);
    expect(env['POSTGRES_DB']).toBe(url.pathname.slice(1));
    expect(postgres['ports']).toContain(`${url.port}:5432`);
  });

  it('defines a redis service matching REDIS_URL', () => {
    const url = envExampleUrl('REDIS_URL');
    const redis = composeService('redis');

    expect(redis['ports']).toContain(`${url.port}:6379`);
  });

  it('pins both image tags (never latest) and declares healthchecks', () => {
    const postgres = composeService('postgres');
    const redis = composeService('redis');

    expectPinnedImage(postgres, 'postgres');
    expectPinnedImage(redis, 'redis');
    expect(postgres['healthcheck']).toBeDefined();
    expect(redis['healthcheck']).toBeDefined();
  });
});
