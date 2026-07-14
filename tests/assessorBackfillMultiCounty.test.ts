import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/parcel-lookup/lookup', () => ({
  dispatchSearchByAddress: vi.fn(),
  dispatchGetParcel: vi.fn(),
  resolveCountyFromAddress: vi.fn(),
}));

import { dispatchSearchByAddress } from '../src/utils/parcel-lookup/lookup';
import { processBackfillTick } from '../src/utils/sl-assessor/backfill';

function makeFakeEnv(rows: Array<{ id: number; record_type: string; record_id: number; retry_count: number }>) {
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
            return { id: args[0], address: '100 E Center St, American Fork, UT 84003' };
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
    expect(dispatchSearchByAddress).toHaveBeenCalledWith(env, '100 E Center St, American Fork, UT 84003');
  });
});
