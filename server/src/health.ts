import type { HealthStatus } from '@irlo/contracts';

/**
 * Health status as a pure function: all inputs explicit, no clock or I/O
 * reads inside. The shape comes from @irlo/contracts — server code never
 * hand-writes API types (ADR-0002). The HTTP surface that exposes it is a
 * Stage 1 decision (Fastify, ADR-0003), keeping Stage 0 framework-free.
 */
export function healthStatus(now: Date): HealthStatus {
  return {
    status: 'ok',
    service: 'irlo-server',
    timestamp: now.toISOString(),
  };
}
