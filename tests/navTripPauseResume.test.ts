import { describe, it, expect } from 'vitest';
import nav from '../src/routes/nav';
import { Hono } from 'hono';
import type { Env } from '../src/types';

function appWithUser(userId: number, db: any) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('userId', userId); c.env = { DB: db } as any; await next(); });
  app.route('/', nav);
  return app;
}

function fakeDb(initialTrips: any[] = []) {
  const trips: any[] = initialTrips.map((t) => ({ ...t }));
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, officer_id, status FROM nav_trip_log WHERE id = ?')) {
                const trip = trips.find((t) => t.id === args[0]);
                return trip ? { id: trip.id, officer_id: trip.officer_id, status: trip.status } : null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith("UPDATE nav_trip_log SET status = 'paused'")) {
                const trip = trips.find((t) => t.id === args[0]);
                if (trip) trip.status = 'paused';
                return { meta: {} };
              }
              if (sql.startsWith("UPDATE nav_trip_log SET status = 'active'")) {
                const trip = trips.find((t) => t.id === args[0]);
                if (trip) trip.status = 'active';
                return { meta: {} };
              }
              return { meta: {} };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

describe('nav trip pause/resume', () => {
  it('pauses an active trip owned by the caller', async () => {
    const db = fakeDb([{ id: 1, officer_id: 7, status: 'active' }]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/1/pause', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('paused');
  });

  it('resumes a paused trip owned by the caller', async () => {
    const db = fakeDb([{ id: 2, officer_id: 7, status: 'paused' }]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/2/resume', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('active');
  });

  it('rejects resuming a trip that is not paused', async () => {
    const db = fakeDb([{ id: 3, officer_id: 7, status: 'active' }]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/3/resume', { method: 'PUT' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('not paused');
  });

  it('rejects pause/resume from a non-owning user with 403', async () => {
    const db = fakeDb([{ id: 4, officer_id: 7, status: 'active' }]);
    const otherApp = appWithUser(99, db);

    const pauseRes = await otherApp.request('/trip/4/pause', { method: 'PUT' });
    expect(pauseRes.status).toBe(403);
  });

  it('returns 404 for a nonexistent trip id', async () => {
    const db = fakeDb([]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/999/pause', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid trip id', async () => {
    const db = fakeDb([]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/abc/pause', { method: 'PUT' });
    expect(res.status).toBe(400);
  });
});
