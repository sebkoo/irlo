import { integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { members } from './members.js';

/**
 * ADR-0009 admission aggregate projection, keyed (member, crew, generation).
 * crewId has no FK yet — crews arrive with the Deck feed (Stage 6).
 */
export const applicationStateEnum = pgEnum('application_state', [
  'draft',
  'submitted',
  'under_review',
  'waitlisted',
  'accepted',
  'member',
  'rejected',
  'withdrawn',
]);

export const applicationLaneEnum = pgEnum('application_lane', ['standard', 'priority']);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    crewId: uuid('crew_id').notNull(),
    generation: integer('generation').notNull().default(1),
    state: applicationStateEnum('state').notNull(),
    lane: applicationLaneEnum('lane'),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // I8: at most one LIVE (non-terminal) application per (member, crew).
    // member/rejected/withdrawn are the terminal states (ADR-0009); a new
    // generation after any of them is a fresh row, not a conflict.
    uniqueIndex('applications_live_member_crew_key')
      .on(table.memberId, table.crewId)
      .where(sql`${table.state} not in ('member', 'rejected', 'withdrawn')`),
  ],
);
