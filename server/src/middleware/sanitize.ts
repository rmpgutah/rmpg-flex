import { Request, Response, NextFunction } from 'express';

// Maximum string length for general text fields (prevents megabyte payloads)
const MAX_STRING_LENGTH = 10_000;
// Longer limit for fields that legitimately hold large text (notes, descriptions, config)
const LONG_TEXT_FIELDS = new Set([
  'notes', 'description', 'narrative', 'details', 'conditions',
  'body', 'content', 'text', 'config_value', 'digital_signature',
  'report_content', 'supplemental_narrative', 'profile_image',
]);
const MAX_LONG_TEXT_LENGTH = 100_000;

// Sanitize strings to prevent XSS — only strip dangerous tag characters.
// Do NOT encode quotes or apostrophes: they are normal data characters
// (e.g. 6'2", O'Brien, "North" entrance) and encoding them corrupts stored data.
function sanitizeStr(str: string, fieldName?: string): string {
  const maxLen = fieldName && LONG_TEXT_FIELDS.has(fieldName) ? MAX_LONG_TEXT_LENGTH : MAX_STRING_LENGTH;
  const truncated = str.length > maxLen ? str.slice(0, maxLen) : str;
  return truncated
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Recursively sanitize an object's string values
function sanitizeValue(value: unknown, fieldName?: string): unknown {
  if (typeof value === 'string') {
    // Trim whitespace, enforce max length, and strip dangerous HTML tag characters
    return sanitizeStr(value.trim(), fieldName);
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v, fieldName));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Don't sanitize password fields (they get hashed) or config_value (JSON blob)
    if (key === 'password' || key === 'currentPassword' || key === 'newPassword' || key === 'config_value') {
      sanitized[key] = value;
    } else {
      sanitized[key] = sanitizeValue(value, key);
    }
  }
  return sanitized;
}

// Export for use in offline sync push (where JSON.parse produces unsanitized objects)
export { sanitizeObject };

// Validate that a value is one of an allowed set. Returns the value if valid, or null if empty.
// Throws an Error with a descriptive message if the value is present but not allowed.
export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${fieldName}. Must be one of: ${allowed.join(', ')}`);
}

// Coerce a value to an integer, returning null if empty or NaN.
export function requireInt(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (isNaN(n)) throw new Error(`${fieldName} must be a valid number`);
  return n;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        (req.query as Record<string, string>)[key] = sanitizeStr(value.trim(), key);
      }
    }
  }

  next();
}
