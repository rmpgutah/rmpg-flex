import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

// A deterministic base64 32-byte KEK for tests.
const KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function envWithKek() {
  return { ...(env as unknown as Record<string, unknown>), FILE_ENCRYPTION_KEK: KEK };
}

describe('GET /transmissions/:id/audio — legacy fallback + Range handling', () => {
  // Mirrors fieldPhotosEncryption.test.ts's per-file bootstrap: the Miniflare
  // D1 binding starts empty (no migrations applied in this test pool), so
  // stand up the table encryptedR2.ts's getDecrypted()/putEncrypted() read/write.
  beforeAll(async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS file_encryption_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      r2_key TEXT NOT NULL UNIQUE,
      wrapped_dek TEXT NOT NULL,
      dek_iv TEXT NOT NULL,
      file_iv TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('serves a legacy pre-encryption recording (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek();

    // Simulate a transmission recorded before VoiceHubDO started calling
    // putEncrypted: plaintext bytes written directly into R2 under
    // radio-audio/, with no corresponding file_encryption_keys row.
    const id = 4201;
    const key = `radio-audio/${id}.webm`;
    const legacyBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await (testEnv as any).UPLOADS.put(key, legacyBytes, { httpMetadata: { contentType: 'audio/webm' } });

    // getDecrypted() must find no key row (returns null) and the route must
    // fall back to serving the raw R2 object rather than 404ing.
    const res = await app.request(`/api/radio/transmissions/${id}/audio`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('genuinely 404s when neither an encrypted nor a raw R2 object exists', async () => {
    const testEnv = envWithKek();
    const res = await app.request('/api/radio/transmissions/999999/audio', {}, testEnv);
    expect(res.status).toBe(404);
  });

  it('returns 200 with the full body (not 206) when the Range header is present but unparseable', async () => {
    const testEnv = envWithKek();

    const id = 4202;
    const key = `radio-audio/${id}.webm`;
    const bytes10 = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    await (testEnv as any).UPLOADS.put(key, bytes10, { httpMetadata: { contentType: 'audio/webm' } });

    // "bytes=-500" is a suffix-range the route's regex (`^bytes=(\d+)-(\d*)$`)
    // does not match — RFC 7233 says an unparseable Range header must be
    // treated as absent (plain 200, full body, no Content-Range).
    const res = await app.request(`/api/radio/transmissions/${id}/audio`, {
      headers: { Range: 'bytes=-500' },
    }, testEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(bytes10));
    expect(res.headers.get('Content-Length')).toBe(String(bytes10.length));
  });

  it('still returns 206 with a correct Content-Range for a well-formed Range header', async () => {
    const testEnv = envWithKek();

    const id = 4203;
    const key = `radio-audio/${id}.webm`;
    const bytes10 = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    await (testEnv as any).UPLOADS.put(key, bytes10, { httpMetadata: { contentType: 'audio/webm' } });

    const res = await app.request(`/api/radio/transmissions/${id}/audio`, {
      headers: { Range: 'bytes=2-4' },
    }, testEnv);

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-4/10');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([30, 40, 50]);
  });
});
