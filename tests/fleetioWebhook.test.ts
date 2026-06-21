import { describe, it, expect } from 'vitest';
import {
  constantTimeEquals,
  hmacSha256Hex,
  normalizeSignatureHeader,
  extractEventId,
  normalizeResource,
} from '../src/routes/fleetioWebhook';

describe('constantTimeEquals', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('returns false for different lengths (no early-exit leak)', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('xx', 'x')).toBe(false);
  });

  it('returns false for same-length differing strings', () => {
    expect(constantTimeEquals('abcd', 'abcD')).toBe(false);
    expect(constantTimeEquals('hello', 'world')).toBe(false);
  });
});

describe('hmacSha256Hex', () => {
  it('produces the documented test vector for ("key", "The quick brown fox jumps over the lazy dog")', async () => {
    // Standard HMAC-SHA256 test vector (RFC 4231-style).
    const out = await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
    expect(out).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('returns lowercase hex of length 64', async () => {
    const out = await hmacSha256Hex('s', 'payload');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different bodies → different signatures', async () => {
    const a = await hmacSha256Hex('s', 'a');
    const b = await hmacSha256Hex('s', 'b');
    expect(a).not.toBe(b);
  });

  it('different secrets → different signatures over the same body', async () => {
    const a = await hmacSha256Hex('s1', 'body');
    const b = await hmacSha256Hex('s2', 'body');
    expect(a).not.toBe(b);
  });
});

describe('normalizeSignatureHeader', () => {
  it('returns null for null/empty', () => {
    expect(normalizeSignatureHeader(null)).toBeNull();
    expect(normalizeSignatureHeader(undefined)).toBeNull();
    expect(normalizeSignatureHeader('')).toBeNull();
  });

  it('lowercases bare hex headers', () => {
    expect(normalizeSignatureHeader('ABCDEF1234567890')).toBe('abcdef1234567890');
    expect(normalizeSignatureHeader(' ABCdef ')).toBe('abcdef');
  });

  it('strips a sha256= prefix if present', () => {
    expect(normalizeSignatureHeader('sha256=DEADBEEF')).toBe('deadbeef');
    expect(normalizeSignatureHeader('SHA256=deadbeef')).toBe('deadbeef');
  });
});

describe('extractEventId', () => {
  it('reads numeric and string top-level id', () => {
    expect(extractEventId({ id: 42 })).toBe('42');
    expect(extractEventId({ id: 'evt-abc' })).toBe('evt-abc');
  });

  it('falls back to event_id when id is absent', () => {
    expect(extractEventId({ event_id: 'xyz' })).toBe('xyz');
  });

  it('returns null for malformed payloads', () => {
    expect(extractEventId(null)).toBeNull();
    expect(extractEventId('string')).toBeNull();
    expect(extractEventId({})).toBeNull();
  });
});

describe('normalizeResource', () => {
  it('parses event_type=resource.action', () => {
    const out = normalizeResource({ event_type: 'vehicle.update', data: { id: 1234 } });
    expect(out).toEqual({ resource: 'vehicle', action: 'update', resource_id: 1234 });
  });

  it('reads data.id as string -> int', () => {
    const out = normalizeResource({ event_type: 'fuel_entry.create', data: { id: '99' } });
    expect(out).toEqual({ resource: 'fuel_entry', action: 'create', resource_id: 99 });
  });

  it('returns null for missing/wrong event_type', () => {
    expect(normalizeResource({})).toBeNull();
    expect(normalizeResource({ event_type: 'bogus' })).toBeNull();
    expect(normalizeResource({ event_type: 'vehicle.archive' })).toBeNull();
  });

  it('returns resource_id=null when data.id is absent or unparseable', () => {
    const out = normalizeResource({ event_type: 'vehicle.update', data: {} });
    expect(out?.resource_id).toBeNull();
  });
});
