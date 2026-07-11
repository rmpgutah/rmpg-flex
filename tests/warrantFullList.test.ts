import { describe, it, expect } from 'vitest';
import { runFullListLeg, runAllSourceScans } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter, PersonRow } from '../src/utils/warrantSources/types';

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
    const adapter: WarrantSourceAdapter = { meta: { key: 'x', display_name: 'X', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits: [{ source_key: 'x', warrant_id: 'w1', full_name: 'Doe, Jane' }] }; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].source_key).toBe('x');
    expect(summary[0].found).toBe(1);
    // The batched path uses db.batch() rather than per-hit prepare().run()
    expect(calls.some(c => c.sql === 'batch-stmt')).toBe(true);
  });
  it('does NOT clear-sweep when a source returns zero hits (no wipe on empty/transient)', async () => {
    const { DB, calls } = fakeDb();
    const empty: WarrantSourceAdapter = { meta: { key: 'empty', display_name: 'E', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits: [] }; } };
    const summary = await runFullListLeg(DB, [empty]);
    expect(summary[0].found).toBe(0);
    expect(calls.some((c) => /cleared/i.test(c.sql))).toBe(false);
  });
  it('isolates a throwing adapter (one bad source does not abort others)', async () => {
    const { DB } = fakeDb();
    const bad: WarrantSourceAdapter = { meta: { key: 'bad', display_name: 'B', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { throw new Error('boom'); } };
    const good: WarrantSourceAdapter = { meta: { key: 'good', display_name: 'G', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits: [{ source_key: 'good', warrant_id: 'w', full_name: 'A B' }] }; } };
    const summary = await runFullListLeg(DB, [bad, good]);
    expect(summary.find(s => s.source_key === 'bad')?.errors).toBe(1);
    expect(summary.find(s => s.source_key === 'good')?.found).toBe(1);
  });

  it('does NOT clear-sweep a TRUNCATED roster (>200k) — the un-ingested tail must not be cleared', async () => {
    // Lean fake: track only whether a clear-sweep UPDATE ran (don't accumulate 200k calls).
    let sweepRan = false;
    const DB: any = {
      prepare(sql: string) {
        const stmt = {
          bind: () => stmt,
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => { if (/status='cleared'/.test(sql)) sweepRan = true; return { meta: { changes: 0 } }; },
        };
        return stmt;
      },
      batch: async (stmts: any[]) => stmts.map(() => ({})),
    };
    const hits = Array.from({ length: 200_001 }, (_, i) => ({ source_key: 'big', warrant_id: `w${i}`, full_name: `N, ${i}` }));
    const big: WarrantSourceAdapter = { meta: { key: 'big', display_name: 'Big', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits }; } };
    const summary = await runFullListLeg(DB, [big]);
    expect(summary[0].found).toBe(200_000); // capped
    expect(sweepRan).toBe(false);           // truncation skips the sweep
  });

  it('propagates degraded:true when fetchAll reports a degraded fetch', async () => {
    const { DB } = fakeDb();
    const adapter: WarrantSourceAdapter = { meta: { key: 'deg', display_name: 'Deg', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits: [], degraded: true, degradedReason: 'fetch_threw' }; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].degraded).toBe(true);
  });

  it('reports degraded:false for a normal successful fetchAll result', async () => {
    const { DB } = fakeDb();
    const adapter: WarrantSourceAdapter = { meta: { key: 'ok', display_name: 'Ok', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return { hits: [{ source_key: 'ok', warrant_id: 'w1', full_name: 'A B' }] }; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].degraded).toBe(false);
  });
});

describe('runAllSourceScans — per-person leg clear-sweep guard', () => {
  it('does NOT clear-sweep a per-person source when every fetch errored (no outage wipe)', async () => {
    let sweepRan = false;
    const DB: any = {
      prepare(sql: string) {
        const stmt = {
          bind: () => stmt,
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => { if (/status='cleared'/.test(sql)) sweepRan = true; return { meta: { changes: 0 } }; },
        };
        return stmt;
      },
      batch: async (stmts: any[]) => stmts.map(() => ({})),
    };
    const persons: PersonRow[] = [
      { id: 1, first_name: 'Jane', middle_name: null, last_name: 'Doe', dob: null },
      { id: 2, first_name: 'John', middle_name: null, last_name: 'Roe', dob: null },
    ];
    // A per-person adapter whose endpoint is down — every fetch throws.
    const down: WarrantSourceAdapter = {
      meta: { key: 'ada', display_name: 'Ada', state: 'ID', county: 'Ada', source_url: '', kind: 'portal', priority: 1 },
      mode: 'per-person',
      async fetchForPerson() { throw new Error('endpoint down'); },
    };
    const res = await runAllSourceScans(DB, { adapters: [down], persons, skipUtah: true, delayMs: () => 0 });
    const ada = res.scraped.find(s => s.source_key === 'ada');
    expect(ada?.errors).toBe(2);   // both persons failed
    expect(sweepRan).toBe(false);  // guard skipped the sweep — active warrants preserved
  });
});
