import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../src/utils/parcel-lookup/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/parcel-lookup/lookup')>();
  return {
    ...actual,
    dispatchSearchByAddress: vi.fn(async (_env: any, address: string) => {
      if (address.includes('American Fork')) {
        return [{ parcel_number: 'UT-1', owner_of_record: 'X', situs_address: address, land_sqft: null, total_market_value: null, detail_url: 'https://utah.example/1' }];
      }
      return [];
    }),
  };
});

import assessorApp from '../src/routes/assessor';
import { dispatchSearchByAddress } from '../src/utils/parcel-lookup/lookup';

function fakeDb() {
  return {
    prepare: (sql: string) => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => (sql.includes('pragma_table_info') ? { 1: 1 } : null),
      all: async () => ({ results: [] }),
      bind: (..._args: any[]) => ({
        run: async () => ({ meta: { changes: 0 } }),
        first: async () => (sql.includes('pragma_table_info') ? { 1: 1 } : null),
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

describe('GET /parcels — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a Utah County address through the dispatch layer', async () => {
    const app = buildTestApp();
    const fakeEnv = { DB: fakeDb(), KV: { get: async () => null, put: async () => {} } };
    const address = '100 E Center St, American Fork, UT 84003';
    const req = new Request('http://localhost/parcels?address=' + encodeURIComponent(address));
    const res = await app.fetch(req, fakeEnv as any);
    expect(dispatchSearchByAddress).toHaveBeenCalled();
    const body = await res.json() as any;
    expect(body.parcels[0]?.parcel_number).toBe('UT-1');
  });
});
