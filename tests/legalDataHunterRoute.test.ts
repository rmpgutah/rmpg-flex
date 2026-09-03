// ============================================================
// Route-level tests: /api/legal-data-hunter rate-budget wiring
// ============================================================
// Verifies the fix for the live-call path bypassing the KV rate
// budget: every live /v1/resolve|/v1/search call must first pass
// checkAndReserveLdhCall, and an exhausted budget returns
// 200 { ok:false, code:'rate_limited' } without touching the API.
// Also covers the GET /usage endpoint (admin/manager only).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { LDH_MINUTE_BUDGET } from '../src/utils/legalDataHunter/rateLimit';

const resolveCitation = vi.fn();
const searchLegislation = vi.fn();

vi.mock('../src/utils/legalDataHunter/client', () => ({
  configFromEnv: () => ({ apiKey: 'test-key', baseUrl: 'https://legaldatahunter.com' }),
  resolveCitation: (...args: unknown[]) => resolveCitation(...args),
  searchLegislation: (...args: unknown[]) => searchLegislation(...args),
}));

import legalDataHunter from '../src/routes/legalDataHunter';

function makeFakeKv(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    async get(key: string) { return store.has(key) ? store.get(key)! : null; },
    async put(key: string, value: string) { store.set(key, value); },
  };
}

/** Stub D1: no local statute hit, no cache hit, writes succeed. */
function makeFakeDb() {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1, last_row_id: 1 } }),
  };
  return { prepare: () => stmt };
}

function makeApp(role = 'officer') {
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('user', { id: 1, role }); await next(); });
  app.route('/', legalDataHunter);
  return app;
}

function envWith(kv: ReturnType<typeof makeFakeKv>) {
  return { DB: makeFakeDb(), KV: kv, LEGAL_DATA_HUNTER_API_KEY: 'test-key' } as any;
}

beforeEach(() => {
  resolveCitation.mockReset();
  searchLegislation.mockReset();
  searchLegislation.mockResolvedValue({ hits: [] });
  resolveCitation.mockResolvedValue({ resolved: false, documents: [] });
});

describe('POST /validate rate-budget wiring', () => {
  it('makes the live call and burns a KV counter when under budget', async () => {
    const kv = makeFakeKv();
    const res = await makeApp().request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ charge: 'aggravated mopery in the first degree' }),
    }, envWith(kv));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(searchLegislation).toHaveBeenCalledTimes(1);
    // The reservation wrote both counters.
    const keys = [...kv.store.keys()];
    expect(keys.some((k) => k.includes(':day:'))).toBe(true);
    expect(keys.some((k) => k.includes(':minute:'))).toBe(true);
  });

  it('returns rate_limited and skips the live call when the minute budget is exhausted', async () => {
    const nowMs = Date.now();
    const flooredMinute = Math.floor(nowMs / 60_000) * 60_000;
    const kv = makeFakeKv({
      [`legal_data_hunter:usage:minute:${flooredMinute}`]: String(LDH_MINUTE_BUDGET),
    });
    const res = await makeApp().request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ charge: 'aggravated mopery in the first degree' }),
    }, envWith(kv));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ ok: false, code: 'rate_limited', reason: 'minute_limit' });
    expect(searchLegislation).not.toHaveBeenCalled();
    expect(resolveCitation).not.toHaveBeenCalled();
  });
});

describe('GET /usage', () => {
  it('reports today\'s call count for an admin', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const kv = makeFakeKv({ [`legal_data_hunter:usage:day:${day}`]: '5' });
    const res = await makeApp('admin').request('/usage', {}, envWith(kv));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ ok: true, calls_today: 5, daily_budget: 18 });
  });

  it('rejects a non-admin/manager role', async () => {
    const res = await makeApp('officer').request('/usage', {}, envWith(makeFakeKv()));
    expect(res.status).toBe(403);
  });
});
