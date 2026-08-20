import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import propertyPhotos from '../src/routes/property/photos';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

async function seedProperty(id: number) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY, name TEXT)`,
  ).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS property_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    caption TEXT,
    category TEXT,
    kind TEXT NOT NULL DEFAULT 'photo',
    uploaded_by INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO properties (id, name) VALUES (?, ?)`)
    .bind(id, 'Test Property').run();
}

describe('property-photos route', () => {
  // The upload write now always goes through putEncrypted(), so this
  // pre-existing test needs a KEK + the file_encryption_keys table or the
  // write fails closed with FileEncryptionError. See
  // test-workers/helpers/fileEncryptionTestSchema.ts.
  beforeAll(async () => {
    await seedProperty(1);
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
  });

  it('uploads a photo (kind defaults to photo)', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    form.set('property_id', '1');
    form.set('category', 'exterior');
    const res = await propertyPhotos.request('/', { method: 'POST', body: form }, envWithKek(env as unknown as Record<string, unknown>));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.kind).toBe('photo');
    expect(body.category).toBe('exterior');
    expect(body.url).toMatch(/^\/api\/property-photos\/file\/property-photos\//);
  });

  it('uploads a layout image', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'plan.png', { type: 'image/png' }));
    form.set('property_id', '1');
    form.set('kind', 'layout');
    const res = await propertyPhotos.request('/', { method: 'POST', body: form }, envWithKek(env as unknown as Record<string, unknown>));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.kind).toBe('layout');
  });

  it('lists photos newest first', async () => {
    // Insert two identifiable records here rather than relying on the two
    // uploads from earlier tests — makes the ordering assertion meaningful
    // and independent of what ran before it. ORDER BY uploaded_at DESC, id
    // DESC means id DESC alone decides ties when both land in the same
    // datetime('now') second, so the later-inserted row must come first.
    const older = new FormData();
    older.set('photo', new File([new Uint8Array([1]), ], 'older.png', { type: 'image/png' }));
    older.set('property_id', '1');
    older.set('category', 'exterior');
    older.set('caption', 'older upload');
    const olderRes = await propertyPhotos.request('/', { method: 'POST', body: older }, envWithKek(env as unknown as Record<string, unknown>));
    const olderBody = await olderRes.json() as any;

    const newer = new FormData();
    newer.set('photo', new File([new Uint8Array([1])], 'newer.png', { type: 'image/png' }));
    newer.set('property_id', '1');
    newer.set('category', 'exterior');
    newer.set('caption', 'newer upload');
    const newerRes = await propertyPhotos.request('/', { method: 'POST', body: newer }, envWithKek(env as unknown as Record<string, unknown>));
    const newerBody = await newerRes.json() as any;

    const res = await propertyPhotos.request('/1', {}, env as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    const olderIdx = body.findIndex((p) => p.id === olderBody.id);
    const newerIdx = body.findIndex((p) => p.id === newerBody.id);
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThan(newerIdx);
  });

  it('rejects an unknown property_id', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    form.set('property_id', '999');
    form.set('category', 'exterior');
    const res = await propertyPhotos.request('/', { method: 'POST', body: form }, env as any);
    expect(res.status).toBe(404);
  });

  it('deletes a photo', async () => {
    const listRes = await propertyPhotos.request('/1', {}, env as any);
    const [first] = await listRes.json() as any[];
    const delRes = await propertyPhotos.request(`/${first.id}`, { method: 'DELETE' }, env as any);
    expect(delRes.status).toBe(204);
  });
});
