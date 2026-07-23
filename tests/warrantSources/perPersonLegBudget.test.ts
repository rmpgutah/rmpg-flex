import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { runAllSourceScans } from '../../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter, PersonRow, SourceMeta } from '../../src/utils/warrantSources/types';

// 2026-07-22 incident, part 2: even after the full-list leg got timeout +
// budget protection, the cron STILL produced zero scraper_runs/error_log
// rows. Root cause: the per-person leg's deliberate ~8-9s rate-limit sleep
// between each person, times up to 50 persons times 2 adapters, could
// consume ~15 minutes of pure pacing sleep alone — plausibly exceeding
// Cloudflare's wall-clock ceiling for a scheduled waitUntil task and
// silently truncating the WHOLE invocation with no exception ever thrown.
// These tests verify the per-person leg now bails out within a bounded
// budget instead of running unbounded, and does so SAFELY (no wrongful
// clear-sweep on a truncated pass).

function meta(key: string): SourceMeta {
  return {
    key, display_name: key, state: 'ID', county: null,
    source_url: `https://example.test/${key}`, kind: 'html', priority: 2,
  };
}

function makePersons(n: number): PersonRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, first_name: 'Test', middle_name: null, last_name: `Person${i}`, dob: null,
  }));
}

function slowPerPersonAdapter(key: string, delayMsPerPerson: number): WarrantSourceAdapter {
  return {
    meta: meta(key),
    mode: 'per-person',
    async fetchForPerson() {
      await new Promise((r) => setTimeout(r, delayMsPerPerson));
      return [];
    },
  };
}

describe('per-person leg budget guard', () => {
  it('checks all persons across all adapters when comfortably within budget', async () => {
    const { db, calls } = recordingDb();
    const persons = makePersons(3);
    const adapters = [slowPerPersonAdapter('fast-a', 1), slowPerPersonAdapter('fast-b', 1)];
    await runAllSourceScans(db, { skipUtah: true, adapters, persons, delayMs: () => 0 });

    // Both adapters got a warrant_scraper_config UPDATE (i.e. both ran to completion).
    const updates = calls.filter((c) => /UPDATE warrant_scraper_config/.test(c.sql));
    expect(updates.length).toBe(2);
  });

  it('stops processing further persons/adapters once the leg budget is exceeded', async () => {
    const { db, calls } = recordingDb();
    const persons = makePersons(50);
    // Each person fetch takes 30ms with zero inter-person delay — the FIRST
    // adapter alone (50 * 30ms = 1500ms) already exceeds a tiny test budget,
    // so the second adapter must never even start.
    const adapters = [slowPerPersonAdapter('slow-adapter', 30), slowPerPersonAdapter('never-reached', 1)];
    await runAllSourceScans(db, {
      skipUtah: true, adapters, persons, delayMs: () => 0,
      perPersonBudgetMs: 50,
    });

    const updates = calls.filter((c) => /UPDATE warrant_scraper_config/.test(c.sql));
    const updatedSources = updates.map((c) => c.args[c.args.length - 1]);
    expect(updatedSources).toContain('slow-adapter');
    expect(updatedSources).not.toContain('never-reached');
  });

  it('never clear-sweeps a source whose pass was truncated by the budget', async () => {
    const { db, calls } = recordingDb();
    const persons = makePersons(50);
    const adapters = [slowPerPersonAdapter('truncated-adapter', 30)];
    await runAllSourceScans(db, {
      skipUtah: true, adapters, persons, delayMs: () => 0,
      perPersonBudgetMs: 50,
    });

    // markScrapedCleared issues an UPDATE against scraped_warrants — must NOT
    // have been called for a source we only partially checked this tick.
    const sweepCalls = calls.filter((c) => /UPDATE scraped_warrants/.test(c.sql) && /cleared/.test(c.sql));
    expect(sweepCalls.length).toBe(0);
  });
});
