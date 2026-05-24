import { describe, it, expect, vi } from 'vitest';
import {
  escapeLike,
  validateParamId,
  validateParamIdMiddleware,
  validateStr,
  validateDateStr,
  requireInt,
  requireFloat,
  validateEnum,
  sanitizeInput,
} from '../../src/middleware/sanitize';

// ── Helper to create mock Express objects ───────────────
function mockReq(overrides: Record<string, any> = {}) {
  return {
    params: {},
    body: {},
    query: {},
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    _json: null,
  };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((data: any) => { res._json = data; return res; });
  return res;
}

function mockNext() {
  return vi.fn();
}

// ────────────────────────────────────────────────────────
// escapeLike
// ────────────────────────────────────────────────────────
describe('escapeLike', () => {
  it('escapes percent wildcard', () => {
    expect(escapeLike('50%')).toBe('50\\%');
  });

  it('escapes underscore wildcard', () => {
    expect(escapeLike('user_name')).toBe('user\\_name');
  });

  it('escapes backslash', () => {
    expect(escapeLike('path\\file')).toBe('path\\\\file');
  });

  it('escapes multiple special characters', () => {
    expect(escapeLike('100% of_all\\data')).toBe('100\\% of\\_all\\\\data');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world');
  });
});

// ────────────────────────────────────────────────────────
// validateParamId
// ────────────────────────────────────────────────────────
describe('validateParamId', () => {
  it('returns a valid positive integer ID', () => {
    const req = mockReq({ params: { id: '42' } });
    expect(validateParamId(req)).toBe(42);
  });

  it('returns ID for custom param name', () => {
    const req = mockReq({ params: { userId: '7' } });
    expect(validateParamId(req, 'userId')).toBe(7);
  });

  it('throws for non-integer', () => {
    const req = mockReq({ params: { id: 'abc' } });
    expect(() => validateParamId(req)).toThrow('Invalid id');
  });

  it('throws for zero', () => {
    const req = mockReq({ params: { id: '0' } });
    expect(() => validateParamId(req)).toThrow('Invalid id');
  });

  it('throws for negative', () => {
    const req = mockReq({ params: { id: '-5' } });
    expect(() => validateParamId(req)).toThrow('Invalid id');
  });

  it('throws for float', () => {
    const req = mockReq({ params: { id: '3.14' } });
    expect(() => validateParamId(req)).toThrow('Invalid id');
  });
});

