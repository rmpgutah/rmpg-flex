// tests/footage/flexcamRoute.test.ts
import { describe, it, expect } from 'vitest';
import flexcam from '../../src/routes/flexcam';

describe('flexcam route', () => {
  it('rejects a request with an invalid window', async () => {
    const res = await flexcam.request('/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: 136022, from: 100, to: 100 }),
    }, { DB: makeStubDb(), UPLOADS: {} } as any);
    expect(res.status).toBe(400);
  });
});

describe('flexcam evidence', () => {
  it('unlock without a reason → not 200 (auth guard or 400)', async () => {
    const res = await flexcam.request('/footage/1/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { DB: makeStubDb(), UPLOADS: {} } as any);
    expect(res.status).not.toBe(200);
  });
});

describe('GET /trips/:tripId/manifest', () => {
  it('rejects a non-numeric tripId with 400', async () => {
    const res = await flexcam.request('/trips/not-a-number/manifest', { method: 'GET' },
      { DB: makeStubDb(), UPLOADS: {} } as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the trip does not exist', async () => {
    // No tripsById entries → queryFirst → null → 404.
    const env = { DB: makeRouterDb({ tripsById: {}, chunksByTripId: {} }), UPLOADS: {} } as any;
    const res = await flexcam.request('/trips/99999/manifest', { method: 'GET' }, env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with empty clips when trip exists but has no downloaded chunks', async () => {
    const env = {
      DB: makeRouterDb({
        tripsById: { 1: { id: 1, start_time: 1, end_time: 100 } },
        chunksByTripId: { 1: [] },
      }),
      UPLOADS: {},
    } as any;
    const res = await flexcam.request('/trips/1/manifest', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tripId).toBe(1);
    expect(body.clips).toEqual([]);
    expect(body.stillDownloading).toBeGreaterThanOrEqual(0);
  });

  it('returns the player manifest for a trip with downloaded chunks', async () => {
    const env = {
      DB: makeRouterDb({
        tripsById: { 2: { id: 2, start_time: 1_000_000, end_time: 1_100_000 } },
        chunksByTripId: {
          2: [
            { id: 10, request_id: 7, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 0 },
          ],
        },
      }),
      UPLOADS: {},
    } as any;
    const res = await flexcam.request('/trips/2/manifest?channel=outside', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tripId).toBe(2);
    expect(body.clips).toHaveLength(1);
    expect(body.clips[0].seq).toBe(0);
  });
});

function makeStubDb() {
  const stmt = { bind: () => stmt, all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: {} }) };
  return { prepare: () => stmt } as any;
}

// Minimal SQL-aware stub: classifies the prepared statement by a substring of
// the SQL, then returns canned rows on .first() / .all() based on the bound
// tripId. Keeps the route handler exercised end-to-end without Miniflare.
interface RouterDbFixture {
  tripsById: Record<number, { id: number; start_time: number; end_time: number | null }>;
  chunksByTripId: Record<number, Array<{
    id: number; request_id: number; seq: number; channel: string;
    from_ts: number; to_ts: number; status: string;
    r2_key: string | null; sha256: string | null; bytes: number;
  }>>;
}
function makeRouterDb(fixture: RouterDbFixture): any {
  return {
    prepare(sql: string) {
      const isTripLookup = /FROM\s+unit_trips/i.test(sql);
      const isChunkJoin = /FROM\s+footage_chunks/i.test(sql) && /JOIN\s+footage_requests/i.test(sql);
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first() {
          if (isTripLookup) {
            const id = Number(bound[0]);
            return fixture.tripsById[id] ?? null;
          }
          return null;
        },
        async all() {
          if (isChunkJoin) {
            const id = Number(bound[0]);
            return { results: fixture.chunksByTripId[id] ?? [] };
          }
          return { results: [] };
        },
        async run() { return { meta: {} }; },
      };
      return stmt;
    },
  };
}
