import { describe, it, expect, afterEach } from 'vitest';
import { parseQrngResponse, fetchQrngBytes, combineEntropy } from './generate-quantum-key.mjs';
import { vi } from 'vitest';

describe('parseQrngResponse', () => {
  it('parses a valid response into a Uint8Array of the expected length', () => {
    const json = { success: true, data: [1, 2, 3, 4], length: 4, type: 'uint8' };
    const result = parseQrngResponse(json, 4);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when success is false', () => {
    const json = { success: false, data: [1, 2, 3, 4] };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data is missing', () => {
    expect(parseQrngResponse({ success: true }, 4)).toBeNull();
  });

  it('returns null when data length does not match expectedLength', () => {
    const json = { success: true, data: [1, 2, 3], length: 3, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data contains an out-of-range value', () => {
    const json = { success: true, data: [1, 2, 3, 999], length: 4, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseQrngResponse(null, 4)).toBeNull();
    expect(parseQrngResponse(undefined, 4)).toBeNull();
  });
});

describe('fetchQrngBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns bytes on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(url).toContain('length=4');
      expect(url).toContain('type=uint8');
      return new Response(JSON.stringify({ success: true, data: [10, 20, 30, 40], length: 4, type: 'uint8' }), { status: 200 });
    }));
    const result = await fetchQrngBytes(4);
    expect(Array.from(result)).toEqual([10, 20, 30, 40]);
  });

  it('returns null on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null on malformed JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null when the response has success: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });
});

describe('combineEntropy', () => {
  it('produces byteLength bytes', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const result = await combineEntropy(local, qrng, 32);
    expect(result.length).toBe(32);
  });

  it('is deterministic for the same inputs', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const a = await combineEntropy(local, qrng, 32);
    const b = await combineEntropy(local, qrng, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different output when qrngBytes is null (local-only fallback)', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const withQrng = await combineEntropy(local, qrng, 32);
    const localOnly = await combineEntropy(local, null, 32);
    expect(Array.from(withQrng)).not.toEqual(Array.from(localOnly));
  });

  it('local-only fallback is itself deterministic', async () => {
    const local = new Uint8Array(32).fill(1);
    const a = await combineEntropy(local, null, 32);
    const b = await combineEntropy(local, null, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('different local bytes produce different output', async () => {
    const qrng = new Uint8Array(32).fill(2);
    const a = await combineEntropy(new Uint8Array(32).fill(1), qrng, 32);
    const b = await combineEntropy(new Uint8Array(32).fill(9), qrng, 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('supports a 96-byte output (SLH-DSA seed length)', async () => {
    const local = new Uint8Array(96).fill(3);
    const qrng = new Uint8Array(96).fill(4);
    const result = await combineEntropy(local, qrng, 96);
    expect(result.length).toBe(96);
  });
});
