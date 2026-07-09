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

function minutesAgoSql(min: number) {
  return new Date(Date.now() - min * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Fake D1 sufficient to exercise closeStaleActiveTrips (called at the top of
 * GET /trip/current) plus /trip/current's own SELECT. `trips` is exposed
 * directly on the returned object so tests can assert on post-call state.
 */
function fakeDb(initialTrips: any[] = []) {
  const trips: any[] = initialTrips.map((t) => ({ ...t }));
  const db = {
    trips,
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('FROM nav_trip_log ntl')) {
                const officerId = args[0];
                const candidates = trips
                  .filter((t) => t.officer_id === officerId
                    && (t.status === 'pending' || t.status === 'active' || t.status === 'paused'))
                  .sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
                return candidates[0] ?? null;
              }
              return null;
            },
            async run() {
              if (
                sql.includes('UPDATE nav_trip_log') &&
                sql.includes("SET status = 'completed'") &&
                sql.includes("status IN ('active', 'paused')")
              ) {
                const officerId = args[0];
                const cutoff = Date.now() - 10 * 60 * 1000;
                for (const t of trips) {
                  if (t.officer_id !== officerId) continue;
                  if (t.status !== 'active' && t.status !== 'paused') continue;
                  const lastActivity = new Date(`${t.updated_at || t.start_time}Z`).getTime();
                  if (lastActivity < cutoff) {
                    t.status = 'completed';
                    t.updated_at = new Date().toISOString();
                  }
                }
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
  return db;
}

describe('nav stale-trip reap', () => {
  it('reaps a paused trip whose last update is older than STALE_ACTIVE_MIN', async () => {
    const db = fakeDb([
      { id: 1, officer_id: 7, status: 'paused', start_time: minutesAgoSql(30), updated_at: minutesAgoSql(20) },
    ]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/current', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(db.trips[0].status).toBe('completed');
  });

  it('does not reap a paused trip updated recently', async () => {
    const db = fakeDb([
      { id: 2, officer_id: 7, status: 'paused', start_time: minutesAgoSql(30), updated_at: minutesAgoSql(2) },
    ]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/current', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(db.trips[0].status).toBe('paused');
  });

  it('GET /trip/current returns a non-stale paused trip as the current trip (not null)', async () => {
    // Regression test: /trip/current's SELECT used to filter on
    // status IN ('pending','active') only, so a genuinely-paused trip (e.g.
    // dwelling at a station geofence) was invisible to the client — it would
    // see { trip: null } and wrongly conclude nothing was in progress, risking
    // a duplicate trip on the next drive-away. The filter now includes 'paused'.
    const db = fakeDb([
      { id: 3, officer_id: 7, status: 'paused', start_time: minutesAgoSql(15), updated_at: minutesAgoSql(2) },
    ]);
    const app = appWithUser(7, db);

    const res = await app.request('/trip/current', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { trip: { id: number; status: string } | null };
    expect(body.trip).not.toBeNull();
    expect(body.trip?.id).toBe(3);
    expect(body.trip?.status).toBe('paused');
  });
});
