import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { logScanResult } from '../../src/utils/warrantSources/logScanResult';

describe('logScanResult', () => {
  it('inserts one scraper_runs row for the Utah leg and one per scraped source', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 5, new_warrants_found: 1, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'ada-county-id', checked: 10, found: 2, cleared: 1, errors: 0 },
        { source_key: 'natrona-county-wy', checked: 3, found: 0, cleared: 0, errors: 1 },
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
});
