import { describe, it, expect } from 'vitest';
import { computeDaysToServeStats } from '../src/routes/serveDashboard';

describe('computeDaysToServeStats', () => {
  it('returns all zeros for an empty sample', () => {
    expect(computeDaysToServeStats([])).toEqual({ avg: 0, median: 0, p90: 0 });
  });

  it('median is the middle element for an odd-length sample', () => {
    const stats = computeDaysToServeStats([1, 2, 3, 4, 5]);
    expect(stats.median).toBe(3);
  });

  it('median is the average of the two middle elements for an even-length sample', () => {
    // Old bug: dayValues[floor(4/2)] = dayValues[2] = 3, not the true median 2.5
    const stats = computeDaysToServeStats([1, 2, 3, 4]);
    expect(stats.median).toBe(2.5);
  });

  it('p90 selects the value at ceil(n*0.9)-1, not floor(n*0.9)', () => {
    // 100 sorted values 1..100 — the 90th value is 90, at index 89.
    // Old bug: floor(100*0.9)=90 selected index 90 → value 91.
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computeDaysToServeStats(values);
    expect(stats.p90).toBe(90);
  });

  it('p90 on a non-multiple-of-10 sample still lands on a sane index', () => {
    const values = [1, 2, 3, 4, 5, 6, 7]; // n=7, ceil(6.3)-1 = 6
    const stats = computeDaysToServeStats(values);
    expect(stats.p90).toBe(7);
  });

  it('computes a rounded average', () => {
    const stats = computeDaysToServeStats([1, 2, 3]);
    expect(stats.avg).toBe(2);
  });
});
