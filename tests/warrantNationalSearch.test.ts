import { describe, it, expect, vi, afterEach } from 'vitest';
import { US_STATES, matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../src/utils/warrantNationalSearch';

describe('US_STATES', () => {
  it('has exactly 51 entries (50 states + DC)', () => {
    expect(US_STATES).toHaveLength(51);
  });

  it('includes Utah and DC with correct shape', () => {
    expect(US_STATES.find((s) => s.code === 'UT')).toEqual({ code: 'UT', name: 'Utah' });
    expect(US_STATES.find((s) => s.code === 'DC')).toEqual({ code: 'DC', name: 'District of Columbia' });
  });
});

describe('matchesDobOrAge', () => {
  afterEach(() => vi.useRealTimers());
  it('returns true when no query dob was provided (name-only fallback)', () => {
    expect(matchesDobOrAge(null, { dob: null, age: null })).toBe(true);
    expect(matchesDobOrAge(null, { dob: '1990-01-01', age: null })).toBe(true);
  });

  it('returns true when US-formatted query dob matches an ISO record dob', () => {
    expect(matchesDobOrAge('10/11/2001', { dob: '2001-10-11', age: null })).toBe(true);
  });

  it('returns false when the record dob does not match the query dob', () => {
    expect(matchesDobOrAge('1990-05-12', { dob: '1985-01-01', age: null })).toBe(false);
  });

  it('returns true when the record has only age and it falls within +/-1 year of the query dob\'s computed age', () => {
    // Pin "now" to 2026-07-18T12:00:00Z so ageFromDob is deterministic.
    vi.useFakeTimers({ now: new Date('2026-07-18T12:00:00Z').getTime() });
    // Query dob of exactly 30 years before "now" (2026-07-18 → 1996-07-18).
    const dobStr = '1996-07-18';
    expect(matchesDobOrAge(dobStr, { dob: null, age: 30 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 29 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 31 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 25 })).toBe(false);
    vi.useRealTimers();
  });

  it('returns false when the record has neither dob nor age but the query supplied a dob', () => {
    expect(matchesDobOrAge('1990-05-12', { dob: null, age: null })).toBe(false);
  });
});

describe('mapScrapedWarrantRow', () => {
  it('maps every scraped_warrants column to the client Warrant shape, passing through extras unchanged', () => {
    const row = {
      id: 5, source_key: 'arcgis-arlington-tx', full_name: 'John Doe', first_name: 'John',
      last_name: 'Doe', middle_name: null, date_of_birth: '1990-05-12', age: 35,
      warrant_type: 'arrest', charge_description: 'Theft', court_name: 'Arlington Municipal',
      case_number: 'CR-123', bail_amount: 500, offense_level: 'misdemeanor', issue_date: '2026-01-01',
      status: 'active', warrant_id: 'W-1', person_id: null, gender: 'M', race: 'White',
      city: 'Arlington', state: 'TX', photo_url: null, detail_url: 'https://example.com/1',
      first_seen_at: '2026-01-01', last_seen_at: '2026-07-01', cleared_at: null, dob_verified: 0,
    };
    const mapped = mapScrapedWarrantRow(row);
    expect(mapped.dob).toBe('1990-05-12');
    expect(mapped.charge).toBe('Theft');
    expect(mapped.court).toBe('Arlington Municipal');
    expect(mapped.source).toBe('arcgis-arlington-tx');
    // Extras pass through under their own column name, not dropped.
    expect((mapped as unknown as Record<string, unknown>).city).toBe('Arlington');
    expect((mapped as unknown as Record<string, unknown>).case_number).toBe('CR-123');
  });
});

describe('mapLocalWarrantRow', () => {
  it('maps every warrants column to the client Warrant shape', () => {
    const row = {
      id: 9, warrant_number: 'RMPG-1', type: 'arrest', status: 'active',
      subject_first_name: 'Jane', subject_last_name: 'Smith', subject_dob: '1985-03-01',
      offense: 'Assault', offense_description: 'Simple assault', charge_description: 'Assault',
      issuing_court: 'RMPG Court', bond_amount: 1000, bail_amount: null, issued_date: '2026-02-01',
      offense_level: 'felony', warrant_type: 'arrest',
    };
    const mapped = mapLocalWarrantRow(row);
    expect(mapped.dob).toBe('1985-03-01');
    expect(mapped.court).toBe('RMPG Court');
    expect(mapped.source).toBe('local');
    expect((mapped as unknown as Record<string, unknown>).warrant_number).toBe('RMPG-1');
  });
});
