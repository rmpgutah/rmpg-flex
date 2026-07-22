import { describe, it, expect } from 'vitest';
import { makeFakeDb } from '../helpers/fakeD1';
import { runFullListLeg } from '../../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter, SourceMeta } from '../../src/utils/warrantSources/types';

// 2026-07-22 incident follow-up: even with every individual fetch()
// timeout-guarded, a full-list adapter that makes MANY sequential requests
// (e.g. ohio-drc-pval: up to 650) can still legitimately consume the whole
// cron invocation's execution budget on its own, starving every other
// enabled source queued after it in the same leg. runFullListLeg must skip
// remaining adapters once a wall-clock budget is exceeded, rather than
// silently letting one slow source block the rest indefinitely.

function meta(key: string): SourceMeta {
  return {
    key, display_name: key, state: 'US', county: null,
    source_url: `https://example.test/${key}`, kind: 'json', priority: 2,
  };
}

function slowAdapter(key: string, delayMs: number): WarrantSourceAdapter {
  return {
    meta: meta(key),
    mode: 'full-list',
    async fetchAll() {
      await new Promise((r) => setTimeout(r, delayMs));
      return { hits: [] };
    },
  };
}

function fastAdapter(key: string): WarrantSourceAdapter {
  return {
    meta: meta(key),
    mode: 'full-list',
    async fetchAll() {
      return { hits: [] };
    },
  };
}

describe('runFullListLeg budget guard', () => {
  it('processes all adapters when the leg finishes within budget', async () => {
    const db = makeFakeDb([]);
    const summaries = await runFullListLeg(
      db,
      [fastAdapter('a'), fastAdapter('b'), fastAdapter('c')],
      { budgetMs: 5000 },
    );
    expect(summaries.map((s) => s.source_key)).toEqual(['a', 'b', 'c']);
  });

  it('skips remaining adapters once the wall-clock budget is exceeded', async () => {
    const db = makeFakeDb([]);
    // First adapter alone burns past the tiny budget; the second and third
    // must be skipped entirely this tick (no scraper_runs row) rather than
    // waiting behind it — they'll be retried on the next cron tick.
    const summaries = await runFullListLeg(
      db,
      [slowAdapter('slow', 60), fastAdapter('should-be-skipped'), fastAdapter('also-skipped')],
      { budgetMs: 20 },
    );
    expect(summaries.map((s) => s.source_key)).toEqual(['slow']);
  });
});
