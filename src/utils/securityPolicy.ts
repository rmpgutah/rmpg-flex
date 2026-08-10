// src/utils/securityPolicy.ts
//
// Reads the Security Policy section of Admin → System Config
// (system_config: category='security_settings', config_key='security_config',
// JSON-stringified SecurityConfig — see client/src/pages/admin/AdminSystemTab.tsx)
// and turns it into a validated, clamped policy for auth.ts / personnel.ts to enforce.

export interface SecurityPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  maxActiveSessions: number; // 0 = no cap enforced
  passwordExpiryDays: number; // 0 = disabled
}

// Reproduces auth.ts's ACTUAL hardcoded behavior today (validateNewPassword,
// FAILED_LOGIN_THRESHOLD, LOCKOUT_DURATION_MINUTES) — NOT the client form's
// DEFAULT_SECURITY object, which has require_special_chars: '0'. An admin who
// has never touched this section must see no behavior change.
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  minPasswordLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  maxActiveSessions: 0,
  passwordExpiryDays: 0,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

interface RawSecurityConfig {
  min_password_length?: string;
  require_uppercase?: string;
  require_numbers?: string;
  require_special_chars?: string;
  max_login_attempts?: string;
  lockout_duration_minutes?: string;
  max_active_sessions?: string;
  password_expiry_days?: string;
}

export async function getSecurityPolicy(db: D1Database): Promise<SecurityPolicy> {
  const row = await db
    .prepare(
      `SELECT config_value FROM system_config
       WHERE category = 'security_settings' AND config_key = 'security_config' AND is_active = 1
       LIMIT 1`,
    )
    .bind()
    .first<{ config_value: string }>();

  if (!row?.config_value) return { ...DEFAULT_SECURITY_POLICY };

  let raw: RawSecurityConfig;
  try {
    raw = JSON.parse(row.config_value);
  } catch {
    return { ...DEFAULT_SECURITY_POLICY };
  }

  // The UI's own <input min/max> bounds (AdminSystemTab.tsx:2253-2297) are the
  // clamp bounds here, so a value saved through the admin form always round-trips
  // unchanged, and a value it could never produce can't be forced in some other way.
  return {
    minPasswordLength: clamp(Number(raw.min_password_length), 6, 32, DEFAULT_SECURITY_POLICY.minPasswordLength),
    requireUppercase: raw.require_uppercase !== undefined ? raw.require_uppercase === '1' : DEFAULT_SECURITY_POLICY.requireUppercase,
    requireLowercase: true, // not exposed as a toggle in the UI; always required
    requireNumbers: raw.require_numbers !== undefined ? raw.require_numbers === '1' : DEFAULT_SECURITY_POLICY.requireNumbers,
    requireSpecialChars: raw.require_special_chars !== undefined ? raw.require_special_chars === '1' : DEFAULT_SECURITY_POLICY.requireSpecialChars,
    maxLoginAttempts: clamp(Number(raw.max_login_attempts), 1, 20, DEFAULT_SECURITY_POLICY.maxLoginAttempts),
    lockoutDurationMinutes: clamp(Number(raw.lockout_duration_minutes), 1, 1440, DEFAULT_SECURITY_POLICY.lockoutDurationMinutes),
    maxActiveSessions: clamp(Number(raw.max_active_sessions), 1, 10, DEFAULT_SECURITY_POLICY.maxActiveSessions),
    passwordExpiryDays: clamp(Number(raw.password_expiry_days), 0, 365, DEFAULT_SECURITY_POLICY.passwordExpiryDays),
  };
}

export function validatePassword(pwd: string, policy: SecurityPolicy): string | null {
  if (typeof pwd !== 'string' || pwd.length < policy.minPasswordLength) {
    return `Password must be at least ${policy.minPasswordLength} characters`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter';
  if (policy.requireLowercase && !/[a-z]/.test(pwd)) return 'Password must contain a lowercase letter';
  if (policy.requireNumbers && !/[0-9]/.test(pwd)) return 'Password must contain a number';
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(pwd)) return 'Password must contain a special character';
  return null;
}
