import { describe, expect, it } from 'vitest';

import { can, type PrincipalContext } from '../../src/capabilities/can.js';

function principal(overrides: Partial<PrincipalContext> = {}): PrincipalContext {
  return {
    memberId: 'member:test',
    admissionState: null,
    entitlements: { irloPlus: false },
    ...overrides,
  };
}

describe('can() (ADR-0009 I10, ADR-0005:65-67, C28)', () => {
  describe('join_crew_chat', () => {
    it('grants members', () => {
      expect(can(principal({ admissionState: 'member' }), 'join_crew_chat')).toBe(true);
    });

    it('denies non-members', () => {
      expect(can(principal({ admissionState: 'under_review' }), 'join_crew_chat')).toBe(false);
    });

    it('denies an authenticated principal with no live application', () => {
      expect(can(principal({ admissionState: null }), 'join_crew_chat')).toBe(false);
    });
  });

  describe('host_activities', () => {
    it('grants members', () => {
      expect(can(principal({ admissionState: 'member' }), 'host_activities')).toBe(true);
    });

    it('denies non-members', () => {
      expect(can(principal({ admissionState: 'accepted' }), 'host_activities')).toBe(false);
    });
  });

  describe('see_full_deck', () => {
    it('grants an irlo.plus entitlement regardless of admission state', () => {
      expect(
        can(principal({ admissionState: null, entitlements: { irloPlus: true } }), 'see_full_deck'),
      ).toBe(true);
    });

    it('denies without the irlo.plus entitlement', () => {
      expect(
        can(
          principal({ admissionState: 'member', entitlements: { irloPlus: false } }),
          'see_full_deck',
        ),
      ).toBe(false);
    });
  });

  describe('boost_visibility', () => {
    it.each(['submitted', 'under_review', 'waitlisted'] as const)(
      'grants a live pending application in state %s',
      (admissionState) => {
        expect(can(principal({ admissionState }), 'boost_visibility')).toBe(true);
      },
    );

    it.each(['draft', 'accepted', 'member', 'rejected', 'withdrawn'] as const)(
      'denies state %s — no live pending application to boost',
      (admissionState) => {
        expect(can(principal({ admissionState }), 'boost_visibility')).toBe(false);
      },
    );

    it('denies an authenticated principal with no live application at all', () => {
      expect(can(principal({ admissionState: null }), 'boost_visibility')).toBe(false);
    });
  });
});
