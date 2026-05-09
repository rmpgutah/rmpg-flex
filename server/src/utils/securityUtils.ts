// Security utilities
import crypto from 'crypto';

/** Constant-time string comparison to prevent timing attacks */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare with self to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Mask sensitive fields in objects for safe logging/audit */
export function maskSensitive(
  obj: Record<string, any>,
  fieldsToMask: string[] = []
): Record<string, any> {
  const defaultMaskFields = [
    'password',
    'password_hash',
    'ssn',
    'social_security',
    'drivers_license',
    'dl_number',
    'credit_card',
    'bank_account',
    'totp_secret',
    'backup_codes',
    'api_key',
    'token',
    'refresh_token',
    'secret',
    'private_key',
  ];
  const allFields = new Set([...defaultMaskFields, ...fieldsToMask]);

  const masked: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (allFields.has(key.toLowerCase())) {
      masked[key] = value ? '***REDACTED***' : null;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitive(value, fieldsToMask);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/** Generate a cryptographically secure CSRF token */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Validate CSRF token */
export function validateCsrfToken(token: string, expected: string): boolean {
  if (!token || !expected) return false;
  return constantTimeEqual(token, expected);
}

/** Check if an HTTP method is allowed (prevent method override attacks) */
const ALLOWED_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);
export function isAllowedMethod(method: string): boolean {
  return ALLOWED_METHODS.has(method.toUpperCase());
}

/** Sanitize SQL identifiers to prevent injection in dynamic queries */
export function sanitizeSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier.slice(0, 20)}`);
  }
  return identifier;
}

/** Validate sort direction parameter */
export function validateSortDirection(dir: string | undefined): 'ASC' | 'DESC' {
  if (!dir) return 'DESC';
  const upper = dir.toUpperCase();
  if (upper !== 'ASC' && upper !== 'DESC') return 'DESC';
  return upper as 'ASC' | 'DESC';
}

/** Generate a hash for tracking failed login attempts */
export function hashForTracking(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}
