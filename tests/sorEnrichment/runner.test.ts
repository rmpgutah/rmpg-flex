// Node-suite unit test for the runner's per-row logic, using a fake D1
// (no Miniflare needed — this doesn't touch Hono routing) and a stubbed
// global fetch so no real network call happens.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeFakeDb } from '../helpers/fakeD1';
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
});
