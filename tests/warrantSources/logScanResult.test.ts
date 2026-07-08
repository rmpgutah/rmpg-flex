import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { logScanResult } from '../../src/utils/warrantSources/logScanResult';

describe('logScanResult', () => {
  it('inserts one scraper_runs row for the Utah leg and one per scraped source', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 5, new_warrants_found: 1, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'ada-county-id', checked: 10, found: 2, cleared: 1, errors: 0, degraded: false },
        { source_key: 'natrona-county-wy', checked: 3, found: 0, cleared: 0, errors: 1, degraded: false },
      ],
    }, 'cron');

    expect(calls).toHaveLength(3);
    // Utah row: success = errors===0 -> true (1)
    expect(calls[0].args).toContain('utah-warrant-watch');
    expect(calls[0].args).toContain(1); // success
    // ada-county-id: errors=0 -> success
    expect(calls[1].args).toContain('ada-county-id');
    expect(calls[1].args).toContain(1);
    // natrona-county-wy: errors=1 -> failure
    expect(calls[2].args).toContain('natrona-county-wy');
    expect(calls[2].args).toContain(0);
  });

  it('tags every row with the given trigger value', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [],
    }, 'manual');

    expect(calls[0].args).toContain('manual');
  });

  it('inserts only the Utah row when there are no scraped sources', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 1, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [],
    }, 'cron');

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('utah-warrant-watch');
  });

  it('still records the remaining sources when one insert rejects', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    let call = 0;
    const db = {
      prepare: (sql: string) => {
        call += 1;
        const shouldFail = call === 2;
        let args: unknown[] = [];
        const stmt: any = {
          bind: (...a: unknown[]) => { args = a; return stmt; },
          run: async () => {
            if (shouldFail) throw new Error('transient D1 error');
            calls.push({ sql, args });
            return { meta: { changes: 1, last_row_id: calls.length } };
          },
        };
        return stmt;
      },
    } as unknown as import('@cloudflare/workers-types').D1Database;

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'ada-county-id', checked: 1, found: 0, cleared: 0, errors: 0, degraded: false },
        { source_key: 'natrona-county-wy', checked: 1, found: 0, cleared: 0, errors: 0, degraded: false },
      ],
    }, 'cron');

    // Row 2 (ada-county-id) rejects, but row 1 (utah) and row 3
    // (natrona-county-wy) must still be recorded — one bad row can't be
    // allowed to silently drop the rest of the audit trail.
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.args[0])).toEqual(['utah-warrant-watch', 'natrona-county-wy']);
  });
});
