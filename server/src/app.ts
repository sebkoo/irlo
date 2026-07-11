import type { ServerEnv } from '@irlo/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';

export interface BuildAppOptions {
  config?: ServerEnv;
  loggerStream?: NodeJS.WritableStream;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
  });

  registerHealthRoute(app);

  return app;
}
