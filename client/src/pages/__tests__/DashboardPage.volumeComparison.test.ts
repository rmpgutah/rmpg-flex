// ============================================================
// Dashboard call-volume comparison — a zero baseline is NOT "no change"
// ============================================================
// The tiles computed:
//
//   vsYesterday = yesterdayCount > 0 ? round(((today - yesterday)/yesterday)*100) : 0
//
// so a zero baseline produced 0, which rendered as "0%" with the neutral
// indicator -- indistinguishable from a genuinely flat day.
//
// Observed live: "CALLS TODAY 6" beside "0% vs Yesterday (0 calls)". Volume had
// gone from nothing to six and the dashboard reported flat. A percentage change
// from zero is undefined, so the tile must say so rather than invent 0%.
//
// This pins the three-way distinction the render branches depend on:
//   null  -> no comparison possible (em dash, muted)
//   0     -> genuinely unchanged    (neutral indicator)
//   +/-n  -> real change
// ============================================================

import { describe, it, expect } from 'vitest';

/** Mirrors the helper in DashboardPage.tsx. */
const pctChange = (now: number, base: number): number | null =>
  base > 0 ? Math.round(((now - base) / base) * 100) : null;

describe('pctChange', () => {
  it('returns null when the baseline is zero — not 0', () => {
    // The exact live case: 6 calls today, 0 yesterday.
    expect(pctChange(6, 0)).toBeNull();
    // and the degenerate 0-from-0 day is equally uncomparable
    expect(pctChange(0, 0)).toBeNull();
  });

  it('still returns 0 for a genuinely unchanged day', () => {
    // This is what must NOT collapse into the null case — a real flat day is
    // meaningful information and keeps its neutral indicator.
    expect(pctChange(6, 6)).toBe(0);
  });

  it('computes real increases and decreases', () => {
    expect(pctChange(6, 3)).toBe(100);   // live: +100% vs last week
    expect(pctChange(0, 6)).toBe(-100);  // live: -100% after the day rolled
    expect(pctChange(3, 6)).toBe(-50);
  });

  it('rounds to whole percent', () => {
    expect(pctChange(7, 3)).toBe(133);
    expect(pctChange(2, 3)).toBe(-33);
  });

  it('never yields Infinity or NaN, which is what the guard exists to prevent', () => {
    for (const [now, base] of [[5, 0], [0, 0], [0, 5], [5, 5]] as const) {
      const v = pctChange(now, base);
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });
});
