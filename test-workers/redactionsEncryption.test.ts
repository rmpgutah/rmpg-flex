import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

type D1 = import('@cloudflare/workers-types').D1Database;

describe('redactions upload/download — envelope encryption', () => {
  // The Miniflare D1 pool starts empty (no migrations/*.sql applied) and
  // vitest-pool-workers isolates storage per-test, snapshotting whatever
  // exists at the end of beforeAll as the baseline restored before every
  // `it`. So both file_encryption_keys (mirrors migration
  // 0194_file_encryption_keys.sql, needed by encryptedR2.ts) and
  // video_redactions (mirrors redactions.ts's own ensureSchema() base
  // CREATE TABLE, so direct-insert tests below don't depend on a prior
  // test's POST having created it) must be bootstrapped here rather than
  // relying on one test's side effects to carry into the next.
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as D1);
    await (env.DB as unknown as D1).prepare(`CREATE TABLE IF NOT EXISTS video_redactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_event_id INTEGER, r2_key TEXT NOT NULL,
      kinds TEXT, region_count INTEGER NOT NULL DEFAULT 0, style TEXT, regions_json TEXT,
      redacted_by INTEGER, status TEXT NOT NULL DEFAULT 'completed', requested_at TEXT,
      completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  });

  it('stores ciphertext in R2 and streams back the original bytes', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const form = new FormData();
    form.append('video', new File([original], 'redacted.mp4', { type: 'video/mp4' }));
    form.append('metadata', JSON.stringify({ event_id: 1, kinds: ['face'], region_count: 1 }));

    const uploadRes = await app.request('/api/redactions', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(200);
    const body = await uploadRes.json() as { id: number; r2_key: string };
    expect(body.r2_key).toMatch(/^redactions\/.+\.mp4$/);

    const raw = await (testEnv as any).UPLOADS.get(body.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const downloadRes = await app.request(`/api/redactions/${body.id}/download`, {}, testEnv);
    expect(downloadRes.status).toBe(200);
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption redaction video (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    // Simulate a redaction video that landed in R2 under redactions/ before
    // this feature shipped: raw bytes in R2, plus a video_redactions custody
    // row (inserted directly, bypassing the route's encrypting write path),
    // but no corresponding file_encryption_keys row.
    const legacyKey = `redactions/legacy-pre-encryption-${crypto.randomUUID()}.mp4`;
    const legacyBytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'video/mp4' } });

    const insertLegacyRow = await (env.DB as unknown as D1).prepare(
      `INSERT INTO video_redactions (source_event_id, r2_key, kinds, region_count, style, regions_json, redacted_by, status, requested_at, completed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), ?)`,
    ).bind(2, legacyKey, 'face', 1, null, null, null, null, null).run();
    const legacyId = insertLegacyRow.meta.last_row_id;

    // getDecrypted() must find no key row (clean null return) and the route
    // must fall back to serving the raw R2 object rather than 404ing.
    const res = await app.request(`/api/redactions/${legacyId}/download`, {}, testEnv);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('still 404s when the object genuinely does not exist anywhere', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const missingKey = `redactions/does-not-exist-${crypto.randomUUID()}.mp4`;

    const insertRes = await (env.DB as unknown as D1).prepare(
      `INSERT INTO video_redactions (source_event_id, r2_key, kinds, region_count, style, regions_json, redacted_by, status, requested_at, completed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), ?)`,
    ).bind(3, missingKey, 'face', 1, null, null, null, null, null).run();
    const missingId = insertRes.meta.last_row_id;

    const res = await app.request(`/api/redactions/${missingId}/download`, {}, testEnv);
    expect(res.status).toBe(404);
  });
});
