// tests/footage/flexcamRoute.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import flexcam from '../../src/routes/flexcam';

// Wrap the router with a fake auth middleware so requireRole() checks pass.
function makeAuthedApp(role = 'officer') {
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('user', { id: 1, role, username: 'test' }); await next(); });
  app.route('/', flexcam);
  return app;
}
const authedFlexcam = makeAuthedApp('officer');

// vitest attributes first-import transform cost to whichever test triggers it,
// and `src/routes/flexcam` pulls in a heavy module graph — so under a full-suite
// run the first test here can spend most of the 5000ms default budget compiling
// rather than asserting. Observed 2026-07-24: the two court-package cases timing
// out at 7–8.8s and blocking the husky pre-commit gate, with the failing subset
// shifting between runs (whichever test won the race to pay the import cost).
// Raises the ceiling only — these tests still complete in milliseconds once warm.
vi.setConfig({ testTimeout: 30_000 });

describe('flexcam route', () => {
  it('rejects a request with an invalid window', async () => {
    const res = await authedFlexcam.request('/request', {
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
  tripsById?: Record<number, { id: number; start_time: number; end_time: number | null }>;
  chunksByTripId?: Record<number, Array<{
    id: number; request_id: number; seq: number; channel: string;
    from_ts: number; to_ts: number; status: string;
    r2_key: string | null; sha256: string | null; bytes: number;
  }>>;
  // Plain footage_chunks SELECT keyed by request_id (no JOIN — used by /render/:id).
  chunks?: Array<{ seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number }>;
  // Court-package fixtures: a single footage_requests row + its chunk/link/custody children.
  request?: Record<string, unknown> | null;
  links?: Array<{ entity_type: string; entity_id: number }>;
  custody?: Array<{ action: string; actor_name: string | null; reason: string | null; created_at: string }>;
}
function makeRouterDb(fixture: RouterDbFixture): any {
  return {
    prepare(sql: string) {
      const isTripLookup = /FROM\s+unit_trips/i.test(sql);
      const isChunkJoin = /FROM\s+footage_chunks/i.test(sql) && /JOIN\s+footage_requests/i.test(sql);
      const isPlainChunkSelect = /FROM\s+footage_chunks/i.test(sql) && !/JOIN/i.test(sql) && /^\s*SELECT/i.test(sql);
      // /court-package SELECT (no JOIN, plain SELECT FROM footage_requests WHERE id=?).
      const isRequestLookup = /^\s*SELECT[\s\S]*FROM\s+footage_requests\s+WHERE\s+id=/i.test(sql);
      const isLinksSelect = /FROM\s+footage_evidence_links/i.test(sql) && /^\s*SELECT/i.test(sql);
      const isCustodySelect = /FROM\s+footage_custody_log/i.test(sql) && /^\s*SELECT/i.test(sql);
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first() {
          if (isTripLookup) {
            const id = Number(bound[0]);
            return (fixture.tripsById ?? {})[id] ?? null;
          }
          if (isRequestLookup) {
            return fixture.request ?? null;
          }
          return null;
        },
        async all() {
          if (isChunkJoin) {
            const id = Number(bound[0]);
            return { results: (fixture.chunksByTripId ?? {})[id] ?? [] };
          }
          if (isPlainChunkSelect) {
            return { results: fixture.chunks ?? [] };
          }
          if (isLinksSelect) {
            return { results: fixture.links ?? [] };
          }
          if (isCustodySelect) {
            return { results: fixture.custody ?? [] };
          }
          return { results: [] };
        },
        async run() { return { meta: {} }; },
      };
      return stmt;
    },
  };
}

describe('POST /api/flexcam/render/:id (MP4 enqueue path)', () => {
  it('enqueues the FlexCamRemuxDO and returns 202 for MP4 when not yet rendered', async () => {
    const enqueueResponse = { state: 'queued', requestId: 5 };
    const stubStubFetch = vi.fn(async () => new Response(JSON.stringify(enqueueResponse), { status: 200 }));

    const env = {
      DB: makeRouterDb({
        chunks: [{ seq: 0, from_ts: 1, to_ts: 40, status: 'downloaded', r2_key: 'k0', bytes: 100 }],
      }),
      UPLOADS: {},
      FLEXCAM_REMUX: {
        idFromName: vi.fn(() => ({ toString: () => 'id' })),
        get: vi.fn(() => ({ fetch: stubStubFetch })),
      },
    } as any;

    const res = await authedFlexcam.request('/render/5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'mp4' }),
    }, env);

    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.remux_state).toBe('queued');
    expect(body.merged_status).toBe('queued');
    expect(stubStubFetch).toHaveBeenCalled();
  });

  it('preserves existing ts/fmp4 path unchanged', async () => {
    const env = {
      DB: makeRouterDb({
        chunks: [{ seq: 0, from_ts: 1, to_ts: 40, status: 'downloaded', r2_key: 'k0', bytes: 100 }],
      }),
      UPLOADS: {
        get: vi.fn(async (_k: string) => ({ body: new Response(new Uint8Array([0, 0, 0, 8])).body })),
        put: vi.fn(async () => ({ etag: 'x' })),
      },
      FLEXCAM_REMUX: undefined,  // not used on ts path
    } as any;

    const res = await authedFlexcam.request('/render/5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'ts' }),
    }, env);

    expect(res.status).toBe(200);  // existing path returns 200, not 202
    // (don't assert body shape — existing path's response is the existing contract)
  });
});

describe('POST /api/flexcam/footage/:id/court-package (additive enrichment)', () => {
  it('includes merged_sha256 and merged_url in the manifest when merged_status=ready', async () => {
    const env = {
      DB: makeRouterDb({
        // The /court-package SELECT pulls the row by id; provide the locked + merged-ready state.
        request: {
          id: 8, evidence_number: 'FL26-0001', classification: 'evidence',
          preserved_reason: null, from_ts: 1, to_ts: 100, evidence_locked: 1,
          merged_status: 'ready', merged_r2_key: 'flexcam/trips/merged/8.mp4',
          merged_sha256: 'deadbeefcafebabe',
        },
        chunks: [{ seq: 0, from_ts: 1, to_ts: 40, status: 'downloaded', r2_key: 'k0', bytes: 100 }],
        links: [],
        custody: [],
      }),
      UPLOADS: { get: vi.fn(async () => null) },
      PDF_SIGNING_KEY: undefined,
      JWT_SECRET: 'test-secret-32-bytes-long-enough-for-derive',
    } as any;

    const res = await authedFlexcam.request('/footage/8/court-package', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.manifest.merged_sha256).toBe('deadbeefcafebabe');
    expect(body.manifest.merged_url).toContain('/footage/8/continuous');
  });

  it('omits merged_* fields when merged_status is not ready', async () => {
    const env = {
      DB: makeRouterDb({
        request: {
          id: 9, evidence_number: 'FL26-0002', classification: 'evidence',
          preserved_reason: null, from_ts: 1, to_ts: 100, evidence_locked: 1,
          merged_status: 'queued', merged_r2_key: null, merged_sha256: null,
        },
        chunks: [{ seq: 0, from_ts: 1, to_ts: 40, status: 'downloaded', r2_key: 'k0', bytes: 100 }],
        links: [],
        custody: [],
      }),
      UPLOADS: { get: vi.fn(async () => null) },
      PDF_SIGNING_KEY: undefined,
      JWT_SECRET: 'test-secret-32-bytes-long-enough-for-derive',
    } as any;

    const res = await authedFlexcam.request('/footage/9/court-package', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.manifest.merged_sha256).toBeUndefined();
    expect(body.manifest.merged_url).toBeUndefined();
  });
});
