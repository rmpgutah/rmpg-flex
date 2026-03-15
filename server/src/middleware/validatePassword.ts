import bcryptjs from 'bcryptjs';
import config from '../config';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  const { minLength, requireUppercase, requireLowercase, requireNumber, requireSpecial } = config.password;

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  }

  if (requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (requireSpecial && !/[!@#$%^&*()_+\-=\[\]{}|;':",.<>?/`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Expanded common password blocklist (CJIS-relevant)
  const commonPasswords = [
    'password', '12345678', '123456789', '1234567890', 'qwerty', 'admin123',
    'pass123', 'letmein', 'welcome', 'monkey', 'dragon', 'master',
    'password1', 'abc123', '111111', 'iloveyou', 'trustno1', 'sunshine',
    'princess', 'football', 'charlie', 'shadow', 'michael', 'qwerty123',
    'password123', 'password1234', 'admin1234', 'welcome1', 'welcome123',
    'changeme', 'letmein1', '123qwe', 'qweasd', 'baseball', 'batman',
    'superman', 'starwars', 'access14', 'passw0rd', 'p@ssword', 'p@ssw0rd',
    'pa$$word', 'administrator', 'login', 'master123', 'hello123',
    'test1234', 'test123', 'root', 'toor', 'pass1234', 'temp1234',
    '1q2w3e4r', 'zaq1xsw2', 'qwertyui', 'asdfghjk', 'zxcvbnm',
    'police', 'officer', 'dispatch', 'security', 'badge123', 'radio',
    'patrol', 'backup', 'sgt123', 'cadet', 'academy', 'training',
    'firearm', 'pursuit', 'arrest', 'suspect', 'detective', 'sergeant',
    'captain', 'lieutenant', 'corporal', 'deputy', 'sheriff', 'trooper',
    'marshal', 'ranger', 'warden', 'inspector', 'constable', 'chief',
    'rmpg', 'rmpgflex', 'rmpgsecurity', 'rmpg123', 'flex123', 'rmpg2024',
    'rmpg2025', 'rmpg2026', 'utahpolice', 'slcpd', 'uhp', 'saltlake',
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a more unique password.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a new password matches any entry in the password history.
 * Returns true if the password was recently used (should be rejected).
 */
export function checkPasswordHistory(
  newPassword: string,
  historyHashes: string[],
): boolean {
  for (const hash of historyHashes) {
    if (bcryptjs.compareSync(newPassword, hash)) {
      return true; // Password was recently used
    }
  }
  return false;
}

/**
 * Check if a user's password has expired based on the last change timestamp.
 * Returns true if the password is expired and must be changed.
 */
export function isPasswordExpired(
  passwordChangedAt: string | null,
  expiryDays: number = config.password.expiryDays,
): boolean {
  if (expiryDays <= 0) return false; // Expiry disabled
  if (!passwordChangedAt) return true; // Never changed = expired

  const changedAt = new Date(passwordChangedAt);
  if (isNaN(changedAt.getTime())) return true; // Invalid date = treat as expired
  const expiryDate = new Date(changedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  return new Date() > expiryDate;
}

export function getPasswordPolicyDescription(): string {
  const rules: string[] = [];
  const { minLength, requireUppercase, requireLowercase, requireNumber, requireSpecial } = config.password;

  rules.push(`At least ${minLength} characters`);
  if (requireUppercase) rules.push('At least one uppercase letter');
  if (requireLowercase) rules.push('At least one lowercase letter');
  if (requireNumber) rules.push('At least one number');
  if (requireSpecial) rules.push('At least one special character');
  if (config.password.historyCount > 0) rules.push(`Cannot reuse last ${config.password.historyCount} passwords`);

  return rules.join(', ');
}
