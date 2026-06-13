import { describe, it, expect } from 'vitest';
import { runFullListLeg } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter } from '../src/utils/warrantSources/types';

// Updated fake DB for the batched full-list leg:
//   - prepare().bind().all() — used by bulkUpsertScrapedWarrants' preload SELECT
//   - batch() — used by executeBatch inside bulkUpsertScrapedWarrants
//   - prepare().bind().run() / prepare().run() — used by markScrapedCleared (UPDATE)
function fakeDb() {
  const calls: { sql: string }[] = [];
  const mk = (sql: string) => ({
    first: async () => (/SELECT datetime/i.test(sql) ? { now: '2026-06-13 12:00:00' } : null),
    run: async () => { calls.push({ sql }); return { meta: {} }; },
    all: async () => ({ results: [] }),
  });
  const DB: any = {
    prepare(sql: string) { return { bind: (..._b: any[]) => mk(sql), ...mk(sql) }; },
    batch: async (stmts: any[]) => {
      for (const _ of stmts) calls.push({ sql: 'batch-stmt' });
      return stmts.map(() => ({}));
    },
  };
  return { DB, calls };
}

describe('runFullListLeg', () => {
  it('fetches each full-list adapter and batch-upserts its hits', async () => {
    const { DB, calls } = fakeDb();
    const adapter: WarrantSourceAdapter = { meta: { key: 'x', display_name: 'X', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return [{ source_key: 'x', warrant_id: 'w1', full_name: 'Doe, Jane' }]; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].source_key).toBe('x');
    expect(summary[0].found).toBe(1);
    // The batched path uses db.batch() rather than per-hit prepare().run()
    expect(calls.some(c => c.sql === 'batch-stmt')).toBe(true);
  });
  it('does NOT clear-sweep when a source returns zero hits (no wipe on empty/transient)', async () => {
    const { DB, calls } = fakeDb();
    const empty: WarrantSourceAdapter = { meta: { key: 'empty', display_name: 'E', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return []; } };
    const summary = await runFullListLeg(DB, [empty]);
    expect(summary[0].found).toBe(0);
    expect(calls.some((c) => /cleared/i.test(c.sql))).toBe(false);
  });
  it('isolates a throwing adapter (one bad source does not abort others)', async () => {
    const { DB } = fakeDb();
    const bad: WarrantSourceAdapter = { meta: { key: 'bad', display_name: 'B', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { throw new Error('boom'); } };
    const good: WarrantSourceAdapter = { meta: { key: 'good', display_name: 'G', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return [{ source_key: 'good', warrant_id: 'w', full_name: 'A B' }]; } };
    const summary = await runFullListLeg(DB, [bad, good]);
    expect(summary.find(s => s.source_key === 'bad')?.errors).toBe(1);
    expect(summary.find(s => s.source_key === 'good')?.found).toBe(1);
  });
});
