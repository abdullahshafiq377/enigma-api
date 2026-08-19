import { describe, expect, it } from 'vitest';

import { canAccessVideo, canAccessVideoInModule } from '@/modules/video/access';

describe('canAccessVideo', () => {
  it('insight → free only', () => {
    expect(canAccessVideo('insight', 'free')).toBe(true);
    expect(canAccessVideo('insight', 'paid')).toBe(false);
    expect(canAccessVideo('insight', 'partner')).toBe(false);
  });

  it('mastery → free + paid (not partner)', () => {
    expect(canAccessVideo('mastery', 'free')).toBe(true);
    expect(canAccessVideo('mastery', 'paid')).toBe(true);
    expect(canAccessVideo('mastery', 'partner')).toBe(false);
  });

  it('sovereign → all tiers', () => {
    expect(canAccessVideo('sovereign', 'free')).toBe(true);
    expect(canAccessVideo('sovereign', 'paid')).toBe(true);
    expect(canAccessVideo('sovereign', 'partner')).toBe(true);
  });
});

describe('canAccessVideoInModule — partner assignment', () => {
  const ALICE = '650000000000000000000001';
  const BOB = '650000000000000000000002';
  const sovereign = { id: ALICE, tier: 'sovereign' } as const;

  const partnerModule = (assignedUserIds?: string[]) => ({
    tier: 'partner' as const,
    ...(assignedUserIds ? { assignedUserIds } : {}),
  });

  it('an empty assignment means every member the tier already admits', () => {
    expect(canAccessVideoInModule(sovereign, 'partner', partnerModule([]))).toBe(true);
    expect(canAccessVideoInModule(sovereign, 'partner', partnerModule())).toBe(true);
  });

  it('a named member gets in; an unnamed one does not', () => {
    expect(canAccessVideoInModule(sovereign, 'partner', partnerModule([ALICE]))).toBe(true);
    expect(canAccessVideoInModule(sovereign, 'partner', partnerModule([BOB]))).toBe(false);
  });

  it('matches ObjectId values, not just strings', () => {
    const asObjectId = [{ toString: () => ALICE }];
    expect(canAccessVideoInModule(sovereign, 'partner', partnerModule(asObjectId as never))).toBe(
      true,
    );
  });

  // The rule narrows; it never promotes.
  it('being named does not grant access the tier withholds', () => {
    const mastery = { id: ALICE, tier: 'mastery' } as const;
    expect(canAccessVideoInModule(mastery, 'partner', partnerModule([ALICE]))).toBe(false);
  });

  it('leaves non-partner modules to the tier ladder alone', () => {
    const insight = { id: BOB, tier: 'insight' } as const;
    // BOB is assigned to nothing, but a free module never consults the list.
    expect(canAccessVideoInModule(insight, 'free', { tier: 'free', assignedUserIds: [ALICE] })).toBe(
      true,
    );
    expect(canAccessVideoInModule(insight, 'paid', { tier: 'paid' })).toBe(false);
  });
});
