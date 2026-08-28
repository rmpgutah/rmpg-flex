// Route-level regression test (Miniflare/workerd) for GET /api/nsopw/photo/:id
// — the read-side decrypt for file-encryption-at-rest Phase 2 Task 4, plus
// the legacy-fallback for offender photos stored under nsopw-photos/ before
// this task shipped (this feature has been live in production).
//
// Mounts the nsopw router directly in a local Hono app rather than adding it
// to the shared test-workers/entry.ts — mirrors the established pattern in
// test-workers/nsopwEnrich.test.ts. entry.ts is shared by every route test in
// this pool; a targeted per-file app keeps this test's schema bootstrap
// (national_sex_offenders + file_encryption_keys) isolated from other suites
// and avoids widening a shared file for one route's tests.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import { putEncrypted } from '../src/utils/encryptedR2';
import nsopw from '../src/routes/nsopw';
import { envWithKek, ensureFileEncryptionKeysTable, TEST_KEK } from './helpers/fileEncryptionTestSchema';

function buildApp() {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
    c.set('userId', 1);
    await next();
  });
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
  app.route('/api/nsopw', nsopw);
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  });
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS national_sex_offenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, jurisdiction TEXT, detail_url TEXT,
    local_photo_key TEXT, local_photo_url TEXT, photo_fetched_at TEXT,
    photo_size_bytes INTEGER, photo_content_type TEXT
  )`);
  await ensureFileEncryptionKeysTable(db as unknown as D1Database);
});

describe('GET /api/nsopw/photo/:offenderRowId — encrypted read + legacy fallback', () => {
  it('decrypts and serves a photo written via putEncrypted (round trip)', async () => {
    const app = buildApp();
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = (env as unknown as { DB: D1Database }).DB;

    const key = 'nsopw-photos/UT/enc-offender-1.jpg';
    const original = new Uint8Array([0xff, 0xd8, 0xff, 11, 22, 33]);
    await putEncrypted((testEnv as unknown as { UPLOADS: R2Bucket }).UPLOADS, db, TEST_KEK, key, original, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    // Confirm the raw R2 object really is ciphertext, not the original bytes.
    const raw = await (testEnv as unknown as { UPLOADS: R2Bucket }).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const insert = await execute(db,
      `INSERT INTO national_sex_offenders (jurisdiction, local_photo_key, photo_content_type) VALUES ('UT', ?, 'image/jpeg')`,
      key);
    const id = insert.meta.last_row_id;

    const res = await app.request(`/api/nsopw/photo/${id}`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });

  it('propagates a genuine decrypt failure (malformed KEK) as a loud error instead of silently falling back to raw ciphertext', async () => {
    const app = buildApp();
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = (env as unknown as { DB: D1Database }).DB;

    const key = 'nsopw-photos/UT/enc-offender-bad-kek.jpg';
    const original = new Uint8Array([0xff, 0xd8, 0xff, 99, 88, 77]);
    await putEncrypted((testEnv as unknown as { UPLOADS: R2Bucket }).UPLOADS, db, TEST_KEK, key, original, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    const insert = await execute(db,
      `INSERT INTO national_sex_offenders (jurisdiction, local_photo_key, photo_content_type) VALUES ('UT', ?, 'image/jpeg')`,
      key);
    const id = insert.meta.last_row_id;

    // This object genuinely has a file_encryption_keys row (it's not a
    // legacy pre-encryption object), so getDecrypted() must reach
    // importKek() and throw FileEncryptionError when the KEK is malformed
    // -- mirroring tests/encryptedR2.test.ts's "throws FileEncryptionError
    // when the KEK is the wrong length" case. Before the fix, the route's
    // `.catch(() => null)` around getDecrypted() swallowed exactly this
    // throw and treated it identically to the legitimate "legacy object,
    // no key row" case above, silently serving raw AES-GCM ciphertext back
    // as a 200 `image/jpeg` response instead of failing loudly.
    const badKekEnv = { ...testEnv, FILE_ENCRYPTION_KEK: btoa('too-short') };
    const res = await app.request(`/api/nsopw/photo/${id}`, {}, badKekEnv);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).not.toBe(200);
    // Must not be the (broken) legacy-fallback behavior: the ciphertext must
    // never be handed back to the caller.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).not.toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption object (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const app = buildApp();
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = (env as unknown as { DB: D1Database }).DB;

    // Simulate one of production's already-live NSOPW offender photos,
    // downloaded and stored before this task shipped: plaintext bytes
    // written directly into R2 under nsopw-photos/, with no corresponding
    // file_encryption_keys row at all.
    const key = 'nsopw-photos/UT/legacy-offender-2.jpg';
    const legacyBytes = new Uint8Array([0xff, 0xd8, 0xff, 44, 55, 66, 77]);
    await (testEnv as unknown as { UPLOADS: R2Bucket }).UPLOADS.put(key, legacyBytes, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    const insert = await execute(db,
      `INSERT INTO national_sex_offenders (jurisdiction, local_photo_key, photo_content_type) VALUES ('UT', ?, 'image/jpeg')`,
      key);
    const id = insert.meta.last_row_id;

    // getDecrypted() must find no key row (returns null) and the route must
    // fall back to serving the raw R2 object rather than 404ing.
    const res = await app.request(`/api/nsopw/photo/${id}`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('404s when the offender row points at a key with no R2 object at all (genuinely missing, not legacy)', async () => {
    const app = buildApp();
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = (env as unknown as { DB: D1Database }).DB;

    const insert = await execute(db,
      `INSERT INTO national_sex_offenders (jurisdiction, local_photo_key, photo_content_type) VALUES ('UT', 'nsopw-photos/UT/does-not-exist.jpg', 'image/jpeg')`);
    const id = insert.meta.last_row_id;

    const res = await app.request(`/api/nsopw/photo/${id}`, {}, testEnv);
    expect(res.status).toBe(404);
  });
});
