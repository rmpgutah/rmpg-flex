// tests/securityPolicy.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SECURITY_POLICY, getSecurityPolicy, validatePassword } from '../src/utils/securityPolicy';

describe('validatePassword', () => {
  const policy = { ...DEFAULT_SECURITY_POLICY };

  it('rejects passwords shorter than minPasswordLength', () => {
    expect(validatePassword('Ab1!', policy)).toBe('Password must be at least 8 characters');
  });

  it('rejects missing uppercase when required', () => {
    expect(validatePassword('lowercase1!', policy)).toBe('Password must contain an uppercase letter');
  });

  it('rejects missing lowercase (always required)', () => {
    expect(validatePassword('UPPERCASE1!', policy)).toBe('Password must contain a lowercase letter');
  });

  it('rejects missing number when required', () => {
    expect(validatePassword('NoNumbers!', policy)).toBe('Password must contain a number');
  });

  it('rejects missing special char when required', () => {
    expect(validatePassword('NoSpecial1', policy)).toBe('Password must contain a special character');
  });

  it('accepts a password satisfying every rule', () => {
    expect(validatePassword('Valid1Password!', policy)).toBeNull();
  });

  it('skips the uppercase check when the policy disables it', () => {
    const relaxed = { ...policy, requireUppercase: false };
    expect(validatePassword('lowercase1!', relaxed)).toBeNull();
  });

  it('honors a shorter minPasswordLength from the policy', () => {
    const shorter = { ...policy, minPasswordLength: 6 };
    expect(validatePassword('Ab1!cd', shorter)).toBeNull();
  });
});

describe('getSecurityPolicy', () => {
  it('returns DEFAULT_SECURITY_POLICY when no row is saved', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy).toEqual(DEFAULT_SECURITY_POLICY);
  });

  it('parses a saved security_config row and clamps out-of-range values', async () => {
    const saved = JSON.stringify({
      min_password_length: '10',
      require_uppercase: '0',
      require_numbers: '1',
      require_special_chars: '1',
      max_login_attempts: '999',       // out of UI range (1-20) — clamp to 20
      lockout_duration_minutes: '0',   // out of UI range (1-1440) — clamp to 1
      max_active_sessions: '3',
      password_expiry_days: '90',
    });
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({ config_value: saved }) }) }),
    } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy.minPasswordLength).toBe(10);
    expect(policy.requireUppercase).toBe(false);
    expect(policy.requireNumbers).toBe(true);
    expect(policy.requireSpecialChars).toBe(true);
    expect(policy.maxLoginAttempts).toBe(20);
    expect(policy.lockoutDurationMinutes).toBe(1);
    expect(policy.maxActiveSessions).toBe(3);
    expect(policy.passwordExpiryDays).toBe(90);
  });

  it('falls back to defaults when the saved value is malformed JSON', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({ config_value: 'not json' }) }) }),
    } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy).toEqual(DEFAULT_SECURITY_POLICY);
  });
});
