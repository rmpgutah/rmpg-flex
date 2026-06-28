import { describe, it, expect } from 'vitest';
import { bulkUpsertScrapedWarrants } from '../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../src/utils/warrantSources/types';

function fakeDb(existingIds: string[] = []) {
  const calls: { sql: string }[] = [];
  const DB: any = {
    prepare(sql: string) {
      return { bind: (..._b: any[]) => ({
        all: async () => ({ results: existingIds.map((wid) => ({ warrant_id: wid })) }),
        first: async () => null, run: async () => { calls.push({ sql }); return { meta: {} }; },
      }) };
    },
    batch: async (stmts: any[]) => { for (const _ of stmts) calls.push({ sql: 'batch-stmt' }); return stmts.map(() => ({})); },
  };
  return { DB, calls };
}

describe('bulkUpsertScrapedWarrants', () => {
  it('batch-writes new hits and returns the count', async () => {
    const { DB, calls } = fakeDb([]);
    const hits: RawWarrantHit[] = [
      { source_key: 's', warrant_id: 'a', full_name: 'Doe, A' },
      { source_key: 's', warrant_id: 'b', full_name: 'Roe, B' },
    ];
    const n = await bulkUpsertScrapedWarrants(DB, 's', hits);
    expect(n).toBe(2);
    expect(calls.some((c) => c.sql === 'batch-stmt')).toBe(true);
  });
  it('processes a mix of existing (update) and new (insert) ids', async () => {
    const { DB } = fakeDb(['a']);
    const hits: RawWarrantHit[] = [
      { source_key: 's', warrant_id: 'a', full_name: 'Doe, A' },
      { source_key: 's', warrant_id: 'c', full_name: 'New, C' },
    ];
    const n = await bulkUpsertScrapedWarrants(DB, 's', hits);
    expect(n).toBe(2);
  });
  it('returns 0 for an empty hit list (no batch call)', async () => {
    const { DB, calls } = fakeDb([]);
    expect(await bulkUpsertScrapedWarrants(DB, 's', [])).toBe(0);
    expect(calls.filter((c) => c.sql === 'batch-stmt')).toHaveLength(0);
  });
});
