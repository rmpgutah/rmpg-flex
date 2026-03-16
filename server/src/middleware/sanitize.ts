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

// Maximum nesting depth for JSON objects — prevents stack overflow from deeply nested payloads
const MAX_JSON_DEPTH = 10;

// Maximum length for individual query parameter values
const MAX_QUERY_PARAM_LENGTH = 1_000;

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

// Recursively sanitize an object's string values (with depth limit to prevent stack overflow)
function sanitizeValue(value: unknown, fieldName?: string, depth: number = 0): unknown {
  if (depth > MAX_JSON_DEPTH) return undefined; // Drop excessively nested values
  if (typeof value === 'string') {
    // Trim whitespace, enforce max length, and strip dangerous HTML tag characters
    return sanitizeStr(value.trim(), fieldName);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map(v => sanitizeValue(v, fieldName, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>, depth: number = 0): Record<string, unknown> {
  if (depth > MAX_JSON_DEPTH) return {}; // Refuse to recurse beyond depth limit
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Reject prototype pollution attempts — __proto__, constructor, prototype are never valid field names
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    // Don't sanitize password fields (they get hashed)
    if (key === 'password' || key === 'currentPassword' || key === 'newPassword') {
      sanitized[key] = value;
    } else if (key === 'config_value') {
      // config_value is a JSON blob — sanitize string values inside it
      if (typeof value === 'string') {
        sanitized[key] = sanitizeStr(value, key);
      } else if (value !== null && typeof value === 'object') {
        sanitized[key] = sanitizeObject(value as Record<string, unknown>, depth + 1);
      } else {
        sanitized[key] = value;
      }
    } else {
      sanitized[key] = sanitizeValue(value, key, depth);
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

  // Sanitize query params — enforce length limits and strip dangerous characters
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        const trimmed = value.trim().slice(0, MAX_QUERY_PARAM_LENGTH);
        (req.query as Record<string, string>)[key] = sanitizeStr(trimmed, key);
      }
    }
  }

  next();
}
