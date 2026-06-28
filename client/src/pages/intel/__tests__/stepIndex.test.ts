import { describe, it, expect } from 'vitest';
import { stepIndex } from '../search/stepIndex';

describe('stepIndex', () => {
  it('steps forward and wraps', () => {
    expect(stepIndex(0, +1, 3)).toBe(1);
    expect(stepIndex(2, +1, 3)).toBe(0); // wrap to start
  });
  it('steps back and wraps', () => {
    expect(stepIndex(0, -1, 3)).toBe(2); // wrap to end
  });
  it('returns -1 for empty list', () => {
    expect(stepIndex(-1, +1, 0)).toBe(-1);
  });
});
