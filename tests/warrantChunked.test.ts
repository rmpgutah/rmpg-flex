import { describe, it, expect } from 'vitest';
import {
  readSourceProgress, saveSourceProgress, completeSourceCycle, upsertScrapedWarrantsBatch,
} from '../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../src/utils/warrantSources/types';
import { runFullListLeg } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter } from '../src/utils/warrantSources/types';

// Fake D1 that records every SQL string from prepare().run() and batch().
export function fakeDb(progressRow: Record<string, unknown> | null = null) {
  const runs: string[] = [];
  const batched: string[] = [];
  const mk = (sql: string): any => ({
    __sql: sql,
    bind: (..._a: unknown[]) => mk(sql),
    first: async () => (/national_warrant_source_progress/i.test(sql) ? progressRow : null),
    run: async () => { runs.push(sql); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  });
  const DB: any = {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: { __sql: string }[]) => { for (const s of stmts) batched.push(s.__sql); return stmts.map(() => ({ meta: {} })); },
  };
  return { DB, runs, batched };
}

const hit = (id: string): RawWarrantHit => ({ source_key: 's', warrant_id: id, full_name: 'A B' });

describe('source progress helpers', () => {
  it('readSourceProgress returns null when no row exists', async () => {
    const { DB } = fakeDb(null);
    expect(await readSourceProgress(DB, 's')).toBeNull();
  });

  it('saveSourceProgress upserts cursor + cycle_started_at keyed by source_key', async () => {
    const { DB, runs } = fakeDb();
    await saveSourceProgress(DB, 's', '6000', '2026-06-13T00:00:00.000Z', 6000);
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && /ON CONFLICT\(source_key\)/i.test(s))).toBe(true);
  });

  it('completeSourceCycle resets cursor to NULL and stamps last_full_cycle_at', async () => {
    const { DB, runs } = fakeDb();
    await completeSourceCycle(DB, 's', '2026-06-18T00:00:00.000Z');
    const sql = runs.find(s => /national_warrant_source_progress/i.test(s))!;
    expect(sql).toMatch(/last_full_cycle_at/);
    expect(sql).toMatch(/cursor\s*=\s*NULL|cursor[^,]*NULL/i);
  });
});

describe('upsertScrapedWarrantsBatch', () => {
  it('batches inserts via ON CONFLICT and returns the found count', async () => {
    const { DB, batched } = fakeDb();
    const res = await upsertScrapedWarrantsBatch(DB, [hit('w1'), hit('w2'), hit('w3')], null);
    expect(res.found).toBe(3);
    expect(res.errors).toBe(0);
    expect(batched.every(s => /INSERT INTO scraped_warrants/i.test(s) && /ON CONFLICT\(source_key, warrant_id\)/i.test(s))).toBe(true);
  });
});

const chunkAdapter = (res: { hits: any[]; nextCursor: string | null; done: boolean }): WarrantSourceAdapter => ({
  meta: { key: 's', display_name: 'S', state: 'US', county: null, source_url: '', kind: 'arcgis', priority: 2 },
  mode: 'full-list',
  async fetchChunk() { return res; },
});

describe('runFullListLeg — chunked cycle gate', () => {
  const NOW = () => '2026-06-13T00:00:00.000Z';

  it('mid-cycle (done=false): advances cursor, NO clear-sweep', async () => {
    const { DB, runs, batched } = fakeDb(null);
    const adapter = chunkAdapter({ hits: [hit('w1'), hit('w2')], nextCursor: '6000', done: false });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(summary[0].found).toBe(2);
    expect(batched.length).toBeGreaterThan(0);                                   // rows were upserted
    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(false);  // NO sweep
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && !/last_full_cycle_at/i.test(s))).toBe(true);
  });

  it('final chunk (done=true): clear-sweep fires + cycle resets', async () => {
    const { DB, runs } = fakeDb({ cursor: '6000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 6000 });
    const adapter = chunkAdapter({ hits: [hit('w7')], nextCursor: '6037', done: true });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(true);    // sweep
    expect(runs.some(s => /national_warrant_source_progress/i.test(s) && /last_full_cycle_at/i.test(s))).toBe(true);  // reset
  });

  it('resume: passes the persisted cursor into fetchChunk', async () => {
    const { DB } = fakeDb({ cursor: '4000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 4000 });
    let seenCursor: string | null = 'UNSET';
    const adapter: WarrantSourceAdapter = {
      meta: { key: 's', display_name: 'S', state: 'US', county: null, source_url: '', kind: 'arcgis', priority: 2 },
      mode: 'full-list',
      async fetchChunk(cursor) { seenCursor = cursor; return { hits: [], nextCursor: cursor, done: false }; },
    };
    await runFullListLeg(DB, [adapter], { now: NOW });
    expect(seenCursor).toBe('4000');
  });

  it('batch errors on a done=true chunk: NO clear-sweep, NO cycle complete, retries same cursor', async () => {
    // Force every D1 batch() to fail → upsertScrapedWarrantsBatch reports errors>0.
    // Even though the adapter says done=true, the gate must NOT sweep/complete
    // (a sweep would wrongly clear active warrants that just failed to re-store).
    const { DB, runs } = fakeDb({ cursor: '6000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 6000 });
    DB.batch = async () => { throw new Error('D1_ERROR: transient'); };
    const adapter = chunkAdapter({ hits: [hit('w7')], nextCursor: '6037', done: true });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(summary[0].errors).toBeGreaterThan(0);
    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(false);  // NO sweep despite done
    expect(runs.some(s => /last_full_cycle_at/i.test(s))).toBe(false);                            // NOT completed
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && !/last_full_cycle_at/i.test(s))).toBe(true);  // cursor persisted unchanged
  });

  it('propagates degraded:true from a chunked fetch that degraded instead of throwing', async () => {
    const { DB } = fakeDb(null);
    const adapter: WarrantSourceAdapter = {
      meta: { key: 's', display_name: 'S', state: 'US', county: null, source_url: '', kind: 'arcgis', priority: 2 },
      mode: 'full-list',
      async fetchChunk() { return { hits: [], nextCursor: null, done: false, degraded: true, degradedReason: 'http_500' }; },
    };
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });
    expect(summary[0].degraded).toBe(true);
  });
});
