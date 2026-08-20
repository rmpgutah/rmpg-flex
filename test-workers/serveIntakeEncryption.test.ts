import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { getDecrypted } from '../src/utils/encryptedR2';
import { envWithKek, TEST_KEK, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

// storeToR2 is not exported from serveIntake.ts (it's a module-private helper
// called only from the /upload route, which itself requires substantial DB
// fixture setup — serve_queue, serve_intake_documents, role middleware, and
// AI-dependent extraction that isn't mocked in this test harness). Testing
// the R2 write behavior directly against the real UPLOADS/DB bindings proves
// the encryption contract without needing the full /upload pipeline. Before
// this task is done, read serveIntake.ts's storeToR2 signature (env, file,
// uploaderId) to confirm this test still matches it after Step 4's edit.
describe('serve-intake/ storage — envelope encryption (direct storeToR2 contract check)', () => {
  it('a file written the way storeToR2 will write it round-trips through getDecrypted', async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const { putEncrypted } = await import('../src/utils/encryptedR2');

    const original = new Uint8Array([2, 4, 6, 8, 10]);
    const key = 'serve-intake/1/test-doc.pdf';
    await putEncrypted(testEnv.UPLOADS as any, env.DB as any, TEST_KEK, key, original, { httpMetadata: { contentType: 'application/pdf' } });

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const decrypted = await getDecrypted(testEnv.UPLOADS as any, env.DB as any, TEST_KEK, key);
    expect(Array.from(decrypted!.bytes)).toEqual(Array.from(original));
  });
});

// GET /documents/:docId/file — proves the read site was wired to
// getDecrypted() AND that legacy (pre-encryption) intake documents already
// sitting in production R2 with no file_encryption_keys row still serve
// correctly via the raw-fallback, rather than 404ing.
describe('serve-intake/ GET /documents/:docId/file — envelope encryption + legacy fallback', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS serve_intake_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serve_queue_id INTEGER,
      uploaded_by INTEGER,
      file_name TEXT,
      file_type TEXT,
      r2_key TEXT,
      size_bytes INTEGER,
      raw_text TEXT,
      doc_type TEXT,
      status TEXT NOT NULL DEFAULT 'extracted',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`).run();
  });

  it('serves an encrypted document back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const { putEncrypted } = await import('../src/utils/encryptedR2');
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;

    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // fake %PDF bytes
    const key = 'serve-intake/1/1700000000-abcd1234-summons.pdf';
    await putEncrypted(testEnv.UPLOADS as any, db as any, TEST_KEK, key, original, { httpMetadata: { contentType: 'application/pdf' } });

    await db.prepare(
      `INSERT INTO serve_intake_documents (id, r2_key, file_type, file_name) VALUES (1, ?, 'application/pdf', 'summons.pdf')`,
    ).bind(key).run();

    const res = await app.request('/api/serve-intake/documents/1/file', {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption document (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;

    // Simulate a serve-intake document uploaded before this feature shipped:
    // plaintext bytes written directly into R2 under serve-intake/, with no
    // corresponding file_encryption_keys row at all.
    const legacyKey = 'serve-intake/1/1600000000-legacy0001-old-summons.pdf';
    const legacyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 8, 7, 6, 5]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'application/pdf' } });

    await db.prepare(
      `INSERT INTO serve_intake_documents (id, r2_key, file_type, file_name) VALUES (2, ?, 'application/pdf', 'old-summons.pdf')`,
    ).bind(legacyKey).run();

    const res = await app.request('/api/serve-intake/documents/2/file', {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('still 404s when the document genuinely does not exist in R2', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await db.prepare(
      `INSERT INTO serve_intake_documents (id, r2_key, file_type, file_name) VALUES (3, 'serve-intake/1/does-not-exist.pdf', 'application/pdf', 'ghost.pdf')`,
    ).run();
    const res = await app.request('/api/serve-intake/documents/3/file', {}, testEnv);
    expect(res.status).toBe(404);
  });
});
