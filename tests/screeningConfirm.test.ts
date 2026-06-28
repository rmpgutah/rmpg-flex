import { describe, it, expect } from 'vitest';
import { confirmScreeningHit, dismissScreeningHit } from '../src/utils/screening/confirm';

// Minimal fake DB/env: confirm.ts looks up the hit, calls the adapter's confirmHit,
// then marks the row confirmed. We assert it returns the adapter's promotedRef and sets status.
function fakeEnv(hitRow: any) {
  const calls: any[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind: (...b: any[]) => ({
          first: async () => (sql.includes('SELECT') ? hitRow : null),
          run: async () => { calls.push({ sql, b }); return { meta: {} }; },
          all: async () => ({ results: [] }),
        }),
        first: async () => (sql.includes('SELECT') ? hitRow : null),
        run: async () => { calls.push({ sql, b: [] }); return { meta: {} }; },
      };
    },
  };
  return { env: { DB, KV: { get: async () => null, put: async () => {} } } as any, calls };
}

describe('confirmScreeningHit', () => {
  it('marks an unknown source hit confirmed and returns a promotedRef', async () => {
    const { env } = fakeEnv({ id: 1, source_key: 'utah-sor', person_id: 5, external_id: 'X', status: 'pending', display_name: 'A B' });
    const res = await confirmScreeningHit(env, 1, 99);
    expect(res.status).toBe('confirmed');
    expect(typeof res.promotedRef).toBe('string');
  });
  it('throws on a missing hit', async () => {
    const { env } = fakeEnv(null);
    await expect(confirmScreeningHit(env, 404, 99)).rejects.toThrow();
  });
});

describe('dismissScreeningHit', () => {
  it('marks a hit dismissed', async () => {
    const { env } = fakeEnv({ id: 2, source_key: 'ofac-csl', person_id: 5, external_id: 'Y', status: 'pending' });
    const res = await dismissScreeningHit(env, 2, 99);
    expect(res.status).toBe('dismissed');
  });
});
