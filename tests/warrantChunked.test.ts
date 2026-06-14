import { describe, it, expect } from 'vitest';
import {
  readSourceProgress, saveSourceProgress, completeSourceCycle, upsertScrapedWarrantsBatch,
} from '../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../src/utils/warrantSources/types';

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
