import { describe, it, expect } from 'vitest';
import navFavorites from '../src/routes/navFavorites';
import { Hono } from 'hono';
import type { Env } from '../src/types';

function appWithUser(userId: number, db: any) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('userId', userId); c.env = { DB: db } as any; await next(); });
  app.route('/', navFavorites);
  return app;
}

function fakeDb() {
  const rows: any[] = [];
  let nextId = 1;
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async all() {
              if (sql.includes('SELECT * FROM nav_favorites')) {
                let filtered = rows.filter(r => r.user_id === args[0]);
                if (sql.includes('is_staging = 1')) {
                  filtered = filtered.filter(r => r.is_staging === 1);
                }
                return { results: filtered };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('SELECT user_id FROM nav_favorites')) {
                return rows.find(r => r.id === args[0]) ?? null;
              }
              if (sql.includes('pragma_table_info')) {
                // Simulate the is_staging column always present in tests.
                return args[1] === 'is_staging' ? { 1: 1 } : null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT')) {
                const row = { id: nextId++, user_id: args[0], label: args[1], lat: args[2], lng: args[3], address: args[4], is_staging: args[5] ?? 0 };
                rows.push(row);
                return { meta: { last_row_id: row.id } };
              }
              if (sql.startsWith('DELETE')) {
                const idx = rows.findIndex(r => r.id === args[0]);
                if (idx >= 0) rows.splice(idx, 1);
                return { meta: {} };
              }
              return { meta: {} };
            },
          };
        },
      };
    },
  };
}

describe('nav favorites CRUD', () => {
  it('creates, lists, and deletes a favorite scoped to the owning user', async () => {
    const db = fakeDb();
    const app = appWithUser(7, db);

    const createRes = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'HQ', lat: 40.76, lng: -111.89 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { success: boolean; id: number };
    expect(created.success).toBe(true);

    const listRes = await app.request('/');
    const list = await listRes.json() as Array<{ label: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('HQ');

    const otherUserApp = appWithUser(99, db);
    const forbiddenDelete = await otherUserApp.request(`/${created.id}`, { method: 'DELETE' });
    expect(forbiddenDelete.status).toBe(403);

    const deleteRes = await app.request(`/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
  });

  it('rejects invalid input with 400', async () => {
    const db = fakeDb();
    const app = appWithUser(7, db);

    const missingLabel = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: '   ', lat: 40.76, lng: -111.89 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(missingLabel.status).toBe(400);

    const badLat = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'HQ', lat: 999, lng: -111.89 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(badLat.status).toBe(400);

    const badLng = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'HQ', lat: 40.76, lng: -999 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(badLng.status).toBe(400);

    const listRes = await app.request('/');
    const list = await listRes.json() as Array<{ label: string }>;
    expect(list).toHaveLength(0);
  });

  it('returns 404 when deleting a nonexistent id', async () => {
    const db = fakeDb();
    const app = appWithUser(7, db);

    const deleteRes = await app.request('/999', { method: 'DELETE' });
    expect(deleteRes.status).toBe(404);
  });

  it('filters to staging-flagged favorites via ?staging=true', async () => {
    const db = fakeDb();
    const app = appWithUser(7, db);

    const stagingRes = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'Back Lot', lat: 40.7, lng: -111.8, is_staging: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(stagingRes.status).toBe(200);

    const plainRes = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'HQ', lat: 40.76, lng: -111.89 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(plainRes.status).toBe(200);

    const allList = await (await app.request('/')).json() as Array<{ label: string }>;
    expect(allList).toHaveLength(2);

    const stagingList = await (await app.request('/?staging=true')).json() as Array<{ label: string; is_staging: number }>;
    expect(stagingList).toHaveLength(1);
    expect(stagingList[0].label).toBe('Back Lot');
    expect(stagingList[0].is_staging).toBe(1);
  });
});
