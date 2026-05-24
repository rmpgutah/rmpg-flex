import { describe, it, expect } from 'vitest';
import { evaluateLevel } from '../gpsStaleWatchdog';

describe('evaluateLevel', () => {
  const SEC = 1000, MIN = 60 * SEC;
  it('returns 0 below 3 min', () => {
    expect(evaluateLevel(0)).toBe(0);
    expect(evaluateLevel(2 * MIN + 59 * SEC)).toBe(0);
  });
  it('returns 1 at 3–10 min', () => {
    expect(evaluateLevel(3 * MIN)).toBe(1);
    expect(evaluateLevel(9 * MIN + 59 * SEC)).toBe(1);
  });
  it('returns 2 at 10–15 min', () => {
    expect(evaluateLevel(10 * MIN)).toBe(2);
    expect(evaluateLevel(14 * MIN + 59 * SEC)).toBe(2);
  });
  it('returns 3 at or above 15 min', () => {
    expect(evaluateLevel(15 * MIN)).toBe(3);
    expect(evaluateLevel(60 * MIN)).toBe(3);
  });
});
