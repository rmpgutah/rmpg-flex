import { describe, it, expect } from 'vitest';
import { smoothHeading, shortestDelta } from '../headingSmooth';

describe('headingSmooth — shortestDelta', () => {
  it('takes the shortest arc across the seam', () => {
    expect(shortestDelta(350, 10)).toBe(20);
    expect(shortestDelta(10, 350)).toBe(-20);
    expect(shortestDelta(0, 180)).toBe(180);
  });
});

describe('headingSmooth — smoothHeading wrap interpolation', () => {
  it('350 -> 010 with alpha 0.5 crosses north (≈0), not 180', () => {
    const out = smoothHeading(350, 10, 0.5);
    // halfway along the +20° shortest arc from 350 = 360 ≡ 0
    expect(out).toBeCloseTo(0, 5);
  });
  it('alpha 1 jumps to target', () => {
    expect(smoothHeading(100, 250, 1)).toBeCloseTo(250, 5);
  });
  it('alpha 0 holds previous', () => {
    expect(smoothHeading(100, 250, 0)).toBeCloseTo(100, 5);
  });
});

describe('headingSmooth — deadband & stationary suppression', () => {
  it('suppresses sub-deadband jitter', () => {
    expect(smoothHeading(90, 91, 0.8, { deadbandDeg: 2 })).toBe(90);
  });
  it('allows changes above the deadband', () => {
    const out = smoothHeading(90, 100, 1, { deadbandDeg: 2 });
    expect(out).toBeCloseTo(100, 5);
  });
  it('freezes heading when below min speed (stationary)', () => {
    expect(smoothHeading(90, 270, 1, { minSpeedMs: 1, speedMs: 0.2 })).toBe(90);
  });
  it('updates when moving above min speed', () => {
    const out = smoothHeading(90, 180, 1, { minSpeedMs: 1, speedMs: 5 });
    expect(out).toBeCloseTo(180, 5);
  });
});
