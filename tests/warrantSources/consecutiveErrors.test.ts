import { describe, it, expect } from 'vitest';
import { recordingDb, makeFakeDb } from '../helpers/fakeD1';
import { runAllSourceScans, runFullListLeg } from '../../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter, PersonRow, SourceMeta } from '../../src/utils/warrantSources/types';

// 2026-07-22 warrant-poller audit: warrant_scraper_config.consecutive_errors
// and national_warrant_sources.consecutive_errors both drive ScrapersTab's
// circuit-breaker/health-grade UI (circuitOpenFromConsecutiveErrors in
// src/routes/scrapers.ts), but the cron sweep — the ONLY unattended writer —
// never updated either column. A source could accumulate dozens of real
// consecutive failures (ada-county-id hit 50 in one tick on 2026-07-18)
// while the UI kept showing it as healthy. These tests verify the fix.

const person: PersonRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1980-01-01' };

function meta(key: string): SourceMeta {
  return {
    key, display_name: key, state: 'ID', county: null,
    source_url: `https://example.test/${key}`, kind: 'html', priority: 2,
  };
}

describe('warrant_scraper_config.consecutive_errors (per-person leg)', () => {
  it('increments consecutive_errors on a failed run', async () => {
    const { db, calls } = recordingDb();
    const failingAdapter: WarrantSourceAdapter = {
      meta: meta('failing-source'),
      mode: 'per-person',
      async fetchForPerson() { throw new Error('boom'); },
    };
    await runAllSourceScans(db, { skipUtah: true, adapters: [failingAdapter], persons: [person] });

    const configUpdate = calls.find((c) => /UPDATE warrant_scraper_config/.test(c.sql));
    expect(configUpdate).toBeTruthy();
    expect(configUpdate!.sql).toMatch(/consecutive_errors/);
    // status, status, errMsg, status, sourceKey — the 4th bound param (2nd
    // 'status' reuse for the consecutive_errors CASE) must be 'failed'.
    expect(configUpdate!.args[0]).toBe('failed');
    expect(configUpdate!.args[3]).toBe('failed');
  });

  it('resets consecutive_errors to 0 on a clean run', async () => {
    const { db, calls } = recordingDb();
    const cleanAdapter: WarrantSourceAdapter = {
      meta: meta('clean-source'),
      mode: 'per-person',
      async fetchForPerson() { return []; },
    };
    await runAllSourceScans(db, { skipUtah: true, adapters: [cleanAdapter], persons: [person] });

    const configUpdate = calls.find((c) => /UPDATE warrant_scraper_config/.test(c.sql));
    expect(configUpdate).toBeTruthy();
    expect(configUpdate!.args[0]).toBe('completed');
    expect(configUpdate!.args[3]).toBe('completed');
  });
});

describe('national_warrant_sources.consecutive_errors (full-list leg)', () => {
  it('increments consecutive_errors on a fetchAll failure', async () => {
    const { db, calls } = recordingDb();
    const failingAdapter: WarrantSourceAdapter = {
      meta: meta('failing-fulllist'),
      mode: 'full-list',
      async fetchAll() { throw new Error('boom'); },
    };
    await runFullListLeg(db, [failingAdapter]);

    const healthUpdate = calls.find((c) => /UPDATE national_warrant_sources/.test(c.sql));
    expect(healthUpdate).toBeTruthy();
    expect(healthUpdate!.sql).toMatch(/consecutive_errors/);
    expect(healthUpdate!.args).toEqual([1, 'failing-fulllist']);
  });

  it('resets consecutive_errors to 0 on a clean fetchAll run', async () => {
    const { db, calls } = recordingDb();
    const cleanAdapter: WarrantSourceAdapter = {
      meta: meta('clean-fulllist'),
      mode: 'full-list',
      async fetchAll() { return { hits: [] }; },
    };
    await runFullListLeg(db, [cleanAdapter]);

    const healthUpdate = calls.find((c) => /UPDATE national_warrant_sources/.test(c.sql));
    expect(healthUpdate).toBeTruthy();
    expect(healthUpdate!.args).toEqual([0, 'clean-fulllist']);
  });

  it('is a safe no-op for code-resident adapters with no national_warrant_sources row', async () => {
    // FBI/Utah County/Ohio DRC are code-resident — they have no row in
    // national_warrant_sources at all. The UPDATE's WHERE clause simply
    // matches zero rows for them; this must not throw.
    const db = makeFakeDb([]);
    const codeResidentAdapter: WarrantSourceAdapter = {
      meta: meta('code-resident-source'),
      mode: 'full-list',
      async fetchAll() { return { hits: [] }; },
    };
    await expect(runFullListLeg(db, [codeResidentAdapter])).resolves.toBeTruthy();
  });
});
