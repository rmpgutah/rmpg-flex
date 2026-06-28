// Tests for pdfIntegrity.ts — payload-hash canonicalization,
// SHA-256 computation, and signature fetch (graceful + happy
// paths). The signature trailer rendering itself is exercised
// transitively by the recordPdfGenerator smoke tests; here we
// pin the integrity-module contract that they depend on.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canonicalJsonStringify,
  computePayloadHash,
  fetchPdfSignature,
  setActiveSignature,
  getActiveSignature,
  clearActiveSignature,
  setActivePayloadHash,
  getActivePayloadHash,
  getActivePayloadHashShort,
  formatHashGrouped,
  formatSignatureGrouped,
} from '../pdfIntegrity';

describe('canonicalJsonStringify', () => {
  it('sorts top-level keys alphabetically', () => {
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('drops null and undefined fields', () => {
    expect(canonicalJsonStringify({ a: 1, b: null, c: undefined, d: 4 }))
      .toBe('{"a":1,"d":4}');
  });

  it('drops the _officerSignature blob and other underscore fields in the blacklist', () => {
    expect(canonicalJsonStringify({
      a: 1,
      _officerSignature: 'data:image/png;base64,xxxx',
      _logoBase64: 'data:image/png;base64,yyyy',
      _dossier: { warrants: { count: 3 } },
      b: 2,
    })).toBe('{"a":1,"b":2}');
  });

  it('recursively sorts nested objects', () => {
    expect(canonicalJsonStringify({ z: { b: 2, a: 1 }, a: { d: 4, c: 3 } }))
      .toBe('{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
  });

  it('preserves array order (semantic order matters)', () => {
    expect(canonicalJsonStringify({ items: [3, 1, 2] }))
      .toBe('{"items":[3,1,2]}');
  });

  it('produces identical output for two equal records', () => {
    const a = { case_number: 'C-1', name: 'X', _officerSignature: 'AAA', priority: 3 };
    const b = { priority: 3, name: 'X', _officerSignature: 'BBB', case_number: 'C-1' };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });
});

describe('computePayloadHash', () => {
  it('returns 64-char lowercase hex SHA-256', async () => {
    const hash = await computePayloadHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await computePayloadHash({ a: 1, b: 2 });
    const b = await computePayloadHash({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('changes when payload changes', async () => {
    const a = await computePayloadHash({ a: 1 });
    const b = await computePayloadHash({ a: 2 });
    expect(a).not.toBe(b);
  });

  it('does NOT change when only blacklisted fields change', async () => {
    const a = await computePayloadHash({ a: 1, _officerSignature: 'AAA' });
    const b = await computePayloadHash({ a: 1, _officerSignature: 'BBB' });
    expect(a).toBe(b);
  });
});

describe('formatHashGrouped', () => {
  it('groups 64-char hash into 4-char × 4-col × 4-row layout', () => {
    const hash = 'a'.repeat(64);
    const lines = formatHashGrouped(hash);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('aaaa aaaa aaaa aaaa');
  });

  it('returns empty array for empty input', () => {
    expect(formatHashGrouped('')).toEqual([]);
  });
});

describe('formatSignatureGrouped', () => {
  it('groups 88-char base64 into 4-char × 12-col × ~2-row layout', () => {
    const sig = 'A'.repeat(88);
    const lines = formatSignatureGrouped(sig);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(2);
    // First line should be exactly 12 groups of 4 chars
    expect(lines[0].split(' ').length).toBe(12);
  });
});

describe('active state setters', () => {
  it('payload hash round-trips and lowercases', () => {
    setActivePayloadHash('ABCD' + 'e'.repeat(60));
    expect(getActivePayloadHash()).toBe('abcd' + 'e'.repeat(60));
    expect(getActivePayloadHashShort()).toBe('abcde' + 'eee');
  });

  it('signature round-trips', () => {
    const bundle = {
      signature: 'sigB64',
      publicKey: 'pubB64',
      signedAt: '2026-04-01T00:00:00Z',
      algorithm: 'Ed25519' as const,
    };
    setActiveSignature(bundle);
    expect(getActiveSignature()).toEqual(bundle);
    clearActiveSignature();
    expect(getActiveSignature()).toBeUndefined();
  });
});

describe('fetchPdfSignature', () => {
  beforeEach(() => {
    clearActiveSignature();
  });

  it('returns null and does not throw when server returns 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'not configured', code: 'SIGNING_NOT_CONFIGURED' }),
      { status: 503 },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null on network error (graceful)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toBeNull();
  });

  it('parses a 200 response into a PdfSignatureBundle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        signature: 'sigB64',
        publicKey: 'pubB64',
        signedAt: '2026-04-01T00:00:00Z',
        algorithm: 'Ed25519',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toEqual({
      signature: 'sigB64',
      publicKey: 'pubB64',
      signedAt: '2026-04-01T00:00:00Z',
      algorithm: 'Ed25519',
    });
  });

  it('returns null when 200 response is missing signature field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ unrelated: 'shape' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toBeNull();
  });
});
