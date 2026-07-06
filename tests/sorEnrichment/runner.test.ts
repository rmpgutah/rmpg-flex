// Node-suite unit test for the runner's per-row logic, using a fake D1
// (no Miniflare needed — this doesn't touch Hono routing) and a stubbed
// global fetch so no real network call happens.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeFakeDb, recordingDb } from '../helpers/fakeD1';
import { enrichPendingOffenders } from '../../src/utils/sorEnrichment/runner';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enrichPendingOffenders', () => {
  it('fetches each pending row\'s detail_url, parses it, and updates the row', async () => {
    const rows = [
      { id: 1, jurisdiction: 'UT', detail_url: 'https://example.com/ut/1' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
      { match: /UPDATE national_sex_offenders/i, rows: [] },
      { match: /INSERT INTO sor_enrichment_runs/i, rows: [] },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<p>Offense: Test Offense</p><p>Risk Level: Low</p>',
    } as Response);

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips a row whose jurisdiction has no matching adapter', async () => {
    const rows = [
      { id: 2, jurisdiction: 'ZZ', detail_url: 'https://example.com/zz/2' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
    ]);
    global.fetch = vi.fn();

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('logs a failure and continues when fetch throws, without aborting the batch', async () => {
    const rows = [
      { id: 3, jurisdiction: 'UT', detail_url: 'https://example.com/ut/3' },
      { id: 4, jurisdiction: 'ID', detail_url: 'https://example.com/id/4' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
      { match: /UPDATE national_sex_offenders/i, rows: [] },
      { match: /INSERT INTO sor_enrichment_runs/i, rows: [] },
    ]);

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '<p>Charge: Test Charge</p>',
      } as Response);

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('treats a non-2xx detail-page response as a failure, without parsing or updating the row', async () => {
    const rows = [
      { id: 5, jurisdiction: 'UT', detail_url: 'https://example.com/ut/5' },
    ];
    const { db, calls } = recordingDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '<html>Not Found</html>',
    } as Response);

    const result = await enrichPendingOffenders(db);

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    // Only the failure-path INSERT into sor_enrichment_runs should have run —
    // the UPDATE to national_sex_offenders must never fire for a non-ok response.
    expect(calls.some((c) => /UPDATE national_sex_offenders/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => /INSERT INTO sor_enrichment_runs/i.test(c.sql))).toBe(true);
    const insertCall = calls.find((c) => /INSERT INTO sor_enrichment_runs/i.test(c.sql));
    expect(insertCall?.args).toContain('HTTP 404');
  });

  it('logs a failure and continues when a DB write (execute) throws', async () => {
    const rows = [
      { id: 6, jurisdiction: 'UT', detail_url: 'https://example.com/ut/6' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
    ]);
    // Override .run() on the UPDATE statement to throw, simulating a D1 write failure.
    const originalPrepare = (db as any).prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (/UPDATE national_sex_offenders/i.test(sql)) {
        return {
          ...stmt,
          bind: (...args: unknown[]) => ({
            ...stmt.bind(...args),
            run: async () => {
              throw new Error('D1_ERROR: no such column: offense');
            },
          }),
        };
      }
      return stmt;
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<p>Offense: Test Offense</p><p>Risk Level: Low</p>',
    } as Response);

    const result = await enrichPendingOffenders(db as never);

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });
});
