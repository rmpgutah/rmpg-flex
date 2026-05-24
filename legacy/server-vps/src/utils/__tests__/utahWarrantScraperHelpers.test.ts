// ============================================================
// Utah Warrant Scraper — input-sanitisation helpers
// ============================================================
// warrants.utah.gov rejects HTTP requests containing non-ASCII
// payloads or organization-shaped names with HTTP 400. These
// helpers prevent us from making doomed requests in the first
// place — saves rate-limit budget and keeps the scan log clean.
// ============================================================

import { describe, it, expect } from 'vitest';
import { asciiFoldName, looksLikeOrganization, computeAgeFromDob } from '../utahWarrantScraper';

describe('asciiFoldName', () => {
  it('strips combining diacritics', () => {
    expect(asciiFoldName('JOSÉ')).toBe('JOSE');
    expect(asciiFoldName('Müller')).toBe('Muller');
    expect(asciiFoldName('FRANÇOIS')).toBe('FRANCOIS');
  });

  it('drops non-ASCII characters that have no decomposition', () => {
    // 漢字 has no NFD decomposition into ASCII — entire string vanishes.
    expect(asciiFoldName('漢字')).toBe('');
    // Emoji are stripped, surrounding ASCII preserved.
    expect(asciiFoldName('John 👋 Smith')).toBe('John  Smith');
  });

  it('passes through pure ASCII unchanged', () => {
    expect(asciiFoldName('JOHN SMITH')).toBe('JOHN SMITH');
    expect(asciiFoldName("O'CONNOR")).toBe("O'CONNOR");
    expect(asciiFoldName('MARY-JANE')).toBe('MARY-JANE');
  });

  it('trims surrounding whitespace', () => {
    expect(asciiFoldName('  JOSE  ')).toBe('JOSE');
    expect(asciiFoldName('\tJOSÉ\n')).toBe('JOSE');
  });

  it('returns empty string for empty / whitespace-only input', () => {
    expect(asciiFoldName('')).toBe('');
    expect(asciiFoldName('   ')).toBe('');
  });
});

describe('looksLikeOrganization', () => {
  it('flags rows with parentheses', () => {
    // The bug we caught: last_name "(Organization)" sorts FIRST in scan order
    // because '(' is ASCII 40, breaking every scan from the very first row.
    expect(looksLikeOrganization('Capital One', '(Organization)')).toBe(true);
    expect(looksLikeOrganization('John (LLC)', 'Smith')).toBe(true);
  });

  it('flags rows with commas', () => {
    expect(
      looksLikeOrganization('Capital One, N.A., successor by merger to Discover Bank', '(Organization)')
    ).toBe(true);
    expect(looksLikeOrganization('Smith, John', 'Doe')).toBe(true);
  });

  it('flags overly long names', () => {
    expect(looksLikeOrganization('A'.repeat(31), 'Smith')).toBe(true);
    expect(looksLikeOrganization('John', 'B'.repeat(31))).toBe(true);
  });

  it('passes real human names', () => {
    expect(looksLikeOrganization('John', 'Smith')).toBe(false);
    expect(looksLikeOrganization("O'CONNOR", 'McDonald')).toBe(false);
    expect(looksLikeOrganization('Mary-Jane', 'Watson')).toBe(false);
    expect(looksLikeOrganization('Christopher', 'Krueger')).toBe(false);
    // 30-char boundary — real (very rare) name still admitted.
    expect(looksLikeOrganization('A'.repeat(30), 'B'.repeat(30))).toBe(false);
  });
});

describe('computeAgeFromDob (regression — already tested elsewhere)', () => {
  it('returns null for invalid DOB', () => {
    expect(computeAgeFromDob('')).toBe(null);
    expect(computeAgeFromDob('not-a-date')).toBe(null);
  });

  it('subtracts 1 when birthday has not yet occurred this year', () => {
    // Pinned now: 2026-04-25 → DOB 2000-12-25 → age 25 (birthday in Dec)
    expect(computeAgeFromDob('2000-12-25', new Date('2026-04-25'))).toBe(25);
    // After birthday → age 26
    expect(computeAgeFromDob('2000-12-25', new Date('2026-12-26'))).toBe(26);
  });
});
