import { z } from 'zod';

/**
 * Contract for POST /applications/:applicationId/waitlist-skip — ADR-0009
 * §3c's skip_consumed / §3d's client-minted idempotency key (the
 * `waitlist.skip` consumable, monetization.md:17). Stage 2, C34-C35.
 */
export const waitlistSkipParamsSchema = z.object({
  applicationId: z.uuid(),
});
export type WaitlistSkipParams = z.infer<typeof waitlistSkipParamsSchema>;

export const waitlistSkipRequestSchema = z.object({
  idempotencyKey: z.uuid(),
});
export type WaitlistSkipRequest = z.infer<typeof waitlistSkipRequestSchema>;

export const waitlistSkipOutcomeSchema = z.enum([
  'applied',
  'not_found',
  'already_priority',
  'not_waitlisted',
  'insufficient_credits',
]);
export type WaitlistSkipOutcome = z.infer<typeof waitlistSkipOutcomeSchema>;

export const waitlistSkipResponseSchema = z.object({
  outcome: waitlistSkipOutcomeSchema,
});
export type WaitlistSkipResponse = z.infer<typeof waitlistSkipResponseSchema>;
