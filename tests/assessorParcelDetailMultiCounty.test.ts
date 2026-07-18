import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../src/utils/parcel-lookup/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/parcel-lookup/lookup')>();
  return { ...actual, dispatchGetParcel: vi.fn() };
});
vi.mock('../src/utils/sl-assessor/lookup', () => ({
  lookupParcelWithFallback: vi.fn(async () => ({
    parcel: null, source: 'none', code: 'no_match', degraded: false, manual_url: '',
  })),
  lookupParcelsWithFallback: vi.fn(async () => ({
    parcels: [], source: 'none', code: 'no_match', degraded: false, manual_url: '',
  })),
}));

import assessorApp from '../src/routes/assessor';
import { dispatchGetParcel } from '../src/utils/parcel-lookup/lookup';

function fakeDb(source: string | null) {
  return {
    prepare: (sql: string) => ({
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => (sql.includes('pragma_table_info') ? { 1: 1 } : null),
      all: async () => ({ results: [] }),
      bind: (..._args: any[]) => ({
        first: async () => {
          if (sql.includes('SELECT source FROM parcel_records')) return source ? { source } : null;
          if (sql.includes('pragma_table_info')) return { 1: 1 };
          return null;
        },
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }),
    }),
  };
}

function buildTestApp() {
  const wrapper = new Hono<{ Bindings: any; Variables: any }>();
  wrapper.use('*', async (c, next) => {
    c.set('user', { id: 1, role: 'admin', username: 'admin', full_name: 'Admin' });
    c.set('userId', 1);
    await next();
  });
  wrapper.route('/', assessorApp);
  return wrapper;
}

describe('GET /parcel/:parcel_no — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to the county client stored in parcel_records.source', async () => {
    (dispatchGetParcel as any).mockResolvedValue({ parcel_number: 'UT-1', sales: [], source: 'utah_county_assessor' });
    const app = buildTestApp();
    const env = { DB: fakeDb('utah_county_assessor'), KV: { get: async () => null, put: async () => {} } };
    const res = await app.fetch(new Request('http://localhost/parcel/UT-1'), env as any);
    expect(dispatchGetParcel).toHaveBeenCalledWith(env, 'UT-1', 'utah');
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.parcel.parcel_number).toBe('UT-1');
  });

  it('never calls dispatchGetParcel for an unknown/never-applied parcel (preserves SL Co default path)', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb(null), KV: { get: async () => null, put: async () => {} } };
    await app.fetch(new Request('http://localhost/parcel/SOME-UNKNOWN'), env as any);
    expect(dispatchGetParcel).not.toHaveBeenCalled();
  });
});
