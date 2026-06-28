import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePhone,
  validateBadgeNumber,
  validateString,
  validateDate,
  validateCoordinates,
  validateNumber,
  validatePositiveInt,
  validateAll,
} from '../../src/utils/inputValidation';

// ────────────────────────────────────────────────────────
// validateEmail
// ────────────────────────────────────────────────────────
describe('validateEmail', () => {
  it('returns null for a valid email', () => {
    expect(validateEmail('user@example.com')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validateEmail('')).toBeNull();
    expect(validateEmail(null)).toBeNull();
    expect(validateEmail(undefined)).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validateEmail('', true)).toBe('Email is required');
    expect(validateEmail(null, true)).toBe('Email is required');
    expect(validateEmail(undefined, true)).toBe('Email is required');
  });

  it('rejects non-string values', () => {
    expect(validateEmail(123)).toBe('Email must be a string');
    expect(validateEmail(true)).toBe('Email must be a string');
    expect(validateEmail({})).toBe('Email must be a string');
  });

  it('rejects emails exceeding 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.co';
    expect(validateEmail(longEmail)).toBe('Email exceeds maximum length (254 chars)');
  });

  it('rejects invalid email formats', () => {
    expect(validateEmail('notanemail')).toBe('Invalid email format');
    expect(validateEmail('missing@domain')).toBe('Invalid email format');
    expect(validateEmail('@nodomain.com')).toBe('Invalid email format');
    expect(validateEmail('spaces in@email.com')).toBe('Invalid email format');
  });

  it('accepts valid email formats', () => {
    expect(validateEmail('user+tag@example.com')).toBeNull();
    expect(validateEmail('first.last@sub.domain.org')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// validatePhone
// ────────────────────────────────────────────────────────
describe('validatePhone', () => {
  it('returns null for valid phone numbers', () => {
    expect(validatePhone('555-1234')).toBeNull();
    expect(validatePhone('(801) 555-1234')).toBeNull();
    expect(validatePhone('+1 801 555 1234')).toBeNull();
    expect(validatePhone('8015551234')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validatePhone('')).toBeNull();
    expect(validatePhone(null)).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validatePhone('', true)).toBe('Phone number is required');
  });

  it('rejects non-string values', () => {
    expect(validatePhone(5551234)).toBe('Phone must be a string');
  });

  it('rejects invalid phone formats', () => {
    expect(validatePhone('ab')).toBe('Invalid phone format'); // too short
    expect(validatePhone('abc-def-ghij')).toBe('Invalid phone format'); // letters
  });
});

// ────────────────────────────────────────────────────────
// validateBadgeNumber
// ────────────────────────────────────────────────────────
describe('validateBadgeNumber', () => {
  it('accepts valid badge numbers', () => {
    expect(validateBadgeNumber('A123')).toBeNull();
    expect(validateBadgeNumber('BADGE-01')).toBeNull();
    expect(validateBadgeNumber('12345')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validateBadgeNumber('')).toBeNull();
    expect(validateBadgeNumber(null)).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validateBadgeNumber('', true)).toBe('Badge number is required');
  });

  it('rejects non-string values', () => {
    expect(validateBadgeNumber(123)).toBe('Badge number must be a string');
  });

  it('rejects invalid badge formats', () => {
    expect(validateBadgeNumber('badge with spaces')).toBe('Invalid badge number format (alphanumeric, 1-20 chars)');
    expect(validateBadgeNumber('a'.repeat(21))).toBe('Invalid badge number format (alphanumeric, 1-20 chars)');
    expect(validateBadgeNumber('badge@#!')).toBe('Invalid badge number format (alphanumeric, 1-20 chars)');
  });
});

// ────────────────────────────────────────────────────────
// validateString
// ────────────────────────────────────────────────────────
describe('validateString', () => {
  it('accepts valid strings within max length', () => {
    expect(validateString('hello', 'Name')).toBeNull();
    expect(validateString('a'.repeat(500), 'Notes')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validateString('', 'Name')).toBeNull();
    expect(validateString(null, 'Name')).toBeNull();
    expect(validateString(undefined, 'Name')).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validateString('', 'Name', 500, true)).toBe('Name is required');
  });

  it('rejects non-string values', () => {
    expect(validateString(42, 'Name')).toBe('Name must be a string');
    expect(validateString([], 'Name')).toBe('Name must be a string');
  });

  it('rejects strings exceeding max length', () => {
    expect(validateString('a'.repeat(501), 'Notes')).toBe('Notes exceeds maximum length (500 chars)');
  });

  it('uses custom max length', () => {
    expect(validateString('ab', 'Code', 1)).toBe('Code exceeds maximum length (1 chars)');
    expect(validateString('a', 'Code', 1)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// validateDate
// ────────────────────────────────────────────────────────
describe('validateDate', () => {
  it('accepts valid dates in YYYY-MM-DD format', () => {
    expect(validateDate('2025-01-15')).toBeNull();
    expect(validateDate('2000-12-31')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validateDate('')).toBeNull();
    expect(validateDate(null)).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validateDate('', 'Start Date', true)).toBe('Start Date is required');
  });

  it('rejects non-string values', () => {
    expect(validateDate(20250115)).toMatch(/must be a string/);
  });

  it('rejects invalid date formats', () => {
    expect(validateDate('01/15/2025')).toMatch(/YYYY-MM-DD/);
    expect(validateDate('2025-1-5')).toMatch(/YYYY-MM-DD/);
    expect(validateDate('not-a-date')).toMatch(/YYYY-MM-DD/);
  });

  it('rejects dates that fail parsing', () => {
    // Month 13 produces NaN date
    expect(validateDate('2025-13-45')).toMatch(/not a valid date/);
    // Note: '2025-02-30' actually parses as a valid Date in JS (rolls over to March)
    // so this validator allows it. Only truly un-parseable dates fail.
    expect(validateDate('0000-00-00')).toMatch(/not a valid date/);
  });
});

// ────────────────────────────────────────────────────────
// validateCoordinates
// ────────────────────────────────────────────────────────
describe('validateCoordinates', () => {
  it('accepts valid coordinates', () => {
    expect(validateCoordinates(40.7608, -111.891)).toBeNull();
    expect(validateCoordinates(0, 0)).toBeNull();
    expect(validateCoordinates(-90, -180)).toBeNull();
    expect(validateCoordinates(90, 180)).toBeNull();
  });

  it('returns null when both are null/undefined and not required', () => {
    expect(validateCoordinates(null, null)).toBeNull();
    expect(validateCoordinates(undefined, undefined)).toBeNull();
  });

  it('returns error when required and both missing', () => {
    expect(validateCoordinates(null, null, true)).toBe('Coordinates are required');
  });

  it('rejects latitude out of range', () => {
    expect(validateCoordinates(91, 0)).toBe('Latitude must be between -90 and 90');
    expect(validateCoordinates(-91, 0)).toBe('Latitude must be between -90 and 90');
  });

  it('rejects longitude out of range', () => {
    expect(validateCoordinates(0, 181)).toBe('Longitude must be between -180 and 180');
    expect(validateCoordinates(0, -181)).toBe('Longitude must be between -180 and 180');
  });

  it('rejects non-numeric values', () => {
    expect(validateCoordinates('abc', 0)).toBe('Latitude must be between -90 and 90');
    expect(validateCoordinates(0, 'xyz')).toBe('Longitude must be between -180 and 180');
  });

  it('accepts string representations of numbers', () => {
    expect(validateCoordinates('40.7608', '-111.891')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// validateNumber
// ────────────────────────────────────────────────────────
describe('validateNumber', () => {
  it('accepts valid numbers', () => {
    expect(validateNumber(42, 'Age')).toBeNull();
    expect(validateNumber(0, 'Score')).toBeNull();
    expect(validateNumber(-5, 'Temp')).toBeNull();
    expect(validateNumber(3.14, 'Pi')).toBeNull();
  });

  it('accepts string numbers', () => {
    expect(validateNumber('42', 'Age')).toBeNull();
    expect(validateNumber('3.14', 'Pi')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validateNumber('', 'Age')).toBeNull();
    expect(validateNumber(null, 'Age')).toBeNull();
    expect(validateNumber(undefined, 'Age')).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validateNumber('', 'Age', -Infinity, Infinity, true)).toBe('Age is required');
  });

  it('rejects non-numeric values', () => {
    expect(validateNumber('abc', 'Age')).toBe('Age must be a valid number');
    expect(validateNumber(NaN, 'Age')).toBe('Age must be a valid number');
    expect(validateNumber(Infinity, 'Age')).toBe('Age must be a valid number');
  });

  it('rejects values outside range', () => {
    expect(validateNumber(0, 'Age', 1, 120)).toBe('Age must be between 1 and 120');
    expect(validateNumber(121, 'Age', 1, 120)).toBe('Age must be between 1 and 120');
  });

  it('accepts values at boundaries', () => {
    expect(validateNumber(1, 'Age', 1, 120)).toBeNull();
    expect(validateNumber(120, 'Age', 1, 120)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// validatePositiveInt
// ────────────────────────────────────────────────────────
describe('validatePositiveInt', () => {
  it('accepts positive integers', () => {
    expect(validatePositiveInt(1)).toBeNull();
    expect(validatePositiveInt(100)).toBeNull();
    expect(validatePositiveInt('42')).toBeNull();
  });

  it('returns null for empty when not required', () => {
    expect(validatePositiveInt('')).toBeNull();
    expect(validatePositiveInt(null)).toBeNull();
  });

  it('returns error when empty and required', () => {
    expect(validatePositiveInt('', 'ID', true)).toBe('ID is required');
  });

  it('rejects zero and negative numbers', () => {
    expect(validatePositiveInt(0)).toBe('Value must be a positive integer');
    expect(validatePositiveInt(-1)).toBe('Value must be a positive integer');
  });

  it('rejects non-numeric strings', () => {
    expect(validatePositiveInt('abc')).toBe('Value must be a positive integer');
  });

  it('truncates floats via parseInt (accepts 3.14 as 3)', () => {
    // parseInt('3.14') returns 3, which is a valid positive integer
    expect(validatePositiveInt(3.14)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// validateAll
// ────────────────────────────────────────────────────────
describe('validateAll', () => {
  it('returns null when all validators pass', () => {
    expect(validateAll(null, null, null)).toBeNull();
  });

  it('returns null with no arguments', () => {
    expect(validateAll()).toBeNull();
  });

  it('returns the first error found', () => {
    expect(validateAll(null, 'Error A', 'Error B')).toBe('Error A');
    expect(validateAll('Error X', null, 'Error Y')).toBe('Error X');
  });

  it('works with actual validators', () => {
    const result = validateAll(
      validateEmail('valid@email.com'),
      validatePhone('555-1234'),
      validateString('ok', 'Name'),
    );
    expect(result).toBeNull();
  });

  it('catches first failure from validators', () => {
    const result = validateAll(
      validateEmail('valid@email.com'),
      validatePhone('not valid!!!!!!!!!!!!!!!!!!!!!'),
      validateString('ok', 'Name'),
    );
    expect(result).toBe('Invalid phone format');
  });
});
