/**
 * Health status as a pure function: all inputs explicit, no clock or I/O
 * reads inside. The HTTP surface that exposes it is a Stage 1 decision
 * (Fastify, ADR-0003) — keeping Stage 0 framework-free.
 */
export interface HealthStatus {
  status: 'ok';
  service: 'irlo-server';
  timestamp: string;
}

export function healthStatus(now: Date): HealthStatus {
  return {
    status: 'ok',
    service: 'irlo-server',
    timestamp: now.toISOString(),
  };
}
