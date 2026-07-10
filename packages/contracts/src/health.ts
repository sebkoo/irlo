import { z } from 'zod';

/**
 * Contract for GET /health — the first boundary the server exposes (Stage 1).
 * Clients and server both derive their types from this schema, never from
 * hand-written interfaces (ADR-0002).
 */
export const healthStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('irlo-server'),
  timestamp: z.iso.datetime(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
