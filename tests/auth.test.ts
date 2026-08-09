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

describe('lockout policy defaults', () => {
  it('DEFAULT_SECURITY_POLICY.maxLoginAttempts matches the pre-existing FAILED_LOGIN_THRESHOLD (5)', () => {
    expect(DEFAULT_SECURITY_POLICY.maxLoginAttempts).toBe(5);
  });
  it('DEFAULT_SECURITY_POLICY.lockoutDurationMinutes matches the pre-existing LOCKOUT_DURATION_MINUTES (15)', () => {
    expect(DEFAULT_SECURITY_POLICY.lockoutDurationMinutes).toBe(15);
  });
});

describe('createSession session cap', () => {
  it('DEFAULT_SECURITY_POLICY.maxActiveSessions is 0 (unenforced) by default', () => {
    // Today, before this task, there is NO session cap anywhere in the codebase.
    // 0 means "don't enforce" so an admin who has never touched this section
    // sees no behavior change — matches the binding constraint in Task 1.
    expect(DEFAULT_SECURITY_POLICY.maxActiveSessions).toBe(0);
  });
});
