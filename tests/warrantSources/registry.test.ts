import { describe, it, expect } from 'vitest';
import { makeFakeDb } from '../helpers/fakeD1';
import { ADAPTERS, getEnabledAdapters } from '../../src/utils/warrantSources/registry';

describe('registry', () => {
  it('ADAPTERS includes utah + ada + natrona', () => {
    const keys = ADAPTERS.map((a) => a.meta.key).sort();
    expect(keys).toContain('utah-warrant-watch');
    expect(keys).toContain('ada-county-id');
    expect(keys).toContain('natrona-county-wy');
  });

  it('returns only adapters with a config row', async () => {
    const db = makeFakeDb([
      {
        match: /FROM warrant_scraper_config/i,
        rows: [{ source_name: 'ada-county-id' }, { source_name: 'utah-warrant-watch' }],
      },
    ]);
    const enabled = await getEnabledAdapters(db);
    expect(enabled.map((a) => a.meta.key).sort()).toEqual(['ada-county-id', 'utah-warrant-watch']);
  });

  it('returns [] when config has zero rows', async () => {
    const db = makeFakeDb([{ match: /FROM warrant_scraper_config/i, rows: [] }]);
    expect(await getEnabledAdapters(db)).toEqual([]);
  });

  it('fails open to ALL adapters when the query throws', async () => {
    const db = {
      prepare() {
        throw new Error('no such table');
      },
    } as any;
    const enabled = await getEnabledAdapters(db);
    expect(enabled.length).toBe(ADAPTERS.length);
  });
});
