import { describe, it, expect } from 'vitest';
import { validatePassword, DEFAULT_SECURITY_POLICY } from '../src/utils/securityPolicy';

describe('auth.ts password policy integration', () => {
  it('DEFAULT_SECURITY_POLICY still requires the same 4 character classes auth.ts historically enforced', () => {
    // Locks in that Task 1's default matches the pre-existing validateNewPassword
    // behavior this task removes — a regression here means a live behavior change.
    expect(validatePassword('short1!', DEFAULT_SECURITY_POLICY)).toBe('Password must be at least 8 characters');
    expect(validatePassword('alllowercase1!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain an uppercase letter');
    expect(validatePassword('ALLUPPERCASE1!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a lowercase letter');
    expect(validatePassword('NoDigitsHere!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a number');
    expect(validatePassword('NoSpecialChar1', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a special character');
    expect(validatePassword('ValidPassword1!', DEFAULT_SECURITY_POLICY)).toBeNull();
  });
});
