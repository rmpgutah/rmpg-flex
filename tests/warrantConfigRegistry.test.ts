import { describe, it, expect } from 'vitest';
import { getConfigAdapters } from '../src/utils/warrantSources/configRegistry';

/** Minimal fake D1 whose `SELECT * FROM national_warrant_sources` returns `rows`. */
function fakeDb(rows: Record<string, unknown>[]): any {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: rows }; },
        async first() { return rows[0] ?? null; },
      };
    },
  };
}

const baseRow = {
  display_name: 'X', state: 'TX', jurisdiction: 'Y', resource_id: null,
  field_map: null, mode: 'full-list', kind: 'criminal', enabled: 1, priority: 3,
};

describe('configRegistry — PDF families', () => {
  it('builds a full-list adapter for each PDF family', async () => {
    const rows = [
      { ...baseRow, source_key: 'pdf-zuercher-x', family: 'pdf-zuercher', format: 'pdf', base_url: 'https://example.test/z.pdf' },
      { ...baseRow, source_key: 'pdf-txmuni-x', family: 'pdf-txmuni', format: 'pdf', base_url: 'https://example.test/t.pdf' },
      { ...baseRow, source_key: 'pdf-newton-x', family: 'pdf-newton', format: 'pdf', base_url: 'https://example.test/n.pdf' },
    ];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(3);
    for (const a of adapters) {
      expect(a.mode).toBe('full-list');
      expect(typeof a.fetchAll).toBe('function');
      expect(a.meta.family).toMatch(/^pdf-/);
    }
  });

  it('skips unknown families (returns no adapter)', async () => {
    const rows = [{ ...baseRow, source_key: 'mystery', family: 'mystery-family', format: 'pdf', base_url: 'https://x.test/a.pdf' }];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(0);
  });

  it('still builds socrata + arcgis adapters', async () => {
    const rows = [
      { ...baseRow, source_key: 's', family: 'socrata', format: 'socrata', base_url: 'data.test', resource_id: 'abcd-1234', field_map: '{"name":"name"}' },
      { ...baseRow, source_key: 'a', family: 'arcgis', format: 'arcgis', base_url: 'https://gis.test/MapServer/0', field_map: '{"last":"L"}' },
    ];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(2);
  });
});
