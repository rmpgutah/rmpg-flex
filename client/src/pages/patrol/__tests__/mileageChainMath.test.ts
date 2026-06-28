import { describe, it, expect } from 'vitest';
import { computeChainGaps, computeNewRowDistance, chainRowKey } from '../mileageChainMath';

const row = (id: number, start: number | null, end: number | null, source?: 'call' | 'unit_trip') => ({
  id, source, call_number: `CFS-${id}`, starting_mileage: start, ending_mileage: end,
});

describe('chainRowKey', () => {
  it('disambiguates CFS and unit_trip rows that share a numeric id', () => {
    expect(chainRowKey({ id: 7 })).toBe('call-7');
    expect(chainRowKey({ id: 7, source: 'unit_trip' })).toBe('unit_trip-7');
    expect(chainRowKey({ id: 7 })).not.toBe(chainRowKey({ id: 7, source: 'unit_trip' }));
  });
});

describe('computeChainGaps', () => {
  it('flags a forward gap (unrecorded miles between events)', () => {
    const gaps = computeChainGaps([row(1, 100.0, 110.0), row(2, 115.5, 120.0)]);
    expect(gaps.get('call-2')).toEqual({ gap: 5.5, prevRef: 'CFS-1' });
    expect(gaps.has('call-1')).toBe(false); // nothing before the first row
  });

  it('flags a negative gap (odometer went backwards)', () => {
    const gaps = computeChainGaps([row(1, 100.0, 110.0), row(2, 105.0, 112.0)]);
    expect(gaps.get('call-2')?.gap).toBe(-5);
  });

  it('ignores sub-tolerance differences (0.1 mi odometer rounding)', () => {
    const gaps = computeChainGaps([row(1, 100.0, 110.0), row(2, 110.1, 115.0)]);
    expect(gaps.size).toBe(0);
  });

  it('carries the last known ending across rows that lack one', () => {
    // Row 2 has no ending (the backfill case) — row 3 still compares against row 1's end.
    const gaps = computeChainGaps([row(1, 100.0, 110.0), row(2, 110.0, null), row(3, 118.0, 125.0)]);
    expect(gaps.get('call-3')).toEqual({ gap: 8, prevRef: 'CFS-1' });
  });

  it('uses PATROL trip mileage for continuity like any other event', () => {
    const gaps = computeChainGaps([row(1, 100.0, 110.0), row(9, 110.0, 118.0, 'unit_trip'), row(2, 118.0, 124.0)]);
    expect(gaps.size).toBe(0); // continuous through the patrol leg
  });
});

describe('computeNewRowDistance', () => {
  it('computes end − start when fixing ending_mileage', () => {
    expect(computeNewRowDistance('ending_mileage', 112.4, 100, null)).toBe(12.4);
  });
  it('computes end − after when fixing starting_mileage', () => {
    expect(computeNewRowDistance('starting_mileage', 100, null, 112.4)).toBe(12.4);
  });
  it('returns negative distances so the UI can warn', () => {
    expect(computeNewRowDistance('ending_mileage', 95, 100, null)).toBe(-5);
  });
  it('returns null when the opposite endpoint is missing or input is NaN', () => {
    expect(computeNewRowDistance('ending_mileage', 112.4, null, null)).toBeNull();
    expect(computeNewRowDistance('starting_mileage', 100, 90, null)).toBeNull();
    expect(computeNewRowDistance('ending_mileage', NaN, 100, null)).toBeNull();
  });
});
