import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface Db {
  db: NodePgDatabase;
  pool: Pool;
}

/** Builds a Drizzle client over a lazily-connecting pg Pool — no I/O at call time. */
export function createDb(connectionString: string): Db {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  return { db, pool };
}
