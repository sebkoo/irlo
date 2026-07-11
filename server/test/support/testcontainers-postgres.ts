import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, type Db } from '../../src/db/client.js';

// Testcontainers spins up a real postgres:17-alpine container per run — first
// invocation on a machine pulls the image (network + disk activity is
// expected). Matches docker-compose.yml's pinned tag.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface TestDb extends Db {
  container: StartedPostgreSqlContainer;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const { db, pool } = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return { db, pool, container };
}

export async function stopTestDb(testDb: TestDb): Promise<void> {
  await testDb.pool.end();
  await testDb.container.stop();
}
