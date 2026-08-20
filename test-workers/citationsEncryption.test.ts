import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('citations/ PDF copies — envelope encryption', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, citation_number TEXT
    )`).run();
    await db.prepare(`INSERT INTO citations (id, citation_number) VALUES (1, 'C-1001')`).run();
  });

  it('stores an uploaded copy as ciphertext and serves it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // fake %PDF-ish bytes

    const form = new FormData();
    form.append('court', new File([original], 'court.pdf', { type: 'application/pdf' }));

    const uploadRes = await app.request('/api/citations/1/copies', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);

    const key = 'citations/1/court.pdf';
    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request('/api/citations/1/copies/court', {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption copy (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    // Simulate a citation PDF copy uploaded before this feature shipped:
    // plaintext bytes written directly into R2 under citations/, with no
    // corresponding file_encryption_keys row at all.
    const legacyKey = 'citations/1/agency.pdf';
    const legacyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 8, 7, 6, 5]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'application/pdf' } });

    const res = await app.request('/api/citations/1/copies/agency', {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('still 404s when the copy genuinely does not exist', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const res = await app.request('/api/citations/1/copies/defendant', {}, testEnv);
    expect(res.status).toBe(404);
  });
});
