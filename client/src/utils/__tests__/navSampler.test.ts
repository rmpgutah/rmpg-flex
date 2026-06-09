import { describe, it, expect, vi } from 'vitest';
import { createSampler } from '../navSampler';

describe('navSampler — min-spacing thinning', () => {
  it('keeps the first sample, rejects too-soon, accepts after gap', () => {
    const s = createSampler<{ t?: number }>(5000);
    expect(s.push({ t: 0 })).toBe(true);
    expect(s.push({ t: 1000 })).toBe(false);
    expect(s.push({ t: 4999 })).toBe(false);
    expect(s.push({ t: 5000 })).toBe(true);
    expect(s.push({ t: 9000 })).toBe(false);
    expect(s.push({ t: 10000 })).toBe(true);
    expect(s.size()).toBe(3);
    expect(s.getSamples().map(x => x.t)).toEqual([0, 5000, 10000]);
  });

  it('defaults missing timestamps to Date.now()', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42);
    const s = createSampler<{ t?: number; v: number }>(1000);
    expect(s.push({ v: 1 })).toBe(true);
    expect(s.getSamples()[0].t).toBe(42);
    nowSpy.mockRestore();
  });
});

describe('navSampler — bounded memory', () => {
  it('hard-caps retention with FIFO eviction', () => {
    const s = createSampler<{ t?: number }>(0, 3); // no spacing, cap 3
    for (let i = 0; i < 10; i++) s.push({ t: i });
    expect(s.size()).toBe(3);
    expect(s.getSamples().map(x => x.t)).toEqual([7, 8, 9]); // newest 3
  });
});

describe('navSampler — clear', () => {
  it('empties and resets spacing gate', () => {
    const s = createSampler<{ t?: number }>(5000);
    s.push({ t: 0 });
    s.push({ t: 5000 });
    expect(s.size()).toBe(2);
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.getSamples()).toEqual([]);
    // after clear, the very next push is accepted regardless of prior timestamps
    expect(s.push({ t: 1 })).toBe(true);
  });
});
