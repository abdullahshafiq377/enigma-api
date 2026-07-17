import { describe, expect, it } from 'vitest';

import { canAccessVideo } from '@/modules/video/access';

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
