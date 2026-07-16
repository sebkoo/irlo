import {
  waitlistSkipParamsSchema,
  waitlistSkipRequestSchema,
  waitlistSkipResponseSchema,
  type WaitlistSkipOutcome,
} from '@irlo/contracts';
import type { FastifyInstance } from 'fastify';

import { consumeWaitlistSkip } from '../admission/consume-waitlist-skip.js';
import type { Db } from '../db/client.js';

/**
 * HTTP status per `consumeWaitlistSkip` outcome. `applied` is the only
 * success; the rest are all "the request was well-formed, but the domain
 * declined it" — mapped to the closest-fitting 4xx rather than a blanket
 * 409, since each has a genuinely different retry story for the client:
 * `not_found` (404, nothing there), `already_priority`/`not_waitlisted`
 * (409, a state conflict — the resource exists but can't take this action
 * right now), `insufficient_credits` (402, the member needs to buy more
 * `waitlist.skip` credits before retrying).
 */
const STATUS_FOR_OUTCOME: Record<WaitlistSkipOutcome, number> = {
  applied: 200,
  not_found: 404,
  already_priority: 409,
  not_waitlisted: 409,
  insufficient_credits: 402,
};

/**
 * The first product route to consume C28-C29's capability gating (per
 * NEXT_STEPS.md: "the first product consumer arrives with the
 * waitlist/apply routes") — `app.requireCapability` is guaranteed decorated
 * by the time this is called, since `buildApp` only registers this route
 * from inside its authenticator-present branch, immediately after
 * decorating it.
 */
export function registerWaitlistSkipRoute(app: FastifyInstance, db: Db['db']): void {
  const requireBoostVisibility = app.requireCapability;
  /* c8 ignore next 3 -- registerWaitlistSkipRoute is only ever called from
   * buildApp's authenticator-present branch, which decorates this first. */
  if (requireBoostVisibility === undefined) {
    throw new Error('registerWaitlistSkipRoute requires an authenticator-decorated app');
  }

  app.post(
    '/applications/:applicationId/waitlist-skip',
    { preHandler: requireBoostVisibility('boost_visibility') },
    async (req, reply) => {
      const params = waitlistSkipParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ code: 'invalid_params', issues: params.error.issues });
      }

      const body = waitlistSkipRequestSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ code: 'invalid_body', issues: body.error.issues });
      }

      // requireCapability's preHandler always attaches a principal before a
      // route handler runs (401s otherwise) — see gating.ts.
      const memberId = req.principal?.memberId;
      /* c8 ignore next 3 -- unreachable: the preHandler above already 401s
       * when the authenticator finds no principal, so a handler invocation
       * always has one attached. */
      if (memberId === undefined) {
        throw new Error('waitlist-skip route reached with no principal attached');
      }

      const result = await consumeWaitlistSkip(db, {
        memberId,
        applicationId: params.data.applicationId,
        idempotencyKey: body.data.idempotencyKey,
      });

      return reply
        .code(STATUS_FOR_OUTCOME[result.outcome])
        .send(waitlistSkipResponseSchema.parse(result));
    },
  );
}
