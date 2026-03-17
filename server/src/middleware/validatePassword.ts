import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
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

  // bcrypt truncates at 72 bytes — passwords beyond this give a false sense of security.
  // Enforce byte-level limit to prevent silent truncation.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    errors.push('Password must be 72 bytes or fewer (bcrypt limit)');
  }
  // Also prevent DoS from extremely long password strings slowing bcrypt.
  if (password.length > 128) {
    errors.push('Password must be 128 characters or fewer');
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
    // Additional law enforcement / security industry terms
    'cjis', 'ncic', 'nlets', 'ucjis', 'bci', 'fbi123', 'dps123',
    'taser', 'bodycam', 'dashcam', 'handcuff', 'miranda', 'felony',
    'misdemeanor', 'warrant', 'citation', 'booking', 'evidence',
    'forensic', 'homicide', 'narcotics', 'swat', 'k9unit', 'ert',
    'tactical', 'command', 'precinct', 'station', 'headquarters',
    'protectandserve', 'protect1', 'serve1', 'bluelivesmatter',
    'thinblueline', 'lawenforcement', 'publicservice',
    // Common keyboard/sequential patterns
    'qwerty1234', 'asdf1234', 'zxcv1234', 'abcd1234',
    '1234abcd', 'aaa111', 'abc12345', '12345abcde',
    'p@ss1234', 'p@$$w0rd1', 'pa55word', 'passw0rd1',
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a more unique password.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a password has been exposed in known data breaches using the
 * HaveIBeenPwned Passwords API v3 (k-Anonymity model).
 *
 * Only the first 5 characters of the SHA-1 hash are sent to the API,
 * so the full password hash is never exposed to a third party.
 *
 * Returns the breach count (0 = not found, >0 = compromised).
 * Returns -1 on network/API errors (fail open — don't block login).
 */
export async function checkPasswordBreach(password: string): Promise<number> {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'RMPG-Flex-Security-Check' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return -1; // API error — fail open

    const body = await response.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(count, 10) || 1;
      }
    }
    return 0; // Not found in breaches
  } catch {
    return -1; // Network error — fail open
  }
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
