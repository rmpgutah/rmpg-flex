import { describe, it, expect } from 'vitest';
import {
  constantTimeEquals,
  hmacSha256Hex,
  normalizeSignatureHeader,
  normalizeAuthorizationHeader,
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

describe('normalizeAuthorizationHeader (PR 4c — Fleet.io echo scheme)', () => {
  it('returns null for null/empty', () => {
    expect(normalizeAuthorizationHeader(null)).toBeNull();
    expect(normalizeAuthorizationHeader(undefined)).toBeNull();
    expect(normalizeAuthorizationHeader('')).toBeNull();
    expect(normalizeAuthorizationHeader('   ')).toBeNull();
  });

  it('passes a bare secret through unchanged (trim only)', () => {
    expect(normalizeAuthorizationHeader('a1b2c3d4')).toBe('a1b2c3d4');
    expect(normalizeAuthorizationHeader('  a1b2c3d4 ')).toBe('a1b2c3d4');
  });

  it('strips "Bearer " prefix case-insensitively', () => {
    expect(normalizeAuthorizationHeader('Bearer abc123')).toBe('abc123');
    expect(normalizeAuthorizationHeader('bearer abc123')).toBe('abc123');
    expect(normalizeAuthorizationHeader('BEARER abc123')).toBe('abc123');
  });

  it('strips "Token " prefix case-insensitively', () => {
    expect(normalizeAuthorizationHeader('Token abc123')).toBe('abc123');
    expect(normalizeAuthorizationHeader('TOKEN abc123')).toBe('abc123');
  });

  it('preserves the secret byte-for-byte after prefix strip (does not lowercase)', () => {
    // Operators paste hex secrets — must not lowercase, must not trim mid-secret.
    expect(normalizeAuthorizationHeader('Bearer A1B2C3D4'))
      .toBe('A1B2C3D4');
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
  // ─── Variant 1: event_type='resource.action' (REST-style) ──
  it('parses event_type=resource.action', () => {
    const out = normalizeResource({ event_type: 'vehicle.update', data: { id: 1234 } });
    expect(out).toEqual({ resource: 'vehicle', action: 'update', resource_id: 1234 });
  });

  it('reads data.id as string -> int', () => {
    const out = normalizeResource({ event_type: 'fuel_entry.create', data: { id: '99' } });
    expect(out).toEqual({ resource: 'fuel_entry', action: 'create', resource_id: 99 });
  });

  // ─── Variant 2: subject_type + verb (Rails-style — Fleet.io's actual shape) ──
  it('parses subject_type + verb=updated → action=update (PR 4d)', () => {
    const out = normalizeResource({ subject_type: 'vehicle', verb: 'updated', subject_id: 555 });
    expect(out).toEqual({ resource: 'vehicle', action: 'update', resource_id: 555 });
  });

  it('parses subject_type + verb=created → action=create (PR 4d)', () => {
    const out = normalizeResource({ subject_type: 'fuel_entry', verb: 'created', subject_id: 1 });
    expect(out).toEqual({ resource: 'fuel_entry', action: 'create', resource_id: 1 });
  });

  it('parses subject_type + verb=destroyed → action=delete (PR 4d)', () => {
    const out = normalizeResource({ subject_type: 'vehicle', verb: 'destroyed', subject_id: 7 });
    expect(out).toEqual({ resource: 'vehicle', action: 'delete', resource_id: 7 });
  });

  // ─── Variant 4: event='resource_action' (Fleet.io's REAL shape, PR 4e) ──
  it("parses event='vehicle_updated' + payload.vehicle_id (PR 4e)", () => {
    const out = normalizeResource({
      event: 'vehicle_updated',
      payload: { vehicle_id: 12345 },
    });
    expect(out).toEqual({ resource: 'vehicle', action: 'update', resource_id: 12345 });
  });

  it("splits 'fuel_entry_created' as ('fuel_entry', 'created') — greedy resource (PR 4e)", () => {
    // 'fuel_entry' has an underscore in the resource name itself; the
    // KNOWN-action-suffix anchor disambiguates the split.
    const out = normalizeResource({
      event: 'fuel_entry_created',
      payload: { fuel_entry_id: 999 },
    });
    expect(out).toEqual({ resource: 'fuel_entry', action: 'create', resource_id: 999 });
  });

  it("recognizes 'destroyed' suffix → action=delete (PR 4e)", () => {
    const out = normalizeResource({
      event: 'vehicle_destroyed',
      payload: { vehicle_id: 1 },
    });
    expect(out).toEqual({ resource: 'vehicle', action: 'delete', resource_id: 1 });
  });

  it("real Fleet.io 'user_updated' payload from 2026-06-21 → resource='user', action='update'", () => {
    // Captured from production via audit_log FLEETIO_WEBHOOK_UNPARSEABLE
    // (before this PR landed). Verbatim shape that flushed our parser.
    const out = normalizeResource({
      id: 91805667,
      event: 'user_updated',
      timestamp: '2026-06-21T14:40:40.000-06:00',
      payload: {
        contact_id: 2917654,
        role_id: null,
        user_id: 2473696,
        user_type: 'owner',
        name: 'Christopher Zamora',
        email: 'chzamo@rmpgutah.us',
      },
      triggered_by: 'chzamo@rmpgutah.us',
      account_url_token: '60e7fe9892',
    });
    expect(out).toEqual({ resource: 'user', action: 'update', resource_id: 2473696 });
  });

  // ─── Variant 3: name='resource.action' + payload.id (alt-REST) ──
  it('parses name + payload.id (PR 4d)', () => {
    const out = normalizeResource({ name: 'vehicle.updated', payload: { id: 42 } });
    expect(out).toEqual({ resource: 'vehicle', action: 'update', resource_id: 42 });
  });

  it('returns null for missing/wrong event_type', () => {
    expect(normalizeResource({})).toBeNull();
    expect(normalizeResource({ event_type: 'bogus' })).toBeNull();
    expect(normalizeResource({ event_type: 'vehicle.archive' })).toBeNull();
  });

  it('returns resource_id=null when no id field present', () => {
    const out = normalizeResource({ event_type: 'vehicle.update', data: {} });
    expect(out?.resource_id).toBeNull();
  });

  it('falls back from data.id → payload.id → subject_id → resource_id → top-level id', () => {
    expect(normalizeResource({ event_type: 'vehicle.update', payload: { id: 11 } })?.resource_id).toBe(11);
    expect(normalizeResource({ event_type: 'vehicle.update', subject_id: 22 })?.resource_id).toBe(22);
    expect(normalizeResource({ event_type: 'vehicle.update', resource_id: 33 })?.resource_id).toBe(33);
    expect(normalizeResource({ event_type: 'vehicle.update', id: 44 })?.resource_id).toBe(44);
  });
});

describe('extractEventId fallback path (PR 4d)', () => {
  it('returns the documented uuid / event_uuid field if present', () => {
    expect(extractEventId({ event_uuid: 'abc-def' })).toBe('abc-def');
    expect(extractEventId({ uuid: 'xyz' })).toBe('xyz');
  });

  it('falls back to a body-prefix marker when no id field exists', () => {
    const body = '{"verb":"updated","subject_type":"vehicle","subject_id":7}';
    const id = extractEventId(JSON.parse(body), body);
    expect(id?.startsWith('body:')).toBe(true);
    expect(id?.length).toBeGreaterThan(5);
  });

  it('still returns null if there is no id and no fallback body', () => {
    expect(extractEventId({ subject_type: 'vehicle' })).toBeNull();
    expect(extractEventId({ subject_type: 'vehicle' }, '')).toBeNull();
  });
});
