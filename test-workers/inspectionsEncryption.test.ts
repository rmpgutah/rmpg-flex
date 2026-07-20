// test-workers/inspectionsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

const TOKEN = 'test-shift-token-0001';
const TOKEN_LEGACY = 'test-shift-token-0002';

describe('vehicle-inspections/ — envelope encryption', () => {
  let entryId: number;
  let entryIdLegacy: number;

  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      schedule_id INTEGER,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      clock_in_latitude REAL,
      clock_in_longitude REAL,
      total_hours REAL,
      break_start TEXT,
      break_minutes REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      starting_mileage REAL, ending_mileage REAL, total_miles REAL, qr_token TEXT,
      clock_in_local TEXT, clock_out_local TEXT, break_start_local TEXT,
      unit_id INTEGER, vehicle_id INTEGER
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time_entry_id INTEGER, phase TEXT, completed_at TEXT
    )`).run();
    const res = await db.prepare(
      `INSERT INTO time_entries (officer_id, clock_in, qr_token) VALUES (1, datetime('now'), ?)`,
    ).bind(TOKEN).run();
    entryId = Number(res.meta.last_row_id);

    const resLegacy = await db.prepare(
      `INSERT INTO time_entries (officer_id, clock_in, qr_token) VALUES (1, datetime('now'), ?)`,
    ).bind(TOKEN_LEGACY).run();
    entryIdLegacy = Number(resLegacy.meta.last_row_id);
  });

  it('stores an uploaded inspection photo as ciphertext and streams it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([1, 1, 2, 3, 5, 8, 13]);

    const uploadRes = await app.request(
      `/api/inspections/by-token/${TOKEN}/photos?phase=pre&slot=front`,
      { method: 'POST', body: original, headers: { 'content-type': 'image/jpeg' } },
      testEnv,
    );
    expect(uploadRes.status).toBe(200);
    const { key } = await uploadRes.json() as { key: string };
    expect(key).toMatch(/^vehicle-inspections\//);

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request(`/api/inspections/by-token/${TOKEN}/photo?key=${encodeURIComponent(key)}`, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });

  it('serves a legacy (pre-encryption) photo with no file_encryption_keys row via raw R2 fallback', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const legacyBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const legacyKey = `vehicle-inspections/${entryIdLegacy}/pre/front-legacy.jpg`;

    // Simulate a pre-encryption object: written straight to R2, no
    // file_encryption_keys row (this is what production R2 looks like for
    // every inspection photo uploaded before this task shipped).
    await (testEnv as any).UPLOADS.put(legacyKey, legacyBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    const readRes = await app.request(
      `/api/inspections/by-token/${TOKEN_LEGACY}/photo?key=${encodeURIComponent(legacyKey)}`,
      {},
      testEnv,
    );
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(legacyBytes));
  });

  it('404s when the photo genuinely does not exist', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const missingKey = `vehicle-inspections/${entryId}/pre/nope-${crypto.randomUUID()}.jpg`;

    const readRes = await app.request(
      `/api/inspections/by-token/${TOKEN}/photo?key=${encodeURIComponent(missingKey)}`,
      {},
      testEnv,
    );
    expect(readRes.status).toBe(404);
  });
});
