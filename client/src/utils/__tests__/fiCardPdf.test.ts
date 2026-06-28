import { describe, it, expect } from 'vitest';
import { hasActiveWarrant, wrapText } from '../fiCardPdf';

describe('hasActiveWarrant', () => {
  it('detects string-form ACTIVE_WARRANT in an array', () => {
    expect(hasActiveWarrant(['ACTIVE_WARRANT'])).toBe(true);
  });
  it('detects object-form { type: ACTIVE_WARRANT }', () => {
    expect(hasActiveWarrant([{ type: 'ACTIVE_WARRANT', detail: 'misd' }])).toBe(true);
  });
  it('parses JSON strings and detects the flag inside', () => {
    expect(hasActiveWarrant('["ACTIVE_WARRANT"]')).toBe(true);
    expect(hasActiveWarrant('[{"type":"ACTIVE_WARRANT"}]')).toBe(true);
  });
  it('returns false for unrelated flags', () => {
    expect(hasActiveWarrant(['GANG_MEMBER', 'PARTIAL_DOB'])).toBe(false);
    expect(hasActiveWarrant([])).toBe(false);
  });
  it('returns false for malformed JSON or non-array values', () => {
    expect(hasActiveWarrant('not-json-at-all')).toBe(false);
    expect(hasActiveWarrant(null)).toBe(false);
    expect(hasActiveWarrant(undefined)).toBe(false);
    expect(hasActiveWarrant({ not: 'an array' })).toBe(false);
  });
});

describe('wrapText', () => {
  it('returns a single empty entry for an empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('hello world', 20)).toEqual(['hello world']);
  });
  it('wraps at word boundaries', () => {
    // 10-char budget — "one two" = 7, "+three" overruns, breaks before "three"
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    const out = wrapText('first line\nsecond line', 50);
    expect(out).toEqual(['first line', 'second line']);
  });
  it('does not lose data when a single word is longer than the budget', () => {
    // The word is longer than maxChars — it goes through as a single overflow
    // line (better to overflow than drop the data on a court-record PDF).
    const out = wrapText('ANTIDISESTABLISHMENTARIANISM', 10);
    expect(out.length).toBe(1);
    expect(out[0]).toBe('ANTIDISESTABLISHMENTARIANISM');
  });
});
