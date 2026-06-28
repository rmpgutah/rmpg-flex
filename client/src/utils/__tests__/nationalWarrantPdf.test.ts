import { describe, it, expect } from 'vitest';
import {
  formatWarrantName,
  isActiveWarrant,
  wrapText,
  formatBond,
} from '../nationalWarrantPdf';

describe('formatWarrantName', () => {
  it('uppercases last name + appends first name when both present', () => {
    expect(formatWarrantName({ first_name: 'Jane', last_name: 'Doe' })).toBe('DOE, Jane');
  });
  it('returns just the last name when no first name', () => {
    expect(formatWarrantName({ last_name: 'doe' })).toBe('DOE');
  });
  it('falls back to full_name when structured parts are missing', () => {
    expect(formatWarrantName({ full_name: 'jane q doe' })).toBe('JANE Q DOE');
  });
  it('returns UNKNOWN SUBJECT when nothing usable is provided', () => {
    expect(formatWarrantName({})).toBe('UNKNOWN SUBJECT');
    expect(formatWarrantName({ first_name: '', last_name: '', full_name: '' })).toBe('UNKNOWN SUBJECT');
  });
  it('trims whitespace from parts so "  doe  " does not produce an empty branch', () => {
    expect(formatWarrantName({ first_name: '  Jane  ', last_name: '  Doe  ' })).toBe('DOE, Jane');
  });
});

describe('isActiveWarrant', () => {
  it('returns true for canonical lower-case "active"', () => {
    expect(isActiveWarrant({ status: 'active' })).toBe(true);
  });
  it('returns true for upper- and mixed-case "ACTIVE" / "Active "', () => {
    expect(isActiveWarrant({ status: 'ACTIVE' })).toBe(true);
    expect(isActiveWarrant({ status: ' Active ' })).toBe(true);
  });
  it('returns false for missing / empty / inactive statuses', () => {
    expect(isActiveWarrant({})).toBe(false);
    expect(isActiveWarrant({ status: '' })).toBe(false);
    expect(isActiveWarrant({ status: 'served' })).toBe(false);
    expect(isActiveWarrant({ status: 'recalled' })).toBe(false);
  });
});

describe('formatBond', () => {
  it('returns dash for null/undefined/empty/zero/negative input (no bond shown)', () => {
    expect(formatBond(null)).toBe('—');
    expect(formatBond(undefined)).toBe('—');
    expect(formatBond('')).toBe('—');
    expect(formatBond(0)).toBe('—');
    expect(formatBond(-50)).toBe('—');
  });
  it('formats a positive number with grouping + dollar sign', () => {
    expect(formatBond(1234)).toBe('$1,234');
    expect(formatBond(1000000)).toBe('$1,000,000');
  });
  it('accepts string-typed numbers (upstream is inconsistent)', () => {
    expect(formatBond('5000')).toBe('$5,000');
  });
  it('returns dash for non-numeric strings rather than throwing', () => {
    expect(formatBond('no bond')).toBe('—');
  });
});

describe('wrapText', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('wraps at word boundaries within the budget', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('first\nsecond', 50)).toEqual(['first', 'second']);
  });
  it('overflows rather than dropping when a single token is longer than the budget', () => {
    const out = wrapText('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', 10);
    expect(out).toEqual(['SUPERCALIFRAGILISTICEXPIALIDOCIOUS']);
  });
});
