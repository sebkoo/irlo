import { healthStatusSchema } from '@irlo/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { healthStatus } from './health.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', () => healthStatusSchema.parse(healthStatus(new Date())));

  return app;
}
