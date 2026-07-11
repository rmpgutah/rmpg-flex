import { describe, it, expect, vi } from 'vitest';
import { insertScraperRunRow, logScanResult } from '../src/utils/warrantSources/logScanResult';
import type { AllSourceScanResult } from '../src/utils/warrantSources/runScan';

/** Fake D1 that records every bound INSERT so we can assert on the `success`/`degraded` values written. */
function fakeDb() {
  const inserts: unknown[][] = [];
  const db: any = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          inserts.push(args);
          return this;
        },
        async run() { return {}; },
      };
    },
  };
  return { db, inserts };
}

describe('insertScraperRunRow', () => {
  it('writes success=1 when errors=0 and not degraded', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 2, cleared: 0, errors: 0 }, 'cron', false);
    // Column order: source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger, degraded
    expect(inserts[0][3]).toBe(1);
    expect(inserts[0][9]).toBe(0);
  });

  it('writes success=0 when degraded=true even with errors=0', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 0, cleared: 0, errors: 0 }, 'cron', true);
    expect(inserts[0][3]).toBe(0);
    expect(inserts[0][9]).toBe(1);
  });

  it('writes success=0 when errors>0', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 0, cleared: 0, errors: 2 }, 'cron', false);
    expect(inserts[0][3]).toBe(0);
  });

  it('defaults degraded to false when omitted (manual-trigger call sites)', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 1, cleared: 0, errors: 0 }, 'manual');
    expect(inserts[0][3]).toBe(1);
    expect(inserts[0][9]).toBe(0);
  });
});

describe('logScanResult', () => {
  it('passes each scraped source summary\'s degraded flag through to its row', async () => {
    const { db, inserts } = fakeDb();
    const result: AllSourceScanResult = {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 1, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'src-a', checked: 0, found: 0, cleared: 0, errors: 0, degraded: true },
        { source_key: 'src-b', checked: 0, found: 3, cleared: 0, errors: 0, degraded: false },
      ],
    } as AllSourceScanResult;
    await logScanResult(db, result, 'cron');
    const bySourceKey = Object.fromEntries(inserts.map((args) => [args[0], args]));
    expect(bySourceKey['src-a'][3]).toBe(0);  // degraded → success=0
    expect(bySourceKey['src-b'][3]).toBe(1);  // clean → success=1
  });
});
