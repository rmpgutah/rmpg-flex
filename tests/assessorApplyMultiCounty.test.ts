import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../src/utils/parcel-lookup/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/parcel-lookup/lookup')>();
  return { ...actual, dispatchGetParcel: vi.fn() };
});

import assessorApp from '../src/routes/assessor';
import { dispatchGetParcel } from '../src/utils/parcel-lookup/lookup';

function makeFakeEnv(businessRow: Record<string, unknown>) {
  return {
    DB: {
      prepare: (sql: string) => ({
        run: async () => ({ meta: { changes: 0 } }),
        first: async () => (sql.includes('pragma_table_info') ? { 1: 1 } : null),
        all: async () => ({ results: [] }),
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('FROM businesses WHERE id')) return businessRow;
            if (sql.includes('pragma_table_info')) return { 1: 1 };
            if (sql.includes('SELECT id FROM parcel_records')) return { id: 1 };
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        }),
      }),
    },
    KV: { get: async () => null, put: async () => {} },
  } as any;
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

describe('POST /apply — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches getParcel by the county resolved from the record address', async () => {
    (dispatchGetParcel as any).mockResolvedValue({
      parcel_number: 'UT-1', source: 'utah_county_assessor', source_url: 'https://utah.example/1',
      owner_of_record: 'X', owner_type: 'individual', owner_mailing_address: null,
      situs_address: null, situs_city: null, situs_zip: null, subdivision: null,
      land_acres: null, land_sqft: null, land_value: null, zoning: null,
      year_built: null, effective_year_built: null, total_bldg_sqft: null, finished_sqft: null,
      basement_sqft: null, garage_sqft: null, stories: null, bedrooms: null, bathrooms: null,
      construction_type: null, improvement_class: null, improvement_value: null,
      market_value_total: null, market_value_land: null, market_value_improvement: null,
      taxable_value: null, assessed_value: null, tax_year: null, legal_description: null,
      plat: null, lot: null, block: null, recorded_document_url: null, recorded_document_type: null,
      sales: [], raw_data_json: {}, account_number: null, serial_number: null, tax_district: null,
    });
    const app = buildTestApp();
    const env = makeFakeEnv({ id: 1, address: '100 E Center St, American Fork, UT 84003' });
    const req = new Request('http://localhost/apply', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: 1, parcel_number: 'UT-1' }),
    });
    await app.fetch(req, env);
    expect(dispatchGetParcel).toHaveBeenCalledWith(env, 'UT-1', 'utah');
  });
});
