// Unit tests for the formatters utility — locks the input-masking
// contract used by every phone/fax field across the app.

import { describe, it, expect } from 'vitest';
import { formatPhoneInput, formatPhone } from '../formatters';

describe('formatPhoneInput (live input masking)', () => {
  it('returns empty string for empty input', () => {
    expect(formatPhoneInput('')).toBe('');
  });

  it('progressively formats as the user types', () => {
    expect(formatPhoneInput('8')).toBe('(8');
    expect(formatPhoneInput('801')).toBe('(801');
    expect(formatPhoneInput('8015')).toBe('(801) 5');
    expect(formatPhoneInput('801555')).toBe('(801) 555');
    expect(formatPhoneInput('8015551')).toBe('(801) 555-1');
    expect(formatPhoneInput('8015551234')).toBe('(801) 555-1234');
  });

  it('strips non-digit characters', () => {
    expect(formatPhoneInput('801-555-1234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('(801) 555 1234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('801.555.1234')).toBe('(801) 555-1234');
  });

  it('strips a leading 1 country code', () => {
    expect(formatPhoneInput('18015551234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('+1 (801) 555-1234')).toBe('(801) 555-1234');
  });

  it('caps input at 10 digits — extra digits are ignored', () => {
    expect(formatPhoneInput('80155512349999')).toBe('(801) 555-1234');
  });

  it('is idempotent on already-formatted values', () => {
    const out = formatPhoneInput('(801) 555-1234');
    expect(formatPhoneInput(out)).toBe('(801) 555-1234');
  });
});

describe('formatPhone (display formatter)', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
    expect(formatPhone('')).toBe('');
  });

  it('formats raw 10-digit strings', () => {
    expect(formatPhone('8015551234')).toBe('(801) 555-1234');
  });

  it('strips a leading 1 from 11-digit numbers', () => {
    expect(formatPhone('18015551234')).toBe('(801) 555-1234');
  });

  it('returns the raw input when it cannot be formatted', () => {
    expect(formatPhone('123')).toBe('123');
    expect(formatPhone('extension 1234')).toBe('extension 1234');
  });
});
