import { describe, expect, it } from 'vitest';

import { createDb } from '../src/db/client.js';

const DEV_URL = 'postgres://irlo:irlo@localhost:5432/irlo_dev';

describe('createDb (Drizzle client factory, C20)', () => {
  it('returns a drizzle database bound to a pg pool for the given URL', () => {
    const { db, pool } = createDb(DEV_URL);

    expect(typeof db.execute).toBe('function');
    expect(pool.options.connectionString).toBe(DEV_URL);
  });

  it('closes its pool cleanly without ever connecting', async () => {
    const { pool } = createDb(DEV_URL);

    await expect(pool.end()).resolves.toBeUndefined();
  });
});
