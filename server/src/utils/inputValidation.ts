// ============================================================
// RMPG Flex — Input Validation Utility
// ============================================================
// Shared validators for common field types across routes.
// These run server-side as a defense-in-depth layer beyond
// the sanitization middleware.
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-.*#]{3,25}$/;
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
 * Validate a date string is in YYYY-MM-DD format and parses correctly.
 */
export function validateDate(date: unknown, fieldName = 'Date', required = false): string | null {
  if (date === null || date === undefined || date === '') {
    return required ? `${fieldName} is required` : null;
  }
  if (typeof date !== 'string') return `${fieldName} must be a string`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${fieldName} must be in YYYY-MM-DD format`;
  if (isNaN(new Date(date + 'T00:00:00').getTime())) return `${fieldName} is not a valid date`;
  return null;
}

/**
 * Validate GPS coordinates are within valid ranges.
 */
export function validateCoordinates(lat: unknown, lng: unknown, required = false): string | null {
  if ((lat === null || lat === undefined) && (lng === null || lng === undefined)) {
    return required ? 'Coordinates are required' : null;
  }
  if (lat !== null && lat !== undefined) {
    const latNum = parseFloat(String(lat));
    if (isNaN(latNum) || latNum < -90 || latNum > 90) return 'Latitude must be between -90 and 90';
  }
  if (lng !== null && lng !== undefined) {
    const lngNum = parseFloat(String(lng));
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) return 'Longitude must be between -180 and 180';
  }
  return null;
}

/**
 * Validate a numeric value is within a range.
 */
export function validateNumber(value: unknown, fieldName: string, min = -Infinity, max = Infinity, required = false): string | null {
  if (value === null || value === undefined || value === '') {
    return required ? `${fieldName} is required` : null;
  }
  const num = parseFloat(String(value));
  if (isNaN(num) || !isFinite(num)) return `${fieldName} must be a valid number`;
  if (num < min || num > max) return `${fieldName} must be between ${min} and ${max}`;
  return null;
}

/**
 * Validate a positive integer (for IDs, counts, etc.)
 */
export function validatePositiveInt(value: unknown, fieldName = 'Value', required = false): string | null {
  if (value === null || value === undefined || value === '') {
    return required ? `${fieldName} is required` : null;
  }
  const num = parseInt(String(value), 10);
  if (isNaN(num) || num < 1) return `${fieldName} must be a positive integer`;
  return null;
}

/**
 * Validate a value is one of a set of allowed values.
 */
export function validateEnum(value: any, validValues: string[], fieldName: string): string | null {
  if (!value) return null; // optional
  if (!validValues.includes(value)) return `${fieldName} must be one of: ${validValues.join(', ')}`;
  return null;
}

/**
 * Validate a value does not exceed a maximum character length.
 */
export function validateMaxLength(value: any, max: number, fieldName: string): string | null {
  if (!value) return null;
  if (String(value).length > max) return `${fieldName} must be ${max} characters or less`;
  return null;
}

/**
 * Run multiple validators. Returns first error found, or null if all pass.
 */
export function validateAll(...errors: (string | null)[]): string | null {
  return errors.find(e => e !== null) ?? null;
}
