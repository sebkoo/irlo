import type { Span } from '@opentelemetry/api';
import type { ServerEnv } from '@irlo/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import type { Tracing } from './observability/tracing.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStripeWebhookRoute } from './routes/stripe-webhook.js';

declare module 'fastify' {
  interface FastifyRequest {
    otelSpan?: Span;
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

  registerHealthRoute(app);

  if (options.db !== undefined && config.STRIPE_WEBHOOK_SECRET !== undefined) {
    registerStripeWebhookRoute(app, options.db, {
      webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    });
  }

  return app;
}
