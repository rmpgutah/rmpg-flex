import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { getDecrypted } from '../src/utils/encryptedR2';
import { envWithKek, TEST_KEK, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('work-order-attachments/ — envelope encryption (write-only, no reader route)', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT)`).run();
    await db.prepare(`INSERT INTO work_orders (id) VALUES (1)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS work_order_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, r2_key TEXT, filename TEXT,
      mime TEXT, size_bytes INTEGER, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext in R2 that getDecrypted can round-trip', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([7, 6, 5, 4, 3]);

    const form = new FormData();
    form.append('file', new File([original], 'invoice.pdf', { type: 'application/pdf' }));

    const uploadRes = await app.request('/api/work-orders/1/attachments', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const { data } = await uploadRes.json() as { data: { id: number } };

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const row = await db.prepare('SELECT r2_key FROM work_order_attachments WHERE id = ?').bind(data.id).first<{ r2_key: string }>();
    expect(row?.r2_key).toMatch(/^work-order-attachments\//);

    const raw = await (testEnv as any).UPLOADS.get(row!.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const decrypted = await getDecrypted(testEnv.UPLOADS as any, db, TEST_KEK, row!.r2_key);
    expect(decrypted).not.toBeNull();
    expect(Array.from(decrypted!.bytes)).toEqual(Array.from(original));
  });
});
