import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe.each([
  { label: 'business', base: '/api/business-photos', table: 'businesses', idField: 'business_id' },
  { label: 'property', base: '/api/property-photos', table: 'properties', idField: 'property_id' },
])('$label-photos/ — envelope encryption', ({ base, table, idField }) => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)`).run();
    await db.prepare(`INSERT INTO ${table} (id) VALUES (1)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${table === 'businesses' ? 'business_photos' : 'property_photos'} (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ${idField} INTEGER, url TEXT, caption TEXT, category TEXT,
      kind TEXT, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext, serves decrypted bytes, and removes the key row on delete', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([5, 4, 3, 2, 1]);

    const form = new FormData();
    form.append('photo', new File([original], 'p.jpg', { type: 'image/jpeg' }));
    form.append(idField, '1');
    form.append('category', 'other');

    const uploadRes = await app.request(base, { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const row = await uploadRes.json() as { id: number; url: string };
    const r2Key = row.url.replace(`${base}/file/`, '');

    const raw = await (testEnv as any).UPLOADS.get(r2Key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request(row.url, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));

    const deleteRes = await app.request(`${base}/${row.id}`, { method: 'DELETE' }, testEnv);
    expect(deleteRes.status).toBe(204);

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const keyRow = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(r2Key).first();
    expect(keyRow).toBeNull();
  });

  it('serves a legacy pre-encryption object (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const prefix = base === '/api/business-photos' ? 'business-photos' : 'property-photos';
    const legacyKey = `${prefix}/legacy-pre-encryption-object.jpg`;
    const legacyBytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    const res = await app.request(`${base}/file/${legacyKey}`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });
});
