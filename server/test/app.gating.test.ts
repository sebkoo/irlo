import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { PrincipalContext } from '../src/capabilities/can.js';
import type { Authenticator } from '../src/capabilities/gating.js';
import { MemoryLogStream } from './support/memory-log-stream.js';

describe('capability gating seam (C29)', () => {
  it('decorates the app with requireCapability when an authenticator is provided', async () => {
    const principal: PrincipalContext = {
      admissionState: 'member',
      entitlements: { irloPlus: false },
    };
    const authenticator: Authenticator = { identify: () => principal };

    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'info' },
      loggerStream: new MemoryLogStream(),
      authenticator,
    });

    const requireCapability = app.requireCapability;
    if (requireCapability === undefined) {
      throw new Error(
        'expected buildApp to decorate requireCapability when an authenticator is given',
      );
    }

    // No product routes consume capability gating yet (NEXT_STEPS.md:
    // "first product consumer arrives with the waitlist/apply routes") —
    // this test-registered route exists solely to exercise the seam
    // buildApp wires, the same way /health proved the tracing seam
    // (app.tracing.test.ts) before any real caller existed.
    app.get('/test/gated', { preHandler: requireCapability('host_activities') }, () => ({
      ok: true,
    }));
    await app.ready();

    const response = await request(app.server).get('/test/gated');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    await app.close();
  });

  it('leaves requireCapability undecorated when no authenticator is given, existing callers unaffected', async () => {
    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'info' },
      loggerStream: new MemoryLogStream(),
    });
    await app.ready();

    expect(app.requireCapability).toBeUndefined();

    await app.close();
  });
});
