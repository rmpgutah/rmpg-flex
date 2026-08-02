// Unit tests for clampIntParam — the NaN-safe LIMIT/OFFSET parser.
//
// D1 rejects a non-integer bound to LIMIT/OFFSET (datatype mismatch), so
// `?limit=abc` was an HTTP 500. The two guards already in the codebase both
// failed, and these tests pin exactly why so the old shapes can't come back.
import { describe, it, expect } from 'vitest';
import { clampIntParam } from '../src/utils/paginationParams';

describe('clampIntParam', () => {
  it('uses the default for absent, empty or unparseable input', () => {
    for (const raw of [undefined, null, '', '   ', 'abc', 'NaN', '--5', 'e5']) {
      expect(clampIntParam(raw, 50, 1, 200), `raw=${JSON.stringify(raw)}`).toBe(50);
    }
  });

  it('parses a normal value and preserves it', () => {
    expect(clampIntParam('75', 50, 1, 200)).toBe(75);
  });

  it('clamps to min and max', () => {
    expect(clampIntParam('9999', 50, 1, 200)).toBe(200);
    expect(clampIntParam('0', 50, 1, 200)).toBe(1);
    expect(clampIntParam('-5', 50, 1, 200)).toBe(1);
  });

  it('bounds a huge-but-finite value that Number.isFinite accepts', () => {
    // 1e20 is finite, so an isFinite-only guard would pass it through and D1
    // would reject it. parseInt('1e20') is 1, and the clamp bounds it anyway.
    for (const raw of ['1e20', '99999999999999999999', String(Number.MAX_SAFE_INTEGER)]) {
      const v = clampIntParam(raw, 50, 1, 200);
      expect(Number.isSafeInteger(v)).toBe(true);
      expect(v).toBeLessThanOrEqual(200);
      expect(v).toBeGreaterThanOrEqual(1);
    }
  });

  it('always returns a safe integer, never NaN or Infinity', () => {
    for (const raw of ['abc', 'Infinity', '-Infinity', '1e400', '1.9', undefined]) {
      const v = clampIntParam(raw, 10, 0, 500);
      expect(Number.isNaN(v), `raw=${raw}`).toBe(false);
      expect(Number.isFinite(v), `raw=${raw}`).toBe(true);
      expect(Number.isInteger(v), `raw=${raw}`).toBe(true);
    }
  });

  it('truncates a float rather than passing it to D1', () => {
    expect(clampIntParam('10.9', 5, 0, 100)).toBe(10);
  });

  it('allows offset 0 (0 must not be treated as missing)', () => {
    // `parseInt(x) || 0` accidentally maps a real 0 to the default; here 0 is
    // a legitimate offset and must survive.
    expect(clampIntParam('0', 25, 0, 1000)).toBe(0);
  });
});

describe('the two guards this replaces were both broken', () => {
  it('documents why `parseInt(q || "50", 10)` fails', () => {
    // 'abc' is truthy, so the '50' default never applies.
    expect(parseInt('abc' || '50', 10)).toBeNaN();
    expect(clampIntParam('abc', 50, 1, 200)).toBe(50);
  });

  it('documents why a Math.min/Math.max clamp fails', () => {
    // Every Math.* operation on NaN is NaN, so clamping does not rescue it.
    expect(Math.min(500, Math.max(1, NaN))).toBeNaN();
    expect(clampIntParam('abc', 100, 1, 500)).toBe(100);
  });
});
