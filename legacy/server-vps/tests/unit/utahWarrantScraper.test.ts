import { describe, it, expect } from 'vitest';
import { computeAgeFromDob } from '../../src/utils/utahWarrantScraper';

describe('computeAgeFromDob', () => {
  it('returns correct age before birthday', () => {
    // Born Dec 31 1990, today is Dec 30 2026 → age 35 (not 36)
    const age = computeAgeFromDob('1990-12-31', new Date('2026-12-30'));
    expect(age).toBe(35);
  });

  it('returns correct age on birthday', () => {
    const age = computeAgeFromDob('1990-12-31', new Date('2026-12-31'));
    expect(age).toBe(36);
  });

  it('returns correct age after birthday', () => {
    const age = computeAgeFromDob('1990-12-31', new Date('2027-01-02'));
    expect(age).toBe(36);
  });

  it('returns correct age in same-year month comparison', () => {
    // Born June 15, today is June 14 — not yet 36
    const age = computeAgeFromDob('1990-06-15', new Date('2026-06-14'));
    expect(age).toBe(35);
  });

  it('returns correct age on same day as birthday', () => {
    const age = computeAgeFromDob('1990-06-15', new Date('2026-06-15'));
    expect(age).toBe(36);
  });

  it('returns null for invalid DOB', () => {
    expect(computeAgeFromDob('not-a-date')).toBeNull();
    expect(computeAgeFromDob('')).toBeNull();
  });
});
