import { describe, it, expect } from 'vitest';
import { arcPath, valueToAngle, polarToCartesian } from '../gaugeGeometry';

describe('gaugeGeometry — polarToCartesian', () => {
  it('0° is at top, 90° to the right', () => {
    const top = polarToCartesian(50, 50, 40, 0);
    expect(top.x).toBeCloseTo(50, 5);
    expect(top.y).toBeCloseTo(10, 5);
    const right = polarToCartesian(50, 50, 40, 90);
    expect(right.x).toBeCloseTo(90, 5);
    expect(right.y).toBeCloseTo(50, 5);
  });
});

describe('gaugeGeometry — arcPath', () => {
  it('produces a well-formed SVG arc command', () => {
    const d = arcPath(50, 50, 40, 0, 90);
    expect(d).toMatch(/^M /);
    expect(d).toContain(' A ');
    // starts at top (50,10), ends at right (90,50)
    expect(d).toContain('M 50 10');
    expect(d.endsWith('90 50')).toBe(true);
  });
  it('sets large-arc flag past 180°', () => {
    const d = arcPath(0, 0, 10, 0, 270);
    // format: ... A r r 0 <largeArc> <sweep> x y
    const parts = d.split(' A ')[1].split(' ');
    expect(parts[3]).toBe('1'); // largeArc
    expect(parts[4]).toBe('1'); // clockwise sweep
  });
});

describe('gaugeGeometry — valueToAngle', () => {
  it('maps value linearly across the sweep', () => {
    expect(valueToAngle(0, 100, 270)).toBe(0);
    expect(valueToAngle(50, 100, 270)).toBe(135);
    expect(valueToAngle(100, 100, 270)).toBe(270);
  });
  it('applies a start offset', () => {
    expect(valueToAngle(50, 100, 270, -135)).toBe(0);
  });
  it('clamps out-of-range values and guards max', () => {
    expect(valueToAngle(150, 100, 270)).toBe(270);
    expect(valueToAngle(-10, 100, 270)).toBe(0);
    expect(valueToAngle(5, 0, 270)).toBe(270); // max coerced to 1, clamp value
  });
});
