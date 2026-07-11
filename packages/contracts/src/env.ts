import { z } from 'zod';

/**
 * Contract for the server's runtime environment (ADR-0003, 12-factor).
 * Covers only the `--- Runtime ---` vars in `.env.example` that the server
 * consumes today. Datastore, payments, and observability vars documented
 * further down that file are commented as arriving with their own later
 * stage commits — each gains a schema entry when that commit lands, not
 * speculatively here.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
