import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { applications } from './applications.js';

/** ADR-0009 / ADR-0005 append-only admission audit log (I9). */
export const admissionEventTypeEnum = pgEnum('admission_event_type', [
  'submit',
  'auto_triage',
  'review_open',
  'queue_advanced',
  'decision_accept',
  'decision_reject',
  'decision_defer',
  'skip_consumed',
  'onboarding_complete',
  'withdraw',
]);

export const admissionEvents = pgTable('admission_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  event: admissionEventTypeEnum('event').notNull(),
  // 'member:<uuid>' | 'reviewer:<uuid>' | 'system'.
  actor: text('actor').notNull(),
  reasonCode: text('reason_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
