import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/parcel-lookup/lookup', () => ({
  dispatchSearchByAddress: vi.fn(),
  dispatchGetParcel: vi.fn(),
  resolveEffectiveCounty: vi.fn(() => 'utah'),
}));

import { dispatchSearchByAddress } from '../src/utils/parcel-lookup/lookup';
import { processBackfillTick } from '../src/utils/sl-assessor/backfill';

function makeFakeEnv(
  rows: Array<{ id: number; record_type: string; record_id: number; retry_count: number }>,
  jurisdictionOverride: string | null = null,
  addressRow: { address: string; city: string | null } = {
    address: '100 E Center St, American Fork, UT 84003', city: null,
  },
) {
  const dbRows = rows;
  const db = {
    prepare: (sql: string) => ({
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => {
        if (sql.includes('pragma_table_info')) return { 1: 1 };
        if (sql.includes('FROM assessor_backfill_jobs') && sql.includes('LIMIT 1')) {
          return dbRows.shift() ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM assessor_backfill_jobs') && sql.includes('LIMIT 1')) {
            return dbRows.shift() ?? null;
          }
          if (sql.includes('FROM businesses') || sql.includes('FROM properties')) {
            return {
              id: args[0],
              address: addressRow.address,
              city: addressRow.city,
              jurisdiction_override: jurisdictionOverride,
            };
          }
          if (sql.includes('pragma_table_info')) return { 1: 1 };
          return null;
        },
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }),
    }),
  };
  return { DB: db, KV: { get: async () => null, put: async () => {} } } as any;
}

describe('processBackfillTick — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls dispatchSearchByAddress instead of the SL-Co-only client directly', async () => {
    (dispatchSearchByAddress as any).mockResolvedValue([]);
    const env = makeFakeEnv([{ id: 1, record_type: 'business', record_id: 42, retry_count: 0 }]);
    await processBackfillTick(env);
    expect(dispatchSearchByAddress).toHaveBeenCalledWith(env, '100 E Center St, American Fork, UT 84003', null);
  });

  it('passes the record jurisdiction_override through to dispatchSearchByAddress', async () => {
    (dispatchSearchByAddress as any).mockResolvedValue([]);
    const env = makeFakeEnv([{ id: 1, record_type: 'business', record_id: 42, retry_count: 0 }], 'tooele');
    await processBackfillTick(env);
    expect(dispatchSearchByAddress).toHaveBeenCalledWith(env, '100 E Center St, American Fork, UT 84003', 'tooele');
  });

  it('appends the record city column to a bare street address before dispatching', async () => {
    // County resolution needs a city to route correctly — a bare street
    // substring-matches unreliably (see resolveCountyFromAddress). The
    // stored `address` column often has no city baked in, unlike this
    // test file's other fixtures.
    (dispatchSearchByAddress as any).mockResolvedValue([]);
    const env = makeFakeEnv(
      [{ id: 1, record_type: 'business', record_id: 42, retry_count: 0 }],
      null,
      { address: '100 E Center St', city: 'American Fork' },
    );
    await processBackfillTick(env);
    expect(dispatchSearchByAddress).toHaveBeenCalledWith(env, '100 E Center St, American Fork', null);
  });
});
