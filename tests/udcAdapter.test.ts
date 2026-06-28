import { describe, it, expect } from 'vitest';
import { splitUdcName, mapUdcListResult, mapUdcDetail } from '../src/utils/screening/udcApi';
import { udcAdapter } from '../src/utils/screening/udcAdapter';

describe('splitUdcName', () => {
  it('parses "LAST, FIRST MIDDLE" into parts', () => {
    expect(splitUdcName('PEREZ, JEROME JUNIOR')).toEqual({ last: 'PEREZ', first: 'JEROME', middle: 'JUNIOR' });
  });
  it('handles a single comma with one given name', () => {
    expect(splitUdcName('SMITH, JOHN')).toEqual({ last: 'SMITH', first: 'JOHN', middle: '' });
  });
  it('falls back to whole string as last name when no comma', () => {
    expect(splitUdcName('MADONNA')).toEqual({ last: 'MADONNA', first: '', middle: '' });
  });
  it('tolerates empty/undefined', () => {
    expect(splitUdcName('')).toEqual({ last: '', first: '', middle: '' });
  });
});

describe('mapUdcListResult', () => {
  it('maps a list row to a NormalizedCandidate', () => {
    const c = mapUdcListResult({ offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12' });
    expect(c.sourceKey).toBe('utah-doc');
    expect(c.externalId).toBe('128142');
    expect(c.displayName).toBe('PEREZ, JEROME JUNIOR');
    expect(c.dob).toBe('1978-03-12');
    expect(c.listType).toBe('utah-doc');
  });
});

describe('mapUdcDetail', () => {
  it('flattens the detail response wrapper to a row object', () => {
    const row = mapUdcDetail({
      results: {
        offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12',
        location: 'UTAH STATE CORRECTIONAL FACILITY', housingFacility: 'USCF B4',
        releaseDateAndType: 'N/A', caseManagerName: 'BERKELEY T DAY', caseManagerEmail: 'bday@utah.gov',
      },
    });
    expect(row!.offender_number).toBe(128142);
    expect(row!.location).toBe('UTAH STATE CORRECTIONAL FACILITY');
    expect(row!.case_manager_email).toBe('bday@utah.gov');
  });
  it('returns null when no offender number is present', () => {
    expect(mapUdcDetail({ results: {} })).toBeNull();
  });
});

describe('udcAdapter.scoreMatch', () => {
  const person = { id: 1, first_name: 'Jerome', last_name: 'Perez', dob: '1978-03-12' };
  it('confidently matches same surname + forename + DOB age', () => {
    const cand = udcAdapter.normalize({ offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12' });
    const m = udcAdapter.scoreMatch(person as never, cand);
    expect(m.isConfident).toBe(true);
    expect(m.matchedFields).toContain('surname');
  });
  it('does not match a different surname', () => {
    const cand = udcAdapter.normalize({ offenderNumber: 999, offenderName: 'JONES, JEROME', dateOfBirth: '1978-03-12' });
    const m = udcAdapter.scoreMatch(person as never, cand);
    expect(m.score).toBe(0);
  });
});
