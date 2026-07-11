import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/** ADR-0009: the entitlement subject — never a device. */
export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
