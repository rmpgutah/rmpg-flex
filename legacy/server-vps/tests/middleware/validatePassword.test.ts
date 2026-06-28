import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bcryptjs before importing the module under test
vi.mock('bcryptjs', () => ({
  default: {
    compareSync: vi.fn(),
  },
}));

// Force requireSpecial=true so tests are deterministic regardless of .env
vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: { ...actual.default, password: { ...actual.default.password, requireSpecial: true } },
  };
});

import { validatePassword, checkPasswordHistory, isPasswordExpired, getPasswordPolicyDescription } from '../../src/middleware/validatePassword';
import bcryptjs from 'bcryptjs';

// ────────────────────────────────────────────────────────
// validatePassword
// ────────────────────────────────────────────────────────
describe('validatePassword', () => {
  it('accepts a strong password', () => {
    const result = validatePassword('Str0ng!P@ssw0rd');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects empty/falsy password', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password is required');
  });

  it('rejects null/undefined', () => {
    const result = validatePassword(null as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password is required');
  });

  it('rejects password shorter than minimum length', () => {
    // Config default is 12 characters
    const result = validatePassword('Str0ng!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at least'))).toBe(true);
  });

  it('rejects password exceeding 128 characters (bcrypt DoS prevention)', () => {
    const long = 'A1!' + 'a'.repeat(126); // 129 chars
    const result = validatePassword(long);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('128'))).toBe(true);
  });

  it('rejects password without uppercase letter', () => {
    const result = validatePassword('str0ng!p@ssw0rd');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
  });

  it('rejects password without lowercase letter', () => {
    const result = validatePassword('STR0NG!P@SSW0RD');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
  });

  it('rejects password without number', () => {
    const result = validatePassword('StrongPassword!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('number'))).toBe(true);
  });

  it('rejects password without special character', () => {
    const result = validatePassword('Str0ngPassword1');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('special'))).toBe(true);
  });

  it('rejects common passwords from blocklist', () => {
    const commonPasswords = [
      'password',
      'admin123',
      'police',
      'officer',
      'dispatch',
      'rmpgflex',
      'badge123',
      'sergeant',
      'detective',
      'trooper',
      'sheriff',
      'rmpg2025',
    ];
    for (const pw of commonPasswords) {
      const result = validatePassword(pw);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('common'))).toBe(true);
    }
  });

  it('blocklist is case-insensitive', () => {
    const result = validatePassword('PASSWORD');
    expect(result.errors.some(e => e.includes('common'))).toBe(true);
  });

  it('can return multiple errors at once', () => {
    const result = validatePassword('a');
    expect(result.valid).toBe(false);
    // Short, no uppercase, no number, no special
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('rejects law-enforcement-specific common passwords', () => {
    const lePws = ['badge123', 'sergeant', 'detective', 'trooper', 'sheriff', 'rmpg2025'];
    for (const pw of lePws) {
      const result = validatePassword(pw);
      expect(result.errors.some(e => e.includes('common'))).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────
// checkPasswordHistory
// ────────────────────────────────────────────────────────
describe('checkPasswordHistory', () => {
  beforeEach(() => {
    vi.mocked(bcryptjs.compareSync).mockReset();
  });

  it('returns true when password matches a history hash', () => {
    vi.mocked(bcryptjs.compareSync).mockReturnValueOnce(true);
    const result = checkPasswordHistory('newPass', ['hash1', 'hash2']);
    expect(result).toBe(true);
    expect(bcryptjs.compareSync).toHaveBeenCalledWith('newPass', 'hash1');
  });

  it('returns false when password does not match any history hash', () => {
    vi.mocked(bcryptjs.compareSync).mockReturnValue(false);
    const result = checkPasswordHistory('newPass', ['hash1', 'hash2', 'hash3']);
    expect(result).toBe(false);
    expect(bcryptjs.compareSync).toHaveBeenCalledTimes(3);
  });

  it('returns false for empty history', () => {
    const result = checkPasswordHistory('newPass', []);
    expect(result).toBe(false);
    expect(bcryptjs.compareSync).not.toHaveBeenCalled();
  });

  it('stops checking after first match', () => {
    vi.mocked(bcryptjs.compareSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const result = checkPasswordHistory('newPass', ['hash1', 'hash2', 'hash3']);
    expect(result).toBe(true);
    expect(bcryptjs.compareSync).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────────────────
// isPasswordExpired
// ────────────────────────────────────────────────────────
describe('isPasswordExpired', () => {
  it('returns false when expiry is disabled (expiryDays <= 0)', () => {
    expect(isPasswordExpired('2020-01-01', 0)).toBe(false);
    expect(isPasswordExpired('2020-01-01', -1)).toBe(false);
  });

  it('returns true when passwordChangedAt is null (never changed)', () => {
    expect(isPasswordExpired(null)).toBe(true);
  });

  it('returns true for expired password', () => {
    // 100 days ago with 90-day expiry
    const date = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPasswordExpired(date, 90)).toBe(true);
  });

  it('returns false for non-expired password', () => {
    // Changed today with 90-day expiry
    const date = new Date().toISOString();
    expect(isPasswordExpired(date, 90)).toBe(false);
  });

  it('returns false for password changed recently within expiry window', () => {
    // Changed 89 days ago with 90-day expiry — not yet expired
    const date = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPasswordExpired(date, 90)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// getPasswordPolicyDescription
// ────────────────────────────────────────────────────────
describe('getPasswordPolicyDescription', () => {
  it('returns a non-empty string', () => {
    const desc = getPasswordPolicyDescription();
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });

  it('mentions minimum length', () => {
    const desc = getPasswordPolicyDescription();
    expect(desc).toMatch(/at least \d+ characters/i);
  });

  it('mentions uppercase requirement', () => {
    const desc = getPasswordPolicyDescription();
    expect(desc).toMatch(/uppercase/i);
  });

  it('mentions password history', () => {
    const desc = getPasswordPolicyDescription();
    expect(desc).toMatch(/reuse/i);
  });
});
