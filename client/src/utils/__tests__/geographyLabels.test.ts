import { describe, it, expect } from 'vitest';
import { TIER_LABELS, getSectorColor, getZoneColor, formatBeatLabel } from '../geographyLabels';

describe('TIER_LABELS', () => {
  it('uses the DB-canonical tier names, not Section/City', () => {
    expect(TIER_LABELS).toEqual({ area: 'Area', sector: 'Sector', zone: 'Zone', beat: 'Beat' });
  });
});

// Regression test: migrations/0012_seed_geography.sql seeded beat_descriptor
// as an exact copy of beat_name for all 719 beats, so every beat rendered as
// "Midvale A-1 — Midvale A-1" wherever this concatenation ran unguarded.
describe('formatBeatLabel', () => {
  it('does not append a descriptor identical to the name', () => {
    expect(formatBeatLabel('Midvale A-1', 'Midvale A-1')).toBe('Midvale A-1');
  });

  it('appends a descriptor that differs from the name', () => {
    expect(formatBeatLabel('Midvale A-1', 'Downtown corridor')).toBe('Midvale A-1 — Downtown corridor');
  });

  it('does not append when descriptor is null', () => {
    expect(formatBeatLabel('Midvale A-1', null)).toBe('Midvale A-1');
  });

  it('does not append when descriptor is undefined', () => {
    expect(formatBeatLabel('Midvale A-1', undefined)).toBe('Midvale A-1');
  });

  it('does not append when descriptor is an empty string', () => {
    expect(formatBeatLabel('Midvale A-1', '')).toBe('Midvale A-1');
  });
});

describe('getSectorColor', () => {
  it('returns the mapped color for a known sector code', () => {
    expect(getSectorColor('SL1')).toBe('#22c55e');
  });

  it('returns a deterministic fallback color for an unknown code', () => {
    expect(getSectorColor('ZZ9')).toBe(getSectorColor('ZZ9'));
  });

  it('returns a fallback for an empty code without throwing', () => {
    expect(typeof getSectorColor('')).toBe('string');
  });
});

describe('getZoneColor', () => {
  it('returns a deterministic color for a given zone code', () => {
    expect(getZoneColor('MID')).toBe(getZoneColor('MID'));
  });

  it('returns a non-empty string for an empty code without throwing', () => {
    expect(typeof getZoneColor('')).toBe('string');
  });
});
