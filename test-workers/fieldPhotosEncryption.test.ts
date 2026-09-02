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

  it('uploads when FILE_ENCRYPTION_KEK is unset by deriving a KEK from JWT_SECRET', async () => {
    const testEnv = { ...(env as unknown as Record<string, unknown>) }; // JWT_SECRET from miniflare bindings
    delete testEnv.FILE_ENCRYPTION_KEK;
    const form = new FormData();
    const original = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7]);
    form.append('photo', new File([original], 'jwt-fallback.jpg', { type: 'image/jpeg' }));
    const uploadRes = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json() as { r2_key: string };
    const raw = await (testEnv as any).UPLOADS.get(uploadBody.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));
    const streamRes = await app.request(`/api/field-photos/file/${uploadBody.r2_key}`, {}, testEnv);
    expect(streamRes.status).toBe(200);
    expect(Array.from(new Uint8Array(await streamRes.arrayBuffer()))).toEqual(Array.from(original));
  });

  it('returns 500-class failure (not silently-unencrypted upload) when neither KEK nor JWT_SECRET is set', async () => {
    const testEnv = { ...(env as unknown as Record<string, unknown>), FILE_ENCRYPTION_KEK: undefined, JWT_SECRET: undefined };
    const form = new FormData();
    form.append('photo', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
    const res = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('serves a legacy pre-encryption object (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek();

    // Simulate one of production's 53 real field_photos rows uploaded before
    // this feature existed: plaintext bytes written directly into R2 under
    // field-photos/, with no corresponding file_encryption_keys row at all.
    const legacyKey = 'field-photos/legacy-pre-encryption-object.jpg';
    const legacyBytes = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7, 6, 5, 4]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    // getDecrypted() must find no key row (returns null) and the route must
    // fall back to serving the raw R2 object rather than 404ing.
    const res = await app.request(`/api/field-photos/file/${legacyKey}`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });
});
