import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

// A deterministic base64 32-byte KEK for tests.
const KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function envWithKek() {
  return { ...(env as unknown as Record<string, unknown>), FILE_ENCRYPTION_KEK: KEK };
}

describe('field-photos upload/stream/delete — end-to-end with real R2/D1', () => {
  // The Miniflare D1 binding starts empty (no migrations applied — this test
  // pool never runs migrations/*.sql, see other test-workers/*.test.ts files
  // for the same per-file bootstrap pattern). Mirror migration
  // 0194_file_encryption_keys.sql here so encryptedR2.ts's putEncrypted/
  // getDecrypted have somewhere to read/write wrapped keys. field_photos
  // itself doesn't need bootstrapping — the route creates it via its own
  // ensureTable() on first write.
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

  it('uploads, streams back the original bytes, and stores ciphertext in R2', async () => {
    const testEnv = envWithKek();

    const form = new FormData();
    const original = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]); // fake JPEG-ish bytes
    form.append('photo', new File([original], 'scene.jpg', { type: 'image/jpeg' }));

    const uploadRes = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json() as { r2_key: string; url: string };
    expect(uploadBody.r2_key).toMatch(/^field-photos\/.+\.jpg$/);

    // The raw R2 object must NOT be the original plaintext bytes.
    const raw = await (testEnv as any).UPLOADS.get(uploadBody.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    // Streaming through the API must return the original bytes exactly.
    const streamRes = await app.request(`/api/field-photos/file/${uploadBody.r2_key}`, {}, testEnv);
    expect(streamRes.status).toBe(200);
    const streamedBytes = new Uint8Array(await streamRes.arrayBuffer());
    expect(Array.from(streamedBytes)).toEqual(Array.from(original));
  });

  it('returns 500-class failure (not silently-unencrypted upload) when FILE_ENCRYPTION_KEK is unset', async () => {
    const testEnv = { ...(env as unknown as Record<string, unknown>) }; // no FILE_ENCRYPTION_KEK
    const form = new FormData();
    form.append('photo', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
    const res = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
