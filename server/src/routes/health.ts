import { healthStatusSchema } from '@irlo/contracts';
import type { FastifyInstance } from 'fastify';

import { healthStatus } from '../health.js';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', () => healthStatusSchema.parse(healthStatus(new Date())));
}
