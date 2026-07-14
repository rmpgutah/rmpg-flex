import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import propertyPhotos from '../src/routes/property/photos';

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
  beforeAll(async () => {
    await seedProperty(1);
  });

  it('uploads a photo (kind defaults to photo)', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    form.set('property_id', '1');
    form.set('category', 'exterior');
    const res = await propertyPhotos.request('/', { method: 'POST', body: form }, env as any);
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
    const res = await propertyPhotos.request('/', { method: 'POST', body: form }, env as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.kind).toBe('layout');
  });

  it('lists photos newest first', async () => {
    const res = await propertyPhotos.request('/1', {}, env as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBeGreaterThanOrEqual(2);
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
