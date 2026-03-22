import { Request, Response, NextFunction } from 'express';

// Sanitize strings to prevent XSS — only strip dangerous tag characters.
// Do NOT encode quotes or apostrophes: they are normal data characters
// (e.g. 6'2", O'Brien, "North" entrance) and encoding them corrupts stored data.
function sanitizeStr(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Recursively sanitize an object's string values
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Trim whitespace and strip dangerous HTML tag characters
    return sanitizeStr(value.trim());
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
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
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
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
