import { describe, it, expect } from 'vitest';
import { isCircuitOpen, conditionalHeaders, isUnchanged, jitterDelayMs } from '../../src/utils/warrantSources/resilience';

describe('isCircuitOpen', () => {
  it('opens at exactly 5 consecutive failures', () => {
    expect(isCircuitOpen([1, 1, 1, 1, 1])).toBe(true);
    expect(isCircuitOpen([2, 3, 1, 1, 4])).toBe(true); // any positive error count counts as a failed run
  });
  it('stays closed when fewer than 5 consecutive, or a recent run had 0 errors', () => {
    expect(isCircuitOpen([1, 1, 1, 1])).toBe(false);   // only 4
    expect(isCircuitOpen([1, 1, 0, 1, 1, 1])).toBe(false); // a 0 within the trailing window resets
    expect(isCircuitOpen([])).toBe(false);
  });
});

describe('conditionalHeaders', () => {
  it('emits If-None-Match / If-Modified-Since only when present', () => {
    expect(conditionalHeaders({ etag: 'abc', last_modified: 'Wed, 21 Oct 2026 07:28:00 GMT' }))
      .toEqual({ 'If-None-Match': 'abc', 'If-Modified-Since': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    expect(conditionalHeaders({ etag: 'abc' })).toEqual({ 'If-None-Match': 'abc' });
    expect(conditionalHeaders({})).toEqual({});
    expect(conditionalHeaders({ etag: null, last_modified: null })).toEqual({});
  });
});

describe('isUnchanged', () => {
  it('is true only for 304', () => {
    expect(isUnchanged(304)).toBe(true);
    expect(isUnchanged(200)).toBe(false);
    expect(isUnchanged(404)).toBe(false);
  });
});

describe('jitterDelayMs', () => {
  it('stays within [baseMs, baseMs+2000)', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const d = jitterDelayMs(8000, 12345, attempt);
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThan(10000);
    }
  });
  it('is deterministic (same inputs => same output) and varies by attempt', () => {
    expect(jitterDelayMs(8000, 12345, 3)).toBe(jitterDelayMs(8000, 12345, 3));
    const a = jitterDelayMs(8000, 12345, 1);
    const b = jitterDelayMs(8000, 12345, 2);
    expect(a).not.toBe(b); // different attempts should (almost always) differ
  });
});
