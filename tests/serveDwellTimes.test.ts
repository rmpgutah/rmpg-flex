import { describe, it, expect } from 'vitest';
import { hashAddress, shouldRecordDwell, dwellSeconds, computeEtas } from '../src/utils/serveRouteOptimizer';

describe('hashAddress', () => {
  it('normalizes and hashes an address to a 64-char hex string', async () => {
    const hash = await hashAddress('123 Main St, Salt Lake City');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('produces the same hash for different-casing of the same address', async () => {
    const a = await hashAddress('123 MAIN ST, SALT LAKE CITY');
    const b = await hashAddress('  123 main st, salt lake city  ');
    expect(a).toBe(b);
  });
});

describe('shouldRecordDwell', () => {
  it('returns true for dwell of 31 seconds', () => {
    expect(shouldRecordDwell(31)).toBe(true);
  });

  it('returns false for dwell ≤ 30 seconds (GPS noise)', () => {
    expect(shouldRecordDwell(30)).toBe(false);
    expect(shouldRecordDwell(5)).toBe(false);
  });

  it('returns false for dwell ≥ 7200 seconds (forgotten app)', () => {
    expect(shouldRecordDwell(7200)).toBe(false);
    expect(shouldRecordDwell(9000)).toBe(false);
  });
});

describe('dwellSeconds', () => {
  it('computes positive delta between two ISO timestamps', () => {
    const arrived = '2026-08-12T09:00:00Z';
    const logged = '2026-08-12T09:07:30Z';
    expect(dwellSeconds(arrived, logged)).toBe(450);
  });

  it('returns 0 for identical timestamps', () => {
    const t = '2026-08-12T09:00:00Z';
    expect(dwellSeconds(t, t)).toBe(0);
  });
});

describe('computeEtas', () => {
  it('returns ISO timestamps advancing by travel + dwell time', () => {
    // orderedIndices [0, 1, 2], matrix with 5-min legs, dwell 5 min each
    const matrix = [[0, 300, 600], [300, 0, 300], [600, 300, 0]];
    const dwell = [300, 300, 300];
    const departAt = '2026-08-12T08:00:00.000Z';

    const etas = computeEtas([0, 1, 2], matrix, dwell, departAt);

    // stop 0: 0 travel + 300 dwell = 8:05
    expect(etas[0]).toBe('2026-08-12T08:05:00.000Z');
    // stop 1: 300 travel + 300 dwell = +10 min from stop 0 ETA = 8:15
    expect(etas[1]).toBe('2026-08-12T08:15:00.000Z');
    // stop 2: 300 travel + 300 dwell = +10 min = 8:25
    expect(etas[2]).toBe('2026-08-12T08:25:00.000Z');
  });

  it('handles single stop with no travel', () => {
    const matrix = [[0]];
    const etas = computeEtas([0], matrix, [600], '2026-08-12T08:00:00.000Z');
    expect(etas[0]).toBe('2026-08-12T08:10:00.000Z');
  });
});
