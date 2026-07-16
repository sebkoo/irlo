/**
 * ADR-0009 I10 — `can()` is pure and I/O-free over (admission state,
 * entitlement snapshot). The principal is always already-authenticated by
 * the time it reaches this function: an anonymous/guest request (e.g.
 * browsing the basic Deck without an account) is a route-level decision —
 * no middleware applied — never a `can()` call, so there is no "no
 * principal" branch here; that layer is the C29 gating middleware's 401.
 * `admissionState: null` means an authenticated principal with no live
 * application to any crew, not an unauthenticated guest.
 *
 * Capability catalog — approved 2026-07-15 after escalation trigger (a):
 * ADR-0005:65-67 names exactly these four capabilities ("join crew chat,
 * see full Deck, host activities, boost visibility") resolving from
 * `(admission state, entitlements)`, but no guest/applicant/member matrix
 * exists anywhere in the docs to read gate values off of — the gates below
 * are the approved minimal set, each cited individually. `can(review)`
 * (referenced only in admission-transition.ts's own comments, never an
 * ADR/monetization citation) is deliberately out of this catalog — it
 * needs a staff/reviewer principal shape ADR-0005 never models, folded
 * into slice D's pending auth-shape question rather than invented here.
 */

import type { AdmissionState } from '../domain/admission-transition.js';

export type Capability =
  'join_crew_chat' | 'host_activities' | 'see_full_deck' | 'boost_visibility';

export interface EntitlementSnapshot {
  irloPlus: boolean;
}

export interface PrincipalContext {
  admissionState: AdmissionState | null;
  entitlements: EntitlementSnapshot;
}

/**
 * ADR-0005:65-67 + monetization.md:14 (spark.single = "one visibility
 * boost for your join request"): boosting only means something while an
 * application is live and pending — not before submission, not once
 * decided. Spark balance itself is enforced downstream by the existing
 * ledger spend guard (I2), not here.
 */
const BOOST_VISIBILITY_STATES: ReadonlySet<AdmissionState> = new Set([
  'submitted',
  'under_review',
  'waitlisted',
]);

export function can(context: PrincipalContext, capability: Capability): boolean {
  switch (capability) {
    // ADR-0005:65-67: chat and hosting are member-only capabilities.
    case 'join_crew_chat':
    case 'host_activities':
      return context.admissionState === 'member';

    // ADR-0005:65-67 + monetization.md:25 ("full Deck reach" as an Irlo+
    // entitlement): Deck browsing predates admission, so this capability is
    // entitlement-only — admission state never enters the gate.
    case 'see_full_deck':
      return context.entitlements.irloPlus;

    case 'boost_visibility':
      return context.admissionState !== null && BOOST_VISIBILITY_STATES.has(context.admissionState);
  }
}
