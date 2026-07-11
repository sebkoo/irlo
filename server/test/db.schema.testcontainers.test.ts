import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../src/db/client.js';
import {
  admissionEvents,
  applications,
  consumableBalances,
  ledgerEntries,
  members,
  paymentEvents,
  subscriptions,
} from '../src/db/schema/index.js';

// Testcontainers spins up a real postgres:17-alpine container per run — first
// invocation on a machine pulls the image (network + disk activity is
// expected). Matches docker-compose.yml's pinned tag.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

let container: StartedPostgreSqlContainer;
let dbHandle: Db;
let seedMemberId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  dbHandle = createDb(container.getConnectionUri());
  await migrate(dbHandle.db, { migrationsFolder: MIGRATIONS_FOLDER });

  const [seedMember] = await dbHandle.db.insert(members).values({}).returning({ id: members.id });
  seedMemberId = seedMember!.id;
}, 120_000);

afterAll(async () => {
  await dbHandle.pool.end();
  await container.stop();
});

interface ColumnRow {
  table_name: string;
  column_name: string;
}

describe('ADR-0009 schema + migrations (C21)', () => {
  it('creates all seven tables with the expected column shape', async () => {
    const result = await dbHandle.db.execute<ColumnRow>(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);

    const byTable = new Map<string, string[]>();
    for (const row of result.rows) {
      const list = byTable.get(row.table_name) ?? [];
      list.push(row.column_name);
      byTable.set(row.table_name, list);
    }

    expect(byTable.get('members')).toEqual(['id', 'created_at']);
    expect(byTable.get('payment_events')).toEqual([
      'id',
      'source',
      'event_id',
      'event_type',
      'payload',
      'effective_at',
      'inbox_seq',
      'disposition',
      'received_at',
    ]);
    expect(byTable.get('ledger_entries')).toEqual([
      'id',
      'member_id',
      'entry_type',
      'credit_type',
      'product_id',
      'quantity',
      'period_start',
      'period_end',
      'natural_key',
      'created_at',
    ]);
    expect(byTable.get('admission_events')).toEqual([
      'id',
      'application_id',
      'event',
      'actor',
      'reason_code',
      'created_at',
    ]);
    expect(byTable.get('subscriptions')).toEqual([
      'id',
      'member_id',
      'provider',
      'provider_subscription_id',
      'generation',
      'state',
      'product_id',
      'will_renew',
      'current_period_end',
      'high_water',
      'created_at',
      'updated_at',
    ]);
    expect(byTable.get('consumable_balances')).toEqual(['member_id', 'credit_type', 'balance', 'updated_at']);
    expect(byTable.get('applications')).toEqual([
      'id',
      'member_id',
      'crew_id',
      'generation',
      'state',
      'lane',
      'cooldown_until',
      'created_at',
      'updated_at',
    ]);
  });

  it('enforces payment_events inbox uniqueness on (source, event_id) — idempotency layer 1', async () => {
    const row = {
      source: 'stripe-webhook',
      eventId: `evt_${randomUUID()}`,
      payload: { kind: 'test' },
      effectiveAt: new Date(),
      disposition: 'applied' as const,
    };

    await dbHandle.db.insert(paymentEvents).values(row);

    await expect(dbHandle.db.insert(paymentEvents).values(row)).rejects.toThrow(/duplicate key value/);
  });

  it('enforces ledger_entries natural_key uniqueness — idempotency layer 2 (I3)', async () => {
    const naturalKey = `stripe:invoice:${randomUUID()}`;

    await dbHandle.db.insert(ledgerEntries).values({
      memberId: seedMemberId,
      entryType: 'grant',
      creditType: 'irlo_plus',
      naturalKey,
    });

    await expect(
      dbHandle.db.insert(ledgerEntries).values({
        memberId: seedMemberId,
        entryType: 'reversal',
        creditType: 'irlo_plus',
        naturalKey,
      }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it('enforces subscriptions uniqueness on (provider, provider_subscription_id, generation)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;
    const row = {
      memberId: seedMemberId,
      provider: 'stripe' as const,
      providerSubscriptionId,
      state: 'active' as const,
      productId: 'irlo.plus.monthly',
    };

    await dbHandle.db.insert(subscriptions).values(row);

    await expect(dbHandle.db.insert(subscriptions).values(row)).rejects.toThrow(/duplicate key value/);
  });

  it('allows a second subscription generation for the same provider subscription id — resubscribe (I6)', async () => {
    const providerSubscriptionId = `sub_${randomUUID()}`;

    await dbHandle.db.insert(subscriptions).values({
      memberId: seedMemberId,
      provider: 'apple',
      providerSubscriptionId,
      generation: 1,
      state: 'expired',
      productId: 'irlo.plus.monthly',
    });

    await expect(
      dbHandle.db.insert(subscriptions).values({
        memberId: seedMemberId,
        provider: 'apple',
        providerSubscriptionId,
        generation: 2,
        state: 'active',
        productId: 'irlo.plus.monthly',
      }),
    ).resolves.not.toThrow();
  });

  it('rejects a second live application for the same (member, crew) — I8 partial unique index', async () => {
    const crewId = randomUUID();

    await dbHandle.db.insert(applications).values({ memberId: seedMemberId, crewId, state: 'submitted' });

    await expect(
      dbHandle.db.insert(applications).values({ memberId: seedMemberId, crewId, state: 'under_review' }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it('allows a new generation once the prior application is terminal — I8 partial index scope', async () => {
    const crewId = randomUUID();

    await dbHandle.db.insert(applications).values({
      memberId: seedMemberId,
      crewId,
      state: 'rejected',
      cooldownUntil: new Date(),
    });

    await expect(
      dbHandle.db.insert(applications).values({ memberId: seedMemberId, crewId, generation: 2, state: 'submitted' }),
    ).resolves.not.toThrow();
  });

  it('enforces consumable_balances composite primary key on (member_id, credit_type)', async () => {
    await dbHandle.db.insert(consumableBalances).values({ memberId: seedMemberId, creditType: 'spark', balance: 5 });

    await expect(
      dbHandle.db.insert(consumableBalances).values({ memberId: seedMemberId, creditType: 'spark', balance: 10 }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it('logs an admission_events row against a real application via foreign key (I9)', async () => {
    const crewId = randomUUID();
    const [application] = await dbHandle.db
      .insert(applications)
      .values({ memberId: seedMemberId, crewId, state: 'submitted' })
      .returning({ id: applications.id });

    await expect(
      dbHandle.db.insert(admissionEvents).values({
        applicationId: application!.id,
        event: 'submit',
        actor: `member:${seedMemberId}`,
      }),
    ).resolves.not.toThrow();
  });
});
