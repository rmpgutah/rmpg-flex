import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import businessPhotos from '../src/routes/business/photos';

async function seedBusiness(id: number) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS businesses (id INTEGER PRIMARY KEY, name TEXT)`,
  ).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS business_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    caption TEXT,
    category TEXT CHECK(category IN ('storefront','interior','exterior','parking','other')),
    uploaded_by INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO businesses (id, name) VALUES (?, ?)`)
    .bind(id, 'Test Biz').run();
}

describe('POST /api/business-photos — kind support', () => {
  beforeAll(async () => {
    await seedBusiness(1);
  });

  it('defaults kind to photo and requires a category', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    form.set('business_id', '1');
    form.set('category', 'storefront');
    const res = await businessPhotos.request('/', { method: 'POST', body: form }, env as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.kind).toBe('photo');
    expect(body.category).toBe('storefront');
  });

  it('accepts kind=layout without requiring a category', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'plan.png', { type: 'image/png' }));
    form.set('business_id', '1');
    form.set('kind', 'layout');
    const res = await businessPhotos.request('/', { method: 'POST', body: form }, env as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.kind).toBe('layout');
  });

  it('still rejects a missing category when kind=photo (default)', async () => {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'b.png', { type: 'image/png' }));
    form.set('business_id', '1');
    const res = await businessPhotos.request('/', { method: 'POST', body: form }, env as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('INVALID_CATEGORY');
  });
});
