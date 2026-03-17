// ============================================================
// RMPG Flex — Input Validation Utility
// ============================================================
// Shared validators for common field types across routes.
// These run server-side as a defense-in-depth layer beyond
// the sanitization middleware.
// ============================================================

// Stricter email regex — requires valid local part, domain with at least one dot,
// and a TLD of 2-63 chars. Rejects bare domains, IP addresses, and common malformed patterns.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,63}$/;
const PHONE_RE = /^[\d\s()+\-]{3,25}$/;  // Removed * and # — not valid in phone numbers stored as contact info
const BADGE_RE = /^[A-Za-z0-9\-]{1,20}$/;

/**
 * Validate email format. Returns null if valid, error string if invalid.
 * Allows null/undefined/empty (optional fields) — use `required` param to enforce.
 */
export function validateEmail(email: unknown, required = false): string | null {
  if (email === null || email === undefined || email === '') {
    return required ? 'Email is required' : null;
  }
  if (typeof email !== 'string') return 'Email must be a string';
  if (email.length > 254) return 'Email exceeds maximum length (254 chars)';
  if (!EMAIL_RE.test(email)) return 'Invalid email format';
  return null;
}

/**
 * Validate phone number format. Accepts digits, spaces, parentheses, dashes, plus.
 */
export function validatePhone(phone: unknown, required = false): string | null {
  if (phone === null || phone === undefined || phone === '') {
    return required ? 'Phone number is required' : null;
  }
  if (typeof phone !== 'string') return 'Phone must be a string';
  if (!PHONE_RE.test(phone)) return 'Invalid phone format';
  return null;
}

/**
 * Validate badge number. Alphanumeric + dashes, 1-20 chars.
 */
export function validateBadgeNumber(badge: unknown, required = false): string | null {
  if (badge === null || badge === undefined || badge === '') {
    return required ? 'Badge number is required' : null;
  }
  if (typeof badge !== 'string') return 'Badge number must be a string';
  if (!BADGE_RE.test(badge)) return 'Invalid badge number format (alphanumeric, 1-20 chars)';
  return null;
}

/**
 * Validate a string field with max length.
 */
export function validateString(value: unknown, fieldName: string, maxLength = 500, required = false): string | null {
  if (value === null || value === undefined || value === '') {
    return required ? `${fieldName} is required` : null;
  }
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (value.length > maxLength) return `${fieldName} exceeds maximum length (${maxLength} chars)`;
  return null;
}

/**
 * Run multiple validators. Returns first error found, or null if all pass.
 */
export function validateAll(...errors: (string | null)[]): string | null {
  return errors.find(e => e !== null) ?? null;
}
