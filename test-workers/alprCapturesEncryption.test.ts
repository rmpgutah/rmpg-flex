import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('alpr-captures/ — envelope encryption for unattached captures', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
  });

  it('encrypts an unattached capture (no call_id/incident_id) and serves it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const form = new FormData();
    form.append('image', new File([original], 'plate.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/api/alpr/capture', { method: 'POST', body: form }, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { image_url?: string | null };
    expect(body.image_url).toBeTruthy();

    const key = String(body.image_url).replace(/^.*\/image\//, '');
    expect(key).toMatch(/^alpr-captures\//);

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const imgRes = await app.request(`/api/alpr/image/${key}`, {}, testEnv);
    expect(imgRes.status).toBe(200);
    const servedBytes = new Uint8Array(await imgRes.arrayBuffer());
    expect(Array.from(servedBytes)).toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption alpr-captures/ object (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    // Simulate a real ALPR capture uploaded before this task shipped: plaintext
    // bytes written directly into R2 under alpr-captures/, with no
    // corresponding file_encryption_keys row at all.
    const legacyKey = 'alpr-captures/legacy-pre-encryption-object.jpg';
    const legacyBytes = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7, 6, 5, 4]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    // getDecrypted() must find no key row (returns null) and the route must
    // fall back to serving the raw R2 object rather than 404ing.
    const res = await app.request(`/api/alpr/image/${legacyKey}`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('404s when the object genuinely does not exist at all', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const res = await app.request('/api/alpr/image/alpr-captures/does-not-exist.jpg', {}, testEnv);
    expect(res.status).toBe(404);
  });
});
