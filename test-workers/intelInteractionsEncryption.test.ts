// Route-level regression test (Miniflare/workerd) for the interaction audio
// recording chunk endpoints (file-encryption-at-rest Phase 2 Task 7):
//   PUT  /api/intel/recordings/:id/chunk?seq=
//   GET  /api/intel/recordings/:id/chunk/:seq
// Covers the write+read round trip through putEncrypted/getDecrypted, the
// legacy fallback for chunks already stored under interactions/ before this
// task shipped (no file_encryption_keys row), and confirms a genuine decrypt
// failure surfaces as a loud error rather than being conflated with the
// legacy case (same invariant enforced in nsopwPhotoEncryption.test.ts /
// radioAudioEncryption.test.ts).
import { env } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable, TEST_KEK } from './helpers/fileEncryptionTestSchema';
import { putEncrypted } from '../src/utils/encryptedR2';

async function createRecording(testEnv: Record<string, unknown>): Promise<number> {
  const createRes = await app.request(
    '/api/intel/recordings/start',
    { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } },
    testEnv,
  );
  expect(createRes.status).toBe(200);
  const { id } = await createRes.json() as { id: number };
  return id;
}

describe('interactions/ chunk storage — envelope encryption', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as D1Database);
    await (env.DB as unknown as D1Database).prepare(
      `CREATE TABLE IF NOT EXISTS interaction_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER, location_text TEXT, lat REAL, lng REAL,
        linked_fi_id INTEGER, linked_call_id INTEGER, notes TEXT, mime TEXT, status TEXT,
        chunk_count INTEGER DEFAULT 0, duration_sec INTEGER, ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run();
  });

  it('stores a chunk as ciphertext and streams back the original bytes', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    const id = await createRecording(testEnv);

    const original = new Uint8Array([11, 22, 33, 44, 55]);
    const chunkRes = await app.request(`/api/intel/recordings/${id}/chunk?seq=0`, { method: 'PUT', body: original }, testEnv);
    expect(chunkRes.status).toBe(200);

    const key = `interactions/${id}/0.webm`; // matches chunkKey(id, seq) in src/utils/intelRecording.ts
    const raw = await (testEnv as any).UPLOADS.get(key);
    expect(raw).toBeTruthy();
    const rawBytes = new Uint8Array(await raw.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request(`/api/intel/recordings/${id}/chunk/0`, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });

  it('serves a legacy pre-encryption chunk (R2 bytes with no file_encryption_keys row) via a raw fallback instead of 404ing', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    const id = await createRecording(testEnv);

    // Simulate a chunk written before this task shipped putEncrypted() into
    // the write route: plaintext bytes placed directly into R2 under
    // interactions/, with no corresponding file_encryption_keys row.
    const key = `interactions/${id}/0.webm`;
    const legacyBytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
    await (testEnv as any).UPLOADS.put(key, legacyBytes, { httpMetadata: { contentType: 'audio/webm' } });

    const readRes = await app.request(`/api/intel/recordings/${id}/chunk/0`, {}, testEnv);
    expect(readRes.status).toBe(200);
    const bytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(legacyBytes));
  });

  it('genuinely 404s when neither an encrypted nor a raw R2 chunk exists', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const id = await createRecording(testEnv);
    const readRes = await app.request(`/api/intel/recordings/${id}/chunk/0`, {}, testEnv);
    expect(readRes.status).toBe(404);
  });

  it('does not silently serve raw ciphertext as a fake 200 when decryption genuinely fails (malformed KEK)', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const db = env.DB as unknown as D1Database;

    const id = await createRecording(testEnv);
    const key = `interactions/${id}/0.webm`;
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    await putEncrypted((testEnv as any).UPLOADS, db, TEST_KEK, key, original, {
      httpMetadata: { contentType: 'audio/webm' },
    });

    // This chunk genuinely has a file_encryption_keys row (not legacy), so
    // getDecrypted() must reach importKek() and throw when the KEK is
    // malformed, rather than being swallowed and falling through to the
    // legacy-fallback path (which would wrongly hand back ciphertext as a
    // 200 response).
    const badKekEnv = { ...testEnv, FILE_ENCRYPTION_KEK: btoa('too-short') };
    const readRes = await app.request(`/api/intel/recordings/${id}/chunk/0`, {}, badKekEnv);

    expect(readRes.status).toBeGreaterThanOrEqual(400);
    expect(readRes.status).not.toBe(200);
    const bytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(bytes)).not.toEqual(Array.from(original));
  });
});
