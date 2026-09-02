import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { sign } from 'hono/jwt';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ user_id: 1, username: 'test-officer', role: 'admin', iat: now, exp: now + 900, type: 'access' }, JWT_SECRET);
}

describe('attachments/ — envelope encryption', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT UNIQUE, original_name TEXT, stored_name TEXT,
      file_path TEXT, mime_type TEXT, file_size INTEGER, entity_type TEXT, entity_id INTEGER,
      -- Live attachments has no uploaded_at (created_at is the timestamp).
      folder_id INTEGER, uploaded_by INTEGER,
      latitude REAL, longitude REAL, taken_at TEXT, reference_notes TEXT
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity_type TEXT,
      entity_id INTEGER, details TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext, serves decrypted bytes, and removes the key row on delete', async () => {
    const testEnv = { ...envWithKek(env as unknown as Record<string, unknown>), JWT_SECRET };
    const token = await mintToken();
    const authHeaders = { authorization: `Bearer ${token}` };
    const original = new Uint8Array([1, 2, 3, 4, 5]);

    const form = new FormData();
    form.append('files', new File([original], 'note.txt', { type: 'text/plain' }));

    const uploadRes = await app.request('/api/uploads', { method: 'POST', headers: authHeaders, body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const [row] = await uploadRes.json() as Array<{ file_id: string; file_path: string }>;

    const raw = await (testEnv as any).UPLOADS.get(row.file_path);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const downloadRes = await app.request(`/api/uploads/${row.file_id}/download`, { headers: authHeaders }, testEnv);
    expect(downloadRes.status).toBe(200);
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(original));

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const beforeDelete = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(row.file_path).first();
    expect(beforeDelete).toBeTruthy();

    const deleteRes = await app.request(`/api/uploads/${row.file_id}`, { method: 'DELETE', headers: authHeaders }, testEnv);
    expect(deleteRes.status).toBeLessThan(300);

    const afterDelete = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(row.file_path).first();
    expect(afterDelete).toBeNull();
  });

  it('rejects a file larger than 100 MB', async () => {
    const testEnv = { ...envWithKek(env as unknown as Record<string, unknown>), JWT_SECRET };
    const token = await mintToken();
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append('files', new File([oversized], 'huge.bin', { type: 'text/plain' }));
    const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, testEnv);
    expect(res.status).toBe(400);
  });

  it('falls back to serving raw bytes for a legacy attachment with no file_encryption_keys row', async () => {
    const testEnv = { ...envWithKek(env as unknown as Record<string, unknown>), JWT_SECRET };
    const token = await mintToken();
    const authHeaders = { authorization: `Bearer ${token}` };
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;

    // Simulate a pre-encryption attachment: raw R2 object, DB row, but
    // deliberately NO file_encryption_keys row (putEncrypted never ran).
    const fileId = crypto.randomUUID();
    const r2Key = `attachments/${fileId}.txt`;
    const legacyBytes = new Uint8Array([9, 8, 7, 6, 5]);
    await (testEnv as any).UPLOADS.put(r2Key, legacyBytes, {
      httpMetadata: { contentType: 'text/plain' },
    });
    await db.prepare(
      `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(fileId, 'legacy.txt', `${fileId}.txt`, r2Key, 'text/plain', legacyBytes.byteLength, 1).run();

    // Confirm no key row exists for this object (the "legacy" precondition).
    const keyRow = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(r2Key).first();
    expect(keyRow).toBeNull();

    const downloadRes = await app.request(`/api/uploads/${fileId}/download`, { headers: authHeaders }, testEnv);
    expect(downloadRes.status).toBe(200);
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(legacyBytes));
  });

  it('encrypts via JWT_SECRET when FILE_ENCRYPTION_KEK is unset', async () => {
    const testEnv = { ...(env as unknown as Record<string, unknown>), JWT_SECRET };
    delete testEnv.FILE_ENCRYPTION_KEK;
    const token = await mintToken();
    const original = new Uint8Array([9, 8, 7, 6, 5]);
    const form = new FormData();
    form.append('files', new File([original], 'jwt-fallback.txt', { type: 'text/plain' }));
    const uploadRes = await app.request('/api/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);
    expect(uploadRes.status).toBe(201);
    const [row] = await uploadRes.json() as Array<{ file_id: string; file_path: string }>;
    const raw = await (testEnv as any).UPLOADS.get(row.file_path);
    expect(Array.from(new Uint8Array(await raw!.arrayBuffer()))).not.toEqual(Array.from(original));
    const downloadRes = await app.request(`/api/uploads/${row.file_id}/download`, {
      headers: { authorization: `Bearer ${token}` },
    }, testEnv);
    expect(downloadRes.status).toBe(200);
    expect(Array.from(new Uint8Array(await downloadRes.arrayBuffer()))).toEqual(Array.from(original));
  });
});
