// Route-level smoke tests (Miniflare/workerd) for the Mapbox Optimization V2 route.
// Tests three key behaviours:
//   1. Missing token → not_configured (skipped: true)
//   2. Complete job row → solution returned from D1 without hitting Mapbox
//   3. GET / → returns jobs array
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import mapboxOptV2 from '../src/routes/mapboxOptimizationV2';

const FAKE_JOB_ID = 'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal D1 stub that always returns the given rows. */
function makeDb(rows: Record<string, unknown>[] = []) {
  const stmt = {
    bind: (..._args: unknown[]) => stmt,
    all: async () => ({ results: rows }),
    first: async () => rows[0] ?? null,
    run: async () => ({ meta: { last_row_id: 1, changes: 1 } }),
  };
  return { prepare: () => stmt };
}

/** Build a test app that injects a fake user + custom env overrides. */
function makeApp(
  envOverrides: Record<string, unknown>,
  user: { id: number; role: string } = { id: 1, role: 'supervisor' },
) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/', mapboxOptV2);
  return { app, mergedEnv: { ...(env as unknown as Record<string, unknown>), ...envOverrides } };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /submit — token missing', () => {
  it('returns not_configured when both Mapbox tokens are unset', async () => {
    const { app, mergedEnv } = makeApp({
      MAPBOX_ACCESS_TOKEN: undefined,
      MAPBOX_SECRET_TOKEN: undefined,
      DB: makeDb(),
    });
    const res = await app.request(
      '/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_type: 'serve_run' }),
      },
      mergedEnv,
    );
    // notConfigured always returns HTTP 200
    expect(res.status).toBe(200);
    const json = await res.json() as { skipped: boolean; code: string };
    expect(json.skipped).toBe(true);
    expect(json.code).toBe('not_configured');
  });
});

describe('GET /:jobId — complete job', () => {
  it('returns solution from D1 without hitting Mapbox', async () => {
    const solution = { dropped: { services: [], shipments: [] }, routes: [] };
    const jobRow = {
      id: FAKE_JOB_ID,
      job_type: 'serve_run',
      status: 'complete',
      solution_json: JSON.stringify(solution),
      ref_id: null,
      created_by: 1,
      updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    const { app, mergedEnv } = makeApp({
      MAPBOX_ACCESS_TOKEN: 'pk.test',
      DB: makeDb([jobRow]),
    });
    const res = await app.request(`/${FAKE_JOB_ID}`, { method: 'GET' }, mergedEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; solution: unknown };
    expect(json.status).toBe('complete');
    expect(json.solution).toBeDefined();
  });
});

describe('POST /submit — serve_run as officer', () => {
  it('does not require a supervisor role when origin is provided', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('should not hit Mapbox without a token');
    }) as typeof fetch;
    try {
      const { app, mergedEnv } = makeApp(
        {
          MAPBOX_ACCESS_TOKEN: undefined,
          MAPBOX_SECRET_TOKEN: undefined,
          DB: makeDb(),
        },
        { id: 9, role: 'officer' },
      );
      const res = await app.request(
        '/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_type: 'serve_run',
            serve_queue_ids: [10, 11],
            shift_start: '2026-08-28T20:30:00.000Z',
            shift_end: '2026-08-29T04:30:00.000Z',
            origin: { lat: 40.7, lng: -111.8 },
            circular: true,
          }),
        },
        mergedEnv,
      );
      expect(res.status).toBe(200);
      const json = await res.json() as { skipped?: boolean; error?: string };
      expect(json.skipped).toBe(true);
      expect(json.error).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('GET / — list jobs', () => {
  it('returns empty array when no jobs exist', async () => {
    const { app, mergedEnv } = makeApp({
      MAPBOX_ACCESS_TOKEN: 'pk.test',
      DB: makeDb([]),
    });
    const res = await app.request('/', { method: 'GET' }, mergedEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as { jobs: unknown[] };
    expect(Array.isArray(json.jobs)).toBe(true);
    expect(json.jobs.length).toBe(0);
  });
});
