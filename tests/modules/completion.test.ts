import { describe, expect, it } from 'vitest';

import { isModuleComplete } from '@/modules/certificate/completion';

describe('isModuleComplete', () => {
  it('true when every published video is completed', () => {
    expect(isModuleComplete(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toBe(true);
  });

  it('false when any video is incomplete', () => {
    expect(isModuleComplete(['a', 'b', 'c'], new Set(['a', 'b']))).toBe(false);
  });

  it('false for an empty module (nothing to certify)', () => {
    expect(isModuleComplete([], new Set())).toBe(false);
  });

  it('ignores extra completed videos not in the module', () => {
    expect(isModuleComplete(['a'], new Set(['a', 'x', 'y']))).toBe(true);
  });
});
