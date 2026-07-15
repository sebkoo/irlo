import { z } from 'zod';

/**
 * Contract for the server's runtime environment (ADR-0003, 12-factor).
 * Covers the `--- Runtime ---` vars the server consumes today plus
 * DATABASE_URL (C20; optional until the pool boot-wires into buildApp in
 * Stage 2, then flips to required). Other Datastore, payments, and
 * observability vars documented further down `.env.example` are commented
 * as arriving with their own later stage commits — each gains a schema
 * entry when that commit lands, not speculatively here.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /**
   * Stripe webhook signing secret (ADR-0009 §3h) — optional until the
   * Stripe route boot-wires into buildApp (Stage 3), then flips to
   * required, mirroring DATABASE_URL's own staged rollout above.
   */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * OTLP/HTTP collector endpoint for OpenTelemetry traces (C18, ADR-0003) —
   * optional until a server entrypoint boot-wires `startTracing` into
   * `buildApp`, mirroring DATABASE_URL's own staged rollout above.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
