import type { ServerEnv } from '@irlo/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStripeWebhookRoute } from './routes/stripe-webhook.js';

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
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      stream: options.loggerStream,
    },
  });

  registerHealthRoute(app);

  if (options.db !== undefined && config.STRIPE_WEBHOOK_SECRET !== undefined) {
    registerStripeWebhookRoute(app, options.db, {
      webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    });
  }

  return app;
}
