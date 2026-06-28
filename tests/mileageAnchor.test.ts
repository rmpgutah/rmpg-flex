import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSuggestedMileage,
  deriveEndMileage,
  TRIP_DISTANCE_OUTLIER_MILES,
  scopeKeyOfficerUnit,
  scopeKeyOfficer,
  scopeKeyUnit,
} from '../src/utils/mileageAnchor';

// Minimal D1Database stub with a per-key seeded mileage_anchor table. Each
// prepare() returns an object whose .bind(...).first() returns the row
// matching the bound scope_key, or null.
function makeDb(table: Map<string, { current_mileage: number; offset_miles: number; last_entry_at: string | null }>) {
  return {
    prepare: (_sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => table.get(String(args[0])) ?? null,
      }),
    }),
  } as unknown as Parameters<typeof getSuggestedMileage>[0];
}

describe('mileageAnchor scope-key helpers', () => {
  it('formats the three canonical scope keys', () => {
    expect(scopeKeyOfficerUnit(7, 19)).toBe('officer_unit:7:19');
    expect(scopeKeyOfficer(7)).toBe('officer:7');
    expect(scopeKeyUnit(19)).toBe('unit:19');
  });
});

describe('getSuggestedMileage fallback chain', () => {
  it('returns null when both officer and unit are missing', async () => {
    const db = makeDb(new Map());
    expect(await getSuggestedMileage(db, null, null)).toBeNull();
    expect(await getSuggestedMileage(db, undefined, undefined)).toBeNull();
  });

  it('prefers the officer_unit anchor over either tier alone', async () => {
    const table = new Map([
      ['officer_unit:7:19', { current_mileage: 92_799.3, offset_miles: -456.9, last_entry_at: '2026-06-10 16:04:32' }],
      ['officer:7', { current_mileage: 91_000, offset_miles: 0, last_entry_at: null }],
      ['unit:19', { current_mileage: 50_000, offset_miles: 0, last_entry_at: null }],
    ]);
    const sug = await getSuggestedMileage(makeDb(table), 7, 19);
    expect(sug).toEqual({
      suggested_mileage: 92_799.3,
      source: 'officer_unit',
      scope_key: 'officer_unit:7:19',
      offset_miles: -456.9,
      last_entry_at: '2026-06-10 16:04:32',
    });
  });

  it('falls back to the officer anchor when the combo is missing', async () => {
    const table = new Map([
      ['officer:7', { current_mileage: 91_000, offset_miles: 0, last_entry_at: null }],
      ['unit:19', { current_mileage: 50_000, offset_miles: 0, last_entry_at: null }],
    ]);
    const sug = await getSuggestedMileage(makeDb(table), 7, 19);
    expect(sug?.source).toBe('officer');
    expect(sug?.suggested_mileage).toBe(91_000);
  });

  it('falls back to the unit anchor when officer-tier is also missing', async () => {
    const table = new Map([
      ['unit:19', { current_mileage: 50_000, offset_miles: 0, last_entry_at: null }],
    ]);
    const sug = await getSuggestedMileage(makeDb(table), 7, 19);
    expect(sug?.source).toBe('unit');
    expect(sug?.suggested_mileage).toBe(50_000);
  });

  it('returns null when no tier has a row', async () => {
    const sug = await getSuggestedMileage(makeDb(new Map()), 7, 19);
    expect(sug).toBeNull();
  });

  it('skips officer_unit lookup when one id is missing', async () => {
    const table = new Map([
      ['officer:7', { current_mileage: 91_000, offset_miles: 0, last_entry_at: null }],
    ]);
    // No unit_id → would otherwise mis-key as 'officer_unit:7:NaN'.
    const sug = await getSuggestedMileage(makeDb(table), 7, null);
    expect(sug?.source).toBe('officer');
  });
});

describe('deriveEndMileage + outlier guard', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns null when start_mileage is missing', () => {
    expect(deriveEndMileage(null, 5000)).toBeNull();
    expect(deriveEndMileage(undefined, 5000)).toBeNull();
  });

  it('returns null when distance is missing, zero, or negative', () => {
    expect(deriveEndMileage(92_000, null)).toBeNull();
    expect(deriveEndMileage(92_000, 0)).toBeNull();
    expect(deriveEndMileage(92_000, -500)).toBeNull();
  });

  it('derives end_mileage = start + distance_m/1609.34 rounded to .1', () => {
    // 8 km ≈ 4.97 mi → start (92_000) + 4.97 = 92_004.97 → round to 92_005
    const out = deriveEndMileage(92_000, 8_000);
    expect(out).not.toBeNull();
    expect(out!.endMileage).toBeCloseTo(92_005, 0);
    expect(out!.distanceMi).toBeCloseTo(8_000 / 1609.34, 3);
  });

  it('rounds to one decimal place', () => {
    // 1609.34 m == exactly 1 mile → 92_000.0 + 1.0 = 92_001.0
    const out = deriveEndMileage(92_000, 1609.34);
    expect(out?.endMileage).toBe(92_001);
  });

  it('rejects single-trip distances over the 75 mi outlier threshold', () => {
    // 76 mi → just over the threshold
    const meters = (TRIP_DISTANCE_OUTLIER_MILES + 1) * 1609.34;
    expect(deriveEndMileage(92_000, meters)).toBeNull();
  });

  it('accepts the boundary distance equal to the threshold', () => {
    // exactly 75 mi should still derive — the guard rejects >, not >=.
    const meters = TRIP_DISTANCE_OUTLIER_MILES * 1609.34;
    const out = deriveEndMileage(92_000, meters);
    expect(out).not.toBeNull();
    expect(out!.distanceMi).toBeCloseTo(TRIP_DISTANCE_OUTLIER_MILES, 3);
  });

  it('treats NaN distance as a missing reading, not an outlier', () => {
    expect(deriveEndMileage(92_000, Number.NaN)).toBeNull();
  });

  it('treats Infinity distance as an outlier (rejected)', () => {
    expect(deriveEndMileage(92_000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
