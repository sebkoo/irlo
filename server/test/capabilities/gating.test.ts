import Fastify from 'fastify';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { PrincipalContext } from '../../src/capabilities/can.js';
import { requireCapability, type Authenticator } from '../../src/capabilities/gating.js';

function buildTestApp(authenticator: Authenticator) {
  const app = Fastify();
  app.get('/gated', { preHandler: requireCapability(authenticator, 'host_activities') }, (req) => ({
    principalState: req.principal?.admissionState ?? null,
  }));
  return app;
}

describe('requireCapability (ADR-0009 I10, C29)', () => {
  it('responds 401 when the authenticator finds no principal', async () => {
    const app = buildTestApp({ identify: () => undefined });
    await app.ready();

    const response = await request(app.server).get('/gated');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'unauthenticated' });

    await app.close();
  });

  it('responds 403 with a typed reason when can() denies the capability', async () => {
    const principal: PrincipalContext = {
      memberId: 'member:test',
      admissionState: 'submitted',
      entitlements: { irloPlus: false },
    };
    const app = buildTestApp({ identify: () => principal });
    await app.ready();

    const response = await request(app.server).get('/gated');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'capability_denied', capability: 'host_activities' });

    await app.close();
  });

  it('runs the handler with the principal attached to the request when can() allows', async () => {
    const principal: PrincipalContext = {
      memberId: 'member:test',
      admissionState: 'member',
      entitlements: { irloPlus: false },
    };
    const app = buildTestApp({ identify: () => principal });
    await app.ready();

    const response = await request(app.server).get('/gated');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ principalState: 'member' });

    await app.close();
  });
});
