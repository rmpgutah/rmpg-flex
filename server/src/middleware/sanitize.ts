import { Request, Response, NextFunction } from 'express';

// Sanitize strings to prevent XSS — only strip dangerous tag characters.
// Do NOT encode quotes or apostrophes: they are normal data characters
// (e.g. 6'2", O'Brien, "North" entrance) and encoding them corrupts stored data.
function sanitizeStr(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// [FIX 25] Add depth limit to prevent stack overflow from deeply nested malicious payloads
const MAX_SANITIZE_DEPTH = 20;

// Recursively sanitize an object's string values
function sanitizeValue(value: unknown, depth = 0): unknown {
  // [FIX 26] Stop recursion at max depth to prevent stack overflow
  if (depth > MAX_SANITIZE_DEPTH) return value;
  if (typeof value === 'string') {
    // Trim whitespace and strip dangerous HTML tag characters
    return sanitizeStr(value.trim());
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  // [FIX 27] Limit number of keys to prevent large payload DoS
  let keyCount = 0;
  const MAX_KEYS = 1000;
  for (const [key, value] of Object.entries(obj)) {
    if (++keyCount > MAX_KEYS) break;
    // [FIX 28] Also sanitize keys themselves to prevent __proto__ pollution
    const safeKey = key === '__proto__' || key === 'constructor' || key === 'prototype' ? `_${key}` : key;
    // Don't sanitize password fields (they get hashed) or config_value (JSON blob)
    if (safeKey === 'password' || safeKey === 'currentPassword' || safeKey === 'newPassword' || safeKey === 'config_value') {
      sanitized[safeKey] = value;
    } else {
      sanitized[safeKey] = sanitizeValue(value, depth);
    }
  }
  return sanitized;
}

// ── Validation / utility helpers used by route files ──────────

/** Escape SQL LIKE wildcards */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

/** Validate that req.params[name] is a positive integer (utility function — use in handler body) */
export function validateParamId(req: Request, name = 'id'): number {
  const val = Number(req.params[name]);
  if (!Number.isInteger(val) || val < 1) throw new Error(`Invalid ${name}`);
  return val;
}

/** Express middleware version of validateParamId — use in route chain before handler */
export function validateParamIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const val = Number(req.params.id);
  if (!Number.isInteger(val) || val < 1) {
    res.status(400).json({ error: 'Invalid ID parameter' });
    return;
  }
  next();
}

/** Validate a required string field */
export function validateStr(val: unknown, fieldName: string, maxLen = 1000): string {
  if (typeof val !== 'string' || !val.trim()) throw new Error(`${fieldName} is required`);
  const trimmed = val.trim();
  if (trimmed.length > maxLen) throw new Error(`${fieldName} exceeds max length`);
  return trimmed;
}

/** Validate a date string (ISO or common formats) */
export function validateDateStr(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !val.trim()) throw new Error(`${fieldName} is required`);
  const d = new Date(val);
  if (isNaN(d.getTime())) throw new Error(`${fieldName} is not a valid date`);
  return val.trim();
}

/** Require a value to be an integer */
export function requireInt(val: unknown, fieldName: string): number {
  const n = Number(val);
  if (!Number.isInteger(n)) throw new Error(`${fieldName} must be an integer`);
  return n;
}

/** Require a value to be a float/number, with optional min/max bounds */
export function requireFloat(val: unknown, fieldName: string, min?: number, max?: number): number {
  const n = Number(val);
  if (isNaN(n)) throw new Error(`${fieldName} must be a number`);
  if (min !== undefined && n < min) throw new Error(`${fieldName} must be >= ${min}`);
  if (max !== undefined && n > max) throw new Error(`${fieldName} must be <= ${max}`);
  return n;
}

/** Validate a value is one of the allowed enum values */
export function validateEnum<T extends string>(val: unknown, allowed: readonly T[], fieldName: string): T {
  if (!allowed.includes(val as T)) throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  return val as T;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        (req.query as Record<string, string>)[key] = sanitizeStr(value.trim());
      }
    }
  }

  next();
}
