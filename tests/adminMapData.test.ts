import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import adminMapData from '../src/routes/adminMapData';
import type { Env } from '../src/types';

function buildApp(role: string | null, opts: {
  files?: { key: string; size: number; uploaded: string }[];
  r2Configured?: boolean;
} = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (role) c.set('user', { id: 1, username: 'tester', role, full_name: 'Test' });
    await next();
  });
  app.route('/api/admin/map-data', adminMapData);

  const bucket = {
    list: async () => ({ objects: opts.files ?? [] }),
    delete: async (_key: string) => undefined,
  } as any;

  const env: any = { MAP_DATA: bucket };
  if (opts.r2Configured !== false) {
    env.R2_ACCESS_KEY_ID = 'key';
    env.R2_SECRET_ACCESS_KEY = 'secret';
    env.R2_ACCOUNT_ID = 'acct';
  }

  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

describe('GET /api/admin/map-data/files', () => {
  it('rejects a non-admin role', async () => {
    const request = buildApp('manager');
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const request = buildApp(null);
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(403);
  });

  it('lists files for an admin', async () => {
    const request = buildApp('admin', {
      files: [{ key: 'tiles/utah.pmtiles', size: 12345, uploaded: '2026-07-18T00:00:00Z' }],
    });
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toHaveLength(1);
    expect(body.files[0].key).toBe('tiles/utah.pmtiles');
  });
});

describe('POST /api/admin/map-data/presign', () => {
  it('rejects a key outside the allowed prefixes', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'secrets/oops.txt', contentType: 'text/plain', size: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns a presigned URL for an allowed key', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tiles/utah.pmtiles', contentType: 'application/octet-stream', size: 500_000_000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.upload_url).toContain('acct.r2.cloudflarestorage.com/system-essentials/tiles/utah.pmtiles');
  });

  it('returns not_configured when R2 credentials are unset', async () => {
    const request = buildApp('admin', { r2Configured: false });
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tiles/utah.pmtiles', contentType: 'application/octet-stream', size: 100 }),
    });
    const body = await res.json() as any;
    expect(body).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('DELETE /api/admin/map-data/files/:key', () => {
  it('rejects a non-admin role', async () => {
    const request = buildApp('officer');
    const res = await request('/api/admin/map-data/files/tiles/utah.pmtiles', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('deletes an allowed key for an admin', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/files/tiles/utah.pmtiles', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