// ────────────────────────────────────────────────────────
// validateParamIdMiddleware
// ────────────────────────────────────────────────────────
describe('validateParamIdMiddleware', () => {
  it('calls next() for valid ID', () => {
    const req = mockReq({ params: { id: '42' } });
    const res = mockRes();
    const next = mockNext();
    validateParamIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 for invalid ID', () => {
    const req = mockReq({ params: { id: 'abc' } });
    const res = mockRes();
    const next = mockNext();
    validateParamIdMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toEqual({ error: 'Invalid ID parameter' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 for zero ID', () => {
    const req = mockReq({ params: { id: '0' } });
    const res = mockRes();
    const next = mockNext();
    validateParamIdMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ────────────────────────────────────────────────────────
// validateStr
// ────────────────────────────────────────────────────────
describe('validateStr', () => {
  it('returns trimmed string', () => {
    expect(validateStr('  hello  ', 'Name')).toBe('hello');
  });

  it('throws for empty string', () => {
    expect(() => validateStr('', 'Name')).toThrow('Name is required');
  });

  it('throws for whitespace-only string', () => {
    expect(() => validateStr('   ', 'Name')).toThrow('Name is required');
  });

  it('throws for non-string', () => {
    expect(() => validateStr(123, 'Name')).toThrow('Name is required');
    expect(() => validateStr(null, 'Name')).toThrow('Name is required');
  });

  it('throws for string exceeding max length', () => {
    expect(() => validateStr('a'.repeat(1001), 'Notes')).toThrow('Notes exceeds max length');
  });

  it('respects custom max length', () => {
    expect(() => validateStr('abc', 'Code', 2)).toThrow('Code exceeds max length');
    expect(validateStr('ab', 'Code', 2)).toBe('ab');
  });
});

// ────────────────────────────────────────────────────────
// validateDateStr
// ────────────────────────────────────────────────────────
describe('validateDateStr', () => {
  it('returns trimmed date string for valid date', () => {
    expect(validateDateStr('2025-01-15', 'Start')).toBe('2025-01-15');
  });

  it('accepts ISO datetime strings', () => {
    expect(validateDateStr('2025-01-15T10:30:00Z', 'Start')).toBe('2025-01-15T10:30:00Z');
  });

  it('throws for empty string', () => {
    expect(() => validateDateStr('', 'Start')).toThrow('Start is required');
  });

  it('throws for non-string', () => {
    expect(() => validateDateStr(null, 'Start')).toThrow('Start is required');
  });

  it('throws for invalid date', () => {
    expect(() => validateDateStr('not-a-date', 'Start')).toThrow('Start is not a valid date');
  });
});

// ────────────────────────────────────────────────────────
// requireInt
// ────────────────────────────────────────────────────────
describe('requireInt', () => {
  it('returns integer for valid input', () => {
    expect(requireInt(42, 'Age')).toBe(42);
    expect(requireInt('42', 'Age')).toBe(42);
    expect(requireInt(0, 'Count')).toBe(0);
    expect(requireInt(-5, 'Offset')).toBe(-5);
  });

  it('throws for float', () => {
    expect(() => requireInt(3.14, 'Age')).toThrow('Age must be an integer');
  });

  it('throws for non-numeric', () => {
    expect(() => requireInt('abc', 'Age')).toThrow('Age must be an integer');
  });

  it('throws for NaN', () => {
    expect(() => requireInt(NaN, 'Age')).toThrow('Age must be an integer');
  });
});

// ────────────────────────────────────────────────────────
// requireFloat
// ────────────────────────────────────────────────────────
describe('requireFloat', () => {
  it('returns number for valid input', () => {
    expect(requireFloat(3.14, 'Pi')).toBe(3.14);
    expect(requireFloat('2.5', 'Rate')).toBe(2.5);
    expect(requireFloat(0, 'Value')).toBe(0);
  });

  it('throws for non-numeric', () => {
    expect(() => requireFloat('abc', 'Rate')).toThrow('Rate must be a number');
  });

  it('throws for value below min', () => {
    expect(() => requireFloat(-1, 'Score', 0)).toThrow('Score must be >= 0');
  });

  it('throws for value above max', () => {
    expect(() => requireFloat(101, 'Percent', 0, 100)).toThrow('Percent must be <= 100');
  });

  it('accepts value at boundaries', () => {
    expect(requireFloat(0, 'Score', 0, 100)).toBe(0);
    expect(requireFloat(100, 'Score', 0, 100)).toBe(100);
  });
});

// ────────────────────────────────────────────────────────
// validateEnum
// ────────────────────────────────────────────────────────
describe('validateEnum', () => {
  const statuses = ['active', 'inactive', 'suspended'] as const;

  it('returns value when in allowed list', () => {
    expect(validateEnum('active', statuses, 'Status')).toBe('active');
  });

  it('throws for value not in allowed list', () => {
    expect(() => validateEnum('deleted', statuses, 'Status'))
      .toThrow('Status must be one of: active, inactive, suspended');
  });

  it('is case-sensitive', () => {
    expect(() => validateEnum('Active', statuses, 'Status'))
      .toThrow('Status must be one of:');
  });
});

// ────────────────────────────────────────────────────────
// sanitizeInput middleware
// ────────────────────────────────────────────────────────
describe('sanitizeInput', () => {
  it('calls next()', () => {
    const req = mockReq({ body: {}, query: {} });
    const res = mockRes();
    const next = mockNext();
    sanitizeInput(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('strips HTML angle brackets from body strings', () => {
    const req = mockReq({
      body: { name: '<script>alert("xss")</script>' },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.name).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('trims whitespace from body strings', () => {
    const req = mockReq({
      body: { name: '  John Doe  ' },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.name).toBe('John Doe');
  });

  it('sanitizes nested objects', () => {
    const req = mockReq({
      body: { data: { name: '<b>bold</b>' } },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.data.name).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('sanitizes arrays', () => {
    const req = mockReq({
      body: { tags: ['<tag>', 'safe'] },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.tags).toEqual(['&lt;tag&gt;', 'safe']);
  });

  it('does not sanitize password fields', () => {
    const req = mockReq({
      body: { password: '<my>P@ss!', currentPassword: '<old>', newPassword: '<new>' },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.password).toBe('<my>P@ss!');
    expect(req.body.currentPassword).toBe('<old>');
    expect(req.body.newPassword).toBe('<new>');
  });

  it('does not sanitize config_value field', () => {
    const req = mockReq({
      body: { config_value: '{"key": "<value>"}' },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.config_value).toBe('{"key": "<value>"}');
  });

  it('renames prototype pollution keys', () => {
    const req = mockReq({
      body: { __proto__: 'evil', constructor: 'bad', prototype: 'nope', safe: 'ok' },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body._constructor).toBe('bad');
    expect(req.body._prototype).toBe('nope');
    expect(req.body.safe).toBe('ok');
  });

  it('sanitizes query string values', () => {
    const req = mockReq({
      body: {},
      query: { search: '<script>x</script>' },
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.query.search).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('trims query string values', () => {
    const req = mockReq({
      body: {},
      query: { name: '  john  ' },
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.query.name).toBe('john');
  });

  it('leaves non-string query values alone', () => {
    const req = mockReq({
      body: {},
      query: { page: 1, ids: ['a', 'b'] },
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.query.page).toBe(1);
  });

  it('handles deeply nested payloads without crashing (depth limit)', () => {
    // Build a 25-level nested object (exceeds MAX_SANITIZE_DEPTH of 20)
    let obj: any = { value: '<deep>' };
    for (let i = 0; i < 25; i++) {
      obj = { nested: obj };
    }
    const req = mockReq({ body: obj, query: {} });
    const next = mockNext();
    // Should not throw
    sanitizeInput(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('preserves non-string and non-object values', () => {
    const req = mockReq({
      body: { count: 42, active: true, nothing: null },
      query: {},
    });
    const next = mockNext();
    sanitizeInput(req, mockRes(), next);
    expect(req.body.count).toBe(42);
    expect(req.body.active).toBe(true);
    expect(req.body.nothing).toBeNull();
  });
});
