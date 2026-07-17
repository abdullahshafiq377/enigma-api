import { describe, expect, it } from 'vitest';

import {
  clampSegments,
  coverage,
  mergeSegments,
  totalCovered,
} from '@/modules/progress/watched-segments';

describe('watched-segments', () => {
  it('merges overlapping and adjacent intervals', () => {
    const merged = mergeSegments([
      { start: 0, end: 10 },
      { start: 8, end: 15 },
      { start: 15, end: 20 },
      { start: 30, end: 35 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 35 },
    ]);
  });

  it('drops invalid/zero-length intervals', () => {
    expect(
      mergeSegments([
        { start: 5, end: 5 },
        { start: 10, end: 8 },
      ]),
    ).toEqual([]);
  });

  it('counts only distinct seconds (no double counting)', () => {
    expect(
      totalCovered([
        { start: 0, end: 10 },
        { start: 5, end: 12 },
      ]),
    ).toBe(12);
  });

  it('clamps to [0, duration]', () => {
    expect(clampSegments([{ start: -5, end: 120 }], 100)).toEqual([{ start: 0, end: 100 }]);
  });

  it('computes coverage fraction capped at 1', () => {
    expect(coverage([{ start: 0, end: 90 }], 100)).toBeCloseTo(0.9);
    expect(coverage([{ start: 0, end: 200 }], 100)).toBe(1);
    expect(coverage([{ start: 0, end: 50 }], 0)).toBe(0);
  });
});
