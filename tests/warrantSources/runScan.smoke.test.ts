import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { runAllSourceScans } from '../../src/utils/warrantSources/runScan';
import type {
  WarrantSourceAdapter,
  RawWarrantHit,
  PersonRow,
  SourceMeta,
} from '../../src/utils/warrantSources/types';

// ── Test doubles ────────────────────────────────────────────
// A DOB-bearing person so reconcile yields a CONFIRMED hit (promotion path).
const person: PersonRow = {
  id: 7,
  first_name: 'John',
  middle_name: null,
  last_name: 'Smith',
  dob: '1980-01-01',
};

function meta(key: string): SourceMeta {
  return {
    key,
    display_name: key,
    state: 'ID',
    county: null,
    source_url: `https://example.test/${key}`,
    kind: 'html', // non-api so the orchestrator's api-filter keeps it
    priority: 2,
  };
}

// A shared warrant_id reported by TWO sources — reconcile must collapse it to a
// single canonical hit (proving cross-source dedup → no double-promote).
function adapterReturning(key: string, hits: RawWarrantHit[]): WarrantSourceAdapter {
  return {
    meta: meta(key),
    mode: 'per-person',
    async fetchForPerson() {
      return hits;
    },
  };
}

const sharedHit = (source_key: string): RawWarrantHit => ({
  source_key,
  warrant_id: 'SHARED-1',
  first_name: 'John',
  last_name: 'Smith',
  // Identity gate requires name AND DOB/age on both sides; name-only hits
  // are filtered out of reconcileHits and never promoted to warrants.
  date_of_birth: person.dob,
  charge_description: 'AGGRAVATED ASSAULT',
  court_name: 'Ada County District Court',
  issue_date: '2026-01-15',
});

describe('runAllSourceScans (orchestrator smoke)', () => {
  it('scans sources x persons, upserts scraped, clears, and promotes deduped confirmed hits once', async () => {
    const { db, calls } = recordingDb([]);

    const adapterA = adapterReturning('ada-county-id', [sharedHit('ada-county-id')]);
    const adapterB = adapterReturning('natrona-county-wy', [sharedHit('natrona-county-wy')]);

    const summary = await runAllSourceScans(db, {
      skipUtah: true,
      adapters: [adapterA, adapterB],
      persons: [person],
      delayMs: () => 0,
    });

    // ── scraped_warrants upsert happened (one INSERT per source for this person) ──
    const scrapedInserts = calls.filter((c) => /INSERT INTO scraped_warrants/i.test(c.sql));
    expect(scrapedInserts.length).toBe(2);

    // ── markScrapedCleared ran for EACH source ──
    const clears = calls.filter((c) => /UPDATE scraped_warrants SET status='cleared'/i.test(c.sql));
    expect(clears.length).toBe(2);
    expect(clears.some((c) => c.args.includes('ada-county-id'))).toBe(true);
    expect(clears.some((c) => c.args.includes('natrona-county-wy'))).toBe(true);

    // ── promotion to canonical `warrants`: the SHARED warrant (in both sources)
    //    reconciles to ONE canonical hit → promoted exactly ONCE (no double-promote) ──
    const promotions = calls.filter((c) => /INSERT INTO warrants/i.test(c.sql));
    expect(promotions.length).toBe(1);

    // ── a warrant_found watch-log event fired for the newly-promoted confirmed hit ──
    const foundEvents = calls.filter(
      (c) => /INSERT INTO warrant_watch_log/i.test(c.sql) && c.args.includes('warrant_found'),
    );
    expect(foundEvents.length).toBe(1);

    // ── summary shape: one scraped source entry per adapter, utah skipped ──
    expect(summary.scraped.length).toBe(2);
    const ada = summary.scraped.find((s) => s.source_key === 'ada-county-id');
    expect(ada).toBeTruthy();
    expect(ada!.found).toBe(1);
    expect(ada!.errors).toBe(0);
  });

  it('counts an adapter error per source without aborting the scan', async () => {
    const { db, calls } = recordingDb([]);
    const boom: WarrantSourceAdapter = {
      meta: meta('ada-county-id'),
      mode: 'per-person',
      async fetchForPerson() {
        throw new Error('upstream 500');
      },
    };

    const summary = await runAllSourceScans(db, {
      skipUtah: true,
      adapters: [boom],
      persons: [person],
      delayMs: () => 0,
    });

    const entry = summary.scraped.find((s) => s.source_key === 'ada-county-id');
    expect(entry!.errors).toBe(1);
    expect(entry!.found).toBe(0);
    // The per-source sweep MUST be skipped when a fetch errored — otherwise an
    // endpoint outage would wipe the source's active warrants (officer-safety).
    expect(calls.some((c) => /UPDATE scraped_warrants SET status='cleared'/i.test(c.sql))).toBe(false);
    // nothing promoted (no hits)
    expect(calls.some((c) => /INSERT INTO warrants/i.test(c.sql))).toBe(false);
  });
});
