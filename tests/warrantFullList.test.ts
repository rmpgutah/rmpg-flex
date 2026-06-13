import { describe, it, expect } from 'vitest';
import { runFullListLeg } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter } from '../src/utils/warrantSources/types';

function fakeDb() {
  const calls: { sql: string }[] = [];
  const mk = (sql: string) => ({ first: async () => (/SELECT datetime/i.test(sql) ? { now: '2026-06-13 12:00:00' } : null), run: async () => { calls.push({ sql }); return { meta: {} }; }, all: async () => ({ results: [] }) });
  const DB: any = { prepare(sql: string) { return { bind: () => mk(sql), ...mk(sql) }; } };
  return { DB, calls };
}

describe('runFullListLeg', () => {
  it('fetches each full-list adapter and upserts its hits', async () => {
    const { DB, calls } = fakeDb();
    const adapter: WarrantSourceAdapter = { meta: { key: 'x', display_name: 'X', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return [{ source_key: 'x', warrant_id: 'w1', full_name: 'Doe, Jane' }]; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].source_key).toBe('x');
    expect(summary[0].found).toBe(1);
    expect(calls.some(c => /INSERT INTO scraped_warrants/i.test(c.sql))).toBe(true);
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
