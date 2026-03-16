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

// Fields where SSN or credit card numbers should be redacted to prevent
// accidental PII storage in free-text fields (notes, descriptions, narratives).
// The actual SSN storage field (ssn_full, ssn_last4) is handled separately.
const PII_REDACT_FIELDS = new Set([
  'notes', 'description', 'narrative', 'details', 'conditions',
  'body', 'content', 'text', 'report_content', 'supplemental_narrative',
]);
// SSN pattern: 3 digits, separator, 2 digits, separator, 4 digits (with various separators)
const SSN_RE = /\b(\d{3})[-.\s](\d{2})[-.\s](\d{4})\b/g;
// Credit card patterns: 13-19 digits with optional separators
const CC_RE = /\b(\d{4})[-.\s]?(\d{4})[-.\s]?(\d{4})[-.\s]?(\d{1,7})\b/g;

// Sanitize strings to prevent XSS — only strip dangerous tag characters.
// Do NOT encode quotes or apostrophes: they are normal data characters
// (e.g. 6'2", O'Brien, "North" entrance) and encoding them corrupts stored data.
// Dangerous URI schemes that can execute scripts when rendered in href/src attributes.
// Case-insensitive match with optional whitespace/control chars between letters.
// Also catches obfuscation like "java\tscript:" or "j\na\rv\0ascript:" by stripping
// whitespace and control characters before matching.
const DANGEROUS_URI_RE = /^\s*(javascript|vbscript|data|livescript|mocha)\s*:/i;
// Extended pattern that catches control-char obfuscation (e.g., "j\navas\tcript:")
const OBFUSCATED_URI_RE = /^\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i;

function sanitizeStr(str: string, fieldName?: string): string {
  const maxLen = fieldName && LONG_TEXT_FIELDS.has(fieldName) ? MAX_LONG_TEXT_LENGTH : MAX_STRING_LENGTH;
  const truncated = str.length > maxLen ? str.slice(0, maxLen) : str;
  // Strip null bytes that can bypass filters in some parsers
  let cleaned = truncated.replace(/\0/g, '');
  // Neutralize dangerous URI schemes (javascript:, vbscript:, data:, livescript:, mocha:)
  cleaned = cleaned.replace(DANGEROUS_URI_RE, 'blocked:');
  // Also catch control-char obfuscated javascript: URIs
  cleaned = cleaned.replace(OBFUSCATED_URI_RE, 'blocked:');
  // Redact SSN and credit card numbers from free-text fields to prevent
  // accidental PII storage — officers sometimes paste sensitive data into notes
  if (fieldName && PII_REDACT_FIELDS.has(fieldName)) {
    cleaned = cleaned.replace(SSN_RE, '***-**-$3');
    cleaned = cleaned.replace(CC_RE, '****-****-****-$4');
  }
  return cleaned
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

// Maximum number of keys per object level — prevents DoS via objects with millions of keys
const MAX_OBJECT_KEYS = 500;

function sanitizeObject(obj: Record<string, unknown>, depth: number = 0): Record<string, unknown> {
  if (depth > MAX_JSON_DEPTH) return {}; // Refuse to recurse beyond depth limit
  const sanitized: Record<string, unknown> = {};
  let keyCount = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (++keyCount > MAX_OBJECT_KEYS) break; // Truncate excessively large objects
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

/** Escape SQL LIKE wildcard characters (%, _, \) so user input is treated literally.
 *  Use with `LIKE ? ESCAPE '\'` in your SQL queries. */
export function escapeLike(str: string): string {
  return String(str).replace(/[%_\\]/g, '\\$&');
}

/** Quote a SQL identifier (table/column name) by wrapping in double quotes
 *  and escaping any embedded double quotes. Prevents SQL injection via identifiers. */
export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Express middleware that validates req.params.id is a positive integer.
 *  Use on routes like `router.get('/:id', validateParamId, handler)` to reject
 *  non-numeric IDs before they reach DB queries or business logic. */
export function validateParamId(req: Request, res: Response, next: NextFunction): void {
  const id = String(req.params.id ?? '');
  if (id) {
    const n = parseInt(id, 10);
    if (isNaN(n) || n < 1 || String(n) !== id) {
      res.status(400).json({ error: 'Invalid ID parameter' });
      return;
    }
  }
  next();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Express middleware that validates req.params.id is a positive integer OR a UUID.
 *  Use on routes where primary keys may be either format (e.g., serve_queue uses UUIDs). */
export function validateParamIdOrUuid(req: Request, res: Response, next: NextFunction): void {
  const id = String(req.params.id ?? '');
  if (id) {
    const n = parseInt(id, 10);
    const isInt = !isNaN(n) && n >= 1 && String(n) === id;
    if (!isInt && !UUID_RE.test(id)) {
      res.status(400).json({ error: 'Invalid ID parameter' });
      return;
    }
  }
  next();
}

/** Validate one or more named route params as positive integers. */
export function validateNumericParams(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const name of paramNames) {
      const raw = String(req.params[name] ?? '');
      if (raw) {
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 1 || String(n) !== raw) {
          res.status(400).json({ error: `Invalid ${name} parameter` });
          return;
        }
      }
    }
    next();
  };
}

/** Safely parse pagination parameters from query string.
 *  Returns clamped, validated { page, limit, offset } values.
 *  - page: positive integer (default 1)
 *  - limit: positive integer clamped to [1, maxLimit] (default defaultLimit)
 *  - offset: computed from page and limit */
export function safePagination(
  query: Record<string, any>,
  defaultLimit = 50,
  maxLimit = 200,
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(String(query.page ?? query.p ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(query.limit ?? query.per_page ?? String(defaultLimit)), 10);
  const limit = Math.min(maxLimit, Math.max(1, isNaN(rawLimit) ? defaultLimit : rawLimit));
  return { page, limit, offset: (page - 1) * limit };
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

  // Sanitize URL params — strip dangerous HTML tag characters from string params
  // (numeric IDs are already validated by validateParamId, but string params like
  // filenames, call_signs, etc. could carry XSS payloads into error messages or logs)
  if (req.params) {
    for (const [key, value] of Object.entries(req.params)) {
      if (typeof value === 'string') {
        (req.params as Record<string, string>)[key] = sanitizeStr(value.trim(), key);
      }
    }
  }

  next();
}
