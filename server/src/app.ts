import type { Span } from '@opentelemetry/api';
import type { ServerEnv } from '@irlo/contracts';
import Fastify, { type FastifyInstance, type preHandlerAsyncHookHandler } from 'fastify';

import type { Capability } from './capabilities/can.js';
import { requireCapability, type Authenticator } from './capabilities/gating.js';
import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import type { Tracing } from './observability/tracing.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStripeWebhookRoute } from './routes/stripe-webhook.js';
import { registerWaitlistSkipRoute } from './routes/waitlist-skip.js';

declare module 'fastify' {
  interface FastifyRequest {
    otelSpan?: Span;
  }

  interface FastifyInstance {
    /**
     * Decorated only when `BuildAppOptions.authenticator` is given (C29) —
     * absent by default, same staged-rollout shape as `tracing`/`db`. A
     * future route registration function calls `app.requireCapability(x)`
     * as a `preHandler` the same way it would call any other app-level
     * helper; there is no product route yet (see BuildAppOptions.authenticator's doc comment).
     */
    requireCapability?: (capability: Capability) => preHandlerAsyncHookHandler;
  }
}

export interface BuildAppOptions {
  config?: ServerEnv;
  loggerStream: NodeJS.WritableStream;
  /**
   * Optional, same staged-rollout shape as `config.DATABASE_URL`/
   * `STRIPE_WEBHOOK_SECRET`: the Stripe webhook route only registers when
   * both a `db` and a `STRIPE_WEBHOOK_SECRET` are present, so existing
   * callers (e.g. the health-route tests) that build an app with neither
   * are unaffected.
   */
  db?: Db['db'];
  /**
   * Optional, same staged-rollout shape as `db`: when present, every
   * request gets an OpenTelemetry span whose traceId/spanId are attached to
   * `request.log` (C18). Absent by default, so existing suites are
   * unaffected.
   */
  tracing?: Tracing;
  /**
   * Optional, same staged-rollout shape as `tracing`: when present,
   * `app.requireCapability(capability)` is decorated as a Fastify
   * `preHandler` factory gating on `(admissionState, entitlements)` (C28's
   * `can()`). Absent by default, so existing suites are unaffected. No
   * product route consumes this yet (NEXT_STEPS.md: the first consumer
   * arrives with the waitlist/apply routes) — `authenticator` is the seam
   * only; resolving a real principal from a request is slice D's pending
   * auth-shape question, deliberately out of scope here.
   */
  authenticator?: Authenticator;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      stream: options.loggerStream,
    },
  });

  if (options.tracing !== undefined) {
    const tracing = options.tracing;

    app.addHook('onRequest', (req, reply, done) => {
      const span = tracing.tracer.startSpan(`${req.method} ${req.url}`);
      const { traceId, spanId } = span.spanContext();

      req.otelSpan = span;
      req.log = req.log.child({ traceId, spanId });
      reply.log = req.log;
      done();
    });

    app.addHook('onResponse', (req, _reply, done) => {
      req.otelSpan?.end();
      done();
    });
  }

  if (options.authenticator !== undefined) {
    const authenticator = options.authenticator;
    app.decorate('requireCapability', (capability: Capability) =>
      requireCapability(authenticator, capability),
    );

    // The waitlist-skip route needs both a principal to gate on (this
    // branch) and a db to persist against — mirrors the Stripe webhook
    // route's own db-plus-secret conditional registration below.
    if (options.db !== undefined) {
      registerWaitlistSkipRoute(app, options.db);
    }
  }

  registerHealthRoute(app);

  if (options.db !== undefined && config.STRIPE_WEBHOOK_SECRET !== undefined) {
    registerStripeWebhookRoute(app, options.db, {
      webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    });
  }

  return app;
}
