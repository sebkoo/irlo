/**
 * C29 — gating middleware over an injected-principal seam. Real
 * authentication (tokens, sessions, credentials) is out of scope by
 * decision — slice D's pending auth-shape question; `Authenticator` here
 * is only the resolver-shaped seam an eventual real implementation would
 * plug into, mirroring how `buildApp`'s `tracing`/`db` options are
 * pre-wired seams for pieces that land later.
 */

import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

import { can, type Capability, type PrincipalContext } from './can.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireCapability's preHandler once can() allows the request through. */
    principal?: PrincipalContext;
  }
}

export interface Authenticator {
  identify: (req: FastifyRequest) => PrincipalContext | undefined;
}

export interface CapabilityDeniedBody {
  code: 'capability_denied';
  capability: Capability;
}

/**
 * Semantics: no principal (authenticator finds nothing for this request)
 * → 401; principal present but can() denies → 403 with the denied
 * capability as a typed reason; allowed → the principal is attached to
 * the request and the route handler runs.
 */
export function requireCapability(
  authenticator: Authenticator,
  capability: Capability,
): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = authenticator.identify(req);

    if (principal === undefined) {
      await reply.code(401).send({ code: 'unauthenticated' });
      return;
    }

    if (!can(principal, capability)) {
      const body: CapabilityDeniedBody = { code: 'capability_denied', capability };
      await reply.code(403).send(body);
      return;
    }

    req.principal = principal;
  };
}
