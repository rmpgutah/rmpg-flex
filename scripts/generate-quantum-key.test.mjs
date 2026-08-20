import { describe, it, expect, afterEach } from 'vitest';
import { parseQrngResponse, fetchQrngBytes, combineEntropy, generateQuantumKey, runCli } from './generate-quantum-key.mjs';
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

describe('generateQuantumKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports qrngUsed: true and returns byteLength bytes on QRNG success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const { combined, qrngUsed } = await generateQuantumKey(32);
    expect(qrngUsed).toBe(true);
    expect(combined.length).toBe(32);
  });

  it('reports qrngUsed: false and still returns byteLength bytes on QRNG failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { combined, qrngUsed } = await generateQuantumKey(32);
    expect(qrngUsed).toBe(false);
    expect(combined.length).toBe(32);
  });

  it('produces different output across two calls even with the same QRNG response (local bytes differ each time)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const a = await generateQuantumKey(32);
    const b = await generateQuantumKey(32);
    expect(Array.from(a.combined)).not.toEqual(Array.from(b.combined));
  });
});

describe('runCli', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prints usage and exits 1 when byteLength is missing', async () => {
    const { exitCode, stdout, stderr } = await runCli([]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage:');
  });

  it('prints usage and exits 1 when byteLength is not a positive integer', async () => {
    expect((await runCli(['0'])).exitCode).toBe(1);
    expect((await runCli(['-5'])).exitCode).toBe(1);
    expect((await runCli(['abc'])).exitCode).toBe(1);
  });

  it('on QRNG success: stdout is a valid base64 string decoding to byteLength bytes, exit 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const { exitCode, stdout, stderr } = await runCli(['32']);
    expect(exitCode).toBe(0);
    const decoded = Buffer.from(stdout.trim(), 'base64');
    expect(decoded.length).toBe(32);
    expect(stderr).toContain('QRNG mix: yes');
  });

  it('on QRNG failure: falls back to local-only, still exits 0 with a valid key, warns on stderr', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { exitCode, stdout, stderr } = await runCli(['32']);
    expect(exitCode).toBe(0);
    const decoded = Buffer.from(stdout.trim(), 'base64');
    expect(decoded.length).toBe(32);
    expect(stderr).toContain('QRNG unreachable');
    expect(stderr).toContain('QRNG mix: no');
  });

  it('stdout contains nothing but the base64 key and a trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { stdout } = await runCli(['16']);
    expect(stdout).toMatch(/^[A-Za-z0-9+/=]+\n$/);
  });
});
