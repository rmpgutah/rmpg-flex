import { describe, it, expect } from 'vitest';
import {
  formatHeight,
  formatWeight,
  formatBail,
  prettyStatus,
  isInCustody,
  bookingConsistencyAlert,
} from '../jailBookingSheetPdf';

describe('formatHeight', () => {
  it('converts inches to feet-and-inches', () => {
    expect(formatHeight(71)).toBe("5'11\"");
    expect(formatHeight(72)).toBe("6'0\"");
    expect(formatHeight(60)).toBe("5'0\"");
  });
  it('accepts string inputs', () => {
    expect(formatHeight('71')).toBe("5'11\"");
  });
  it('returns em-dash for missing / zero / non-numeric', () => {
    expect(formatHeight(undefined)).toBe('—');
    expect(formatHeight(null)).toBe('—');
    expect(formatHeight('')).toBe('—');
    expect(formatHeight(0)).toBe('—');
    expect(formatHeight('not a number')).toBe('—');
  });
  it('renders sub-foot values raw rather than misrendering 7-inch infants', () => {
    expect(formatHeight(7)).toBe('7"');
    expect(formatHeight(11)).toBe('11"');
  });
});

describe('formatWeight', () => {
  it('appends lbs unit', () => {
    expect(formatWeight(180)).toBe('180 lbs');
    expect(formatWeight('200')).toBe('200 lbs');
  });
  it('returns em-dash for missing / zero', () => {
    expect(formatWeight(undefined)).toBe('—');
    expect(formatWeight(null)).toBe('—');
    expect(formatWeight('')).toBe('—');
    expect(formatWeight(0)).toBe('—');
  });
});

describe('formatBail', () => {
  it('formats positive amounts as USD currency', () => {
    expect(formatBail(5000)).toBe('$5,000.00');
    expect(formatBail('1500.50')).toBe('$1,500.50');
  });
  it('flags zero as NO BAIL', () => {
    expect(formatBail(0)).toBe('NO BAIL');
    expect(formatBail('0')).toBe('NO BAIL');
  });
  it('returns em-dash for missing / non-numeric', () => {
    expect(formatBail(undefined)).toBe('—');
    expect(formatBail(null)).toBe('—');
    expect(formatBail('')).toBe('—');
    expect(formatBail('not a number')).toBe('—');
  });
});

describe('prettyStatus', () => {
  it('uppercases snake_case status', () => {
    expect(prettyStatus('booked')).toBe('BOOKED');
    expect(prettyStatus('in_court')).toBe('IN COURT');
  });
  it('returns em-dash for missing', () => {
    expect(prettyStatus(undefined)).toBe('—');
    expect(prettyStatus(null)).toBe('—');
    expect(prettyStatus('')).toBe('—');
  });
});

describe('isInCustody', () => {
  it('returns true for live-housing states', () => {
    expect(isInCustody('booked')).toBe(true);
    expect(isInCustody('housed')).toBe(true);
    expect(isInCustody('court')).toBe(true);
    expect(isInCustody('medical')).toBe(true);
  });
  it('returns false for terminal states', () => {
    expect(isInCustody('released')).toBe(false);
    expect(isInCustody('transferred')).toBe(false);
  });
  it('handles mixed case + missing', () => {
    expect(isInCustody('HOUSED')).toBe(true);
    expect(isInCustody(undefined)).toBe(false);
    expect(isInCustody(null)).toBe(false);
    expect(isInCustody('')).toBe(false);
  });
});

describe('bookingConsistencyAlert', () => {
  it('returns null for an internally consistent record', () => {
    expect(bookingConsistencyAlert({ status: 'housed' })).toBeNull();
    expect(bookingConsistencyAlert({ status: 'released', release_date: '2026-06-22T10:00:00Z' })).toBeNull();
  });
  it('flags release_date with an in-custody status', () => {
    const msg = bookingConsistencyAlert({
      status: 'housed',
      release_date: '2026-06-22T10:00:00Z',
    });
    expect(msg).toContain('RELEASE DATE RECORDED');
    expect(msg).toContain('HOUSED');
  });
  it('flags released status with no release_date', () => {
    const msg = bookingConsistencyAlert({ status: 'released' });
    expect(msg).toContain('NO RELEASE DATE RECORDED');
  });
  it('does not flag a released record with a recorded release date', () => {
    expect(bookingConsistencyAlert({
      status: 'released',
      release_date: '2026-06-22T10:00:00Z',
    })).toBeNull();
  });
});
