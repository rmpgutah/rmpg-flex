import { describe, it, expect } from 'vitest';
import { normalizeName, ageFromDob, scoreNameMatch, scoreSanctionMatch } from '../src/utils/screening/scoring';

describe('normalizeName', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(normalizeName('  José-María  O\'Brien ')).toBe('jose maria o brien');
  });
  it('returns empty string for nullish', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('ageFromDob', () => {
  it('derives age from the birth year', () => {
    expect(ageFromDob('1985-04-12', 2026)).toBe(41);
  });
  it('returns null when dob missing or malformed', () => {
    expect(ageFromDob(null, 2026)).toBeNull();
    expect(ageFromDob('unknown', 2026)).toBeNull();
  });
});

describe('scoreNameMatch', () => {
  const base = {
    personSurname: 'Petrov', personForename: 'Ivan', personAge: 40, personNationality: 'RU',
    candSurname: 'Petrov', candForename: 'Ivan', candAgeMin: 39, candAgeMax: 41,
    candNationalities: ['RU'],
  };
  it('scores a full match as confident', () => {
    const r = scoreNameMatch(base, 0.8);
    expect(r.isConfident).toBe(true);
    expect(r.matchedFields).toEqual(expect.arrayContaining(['surname', 'forename', 'age', 'nationality']));
  });
  it('requires a surname match — different surname scores 0', () => {
    const r = scoreNameMatch({ ...base, candSurname: 'Ivanov' }, 0.8);
    expect(r.score).toBe(0);
    expect(r.isConfident).toBe(false);
  });
  it('forename initial alone is not enough to be confident', () => {
    const r = scoreNameMatch(
      { ...base, candForename: 'Igor', personAge: null, candAgeMin: null, candAgeMax: null, personNationality: null },
      0.8,
    );
    expect(r.matchedFields).toContain('forename-initial');
    expect(r.isConfident).toBe(false);
  });
  it('respects a configurable threshold', () => {
    const input = { ...base, candForename: 'Igor', personNationality: null }; // surname+initial+age = 0.6+0.1+0.15
    expect(scoreNameMatch(input, 0.9).isConfident).toBe(false);
    expect(scoreNameMatch(input, 0.8).isConfident).toBe(true);
  });
});

describe('scoreSanctionMatch', () => {
  it('confident when all person name tokens appear in the candidate name', () => {
    const r = scoreSanctionMatch('Petrov', 'Ivan', 'PETROV, Ivan Sergeyevich', 0.8);
    expect(r.isConfident).toBe(true);
    expect(r.matchedFields).toContain('surname');
  });
  it('not confident when surname token is absent', () => {
    const r = scoreSanctionMatch('Petrov', 'Ivan', 'Smith, John', 0.8);
    expect(r.isConfident).toBe(false);
  });
});
