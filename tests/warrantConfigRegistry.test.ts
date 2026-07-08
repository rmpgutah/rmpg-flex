import { describe, it, expect, afterEach, vi } from 'vitest';
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
      { ...baseRow, source_key: 'pdf-incode-x', family: 'pdf-incode', format: 'pdf', base_url: 'https://example.test/i.pdf' },
    ];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(4);
    for (const a of adapters) {
      expect(a.mode).toBe('full-list');
      expect(typeof a.fetchAll).toBe('function');
      expect(a.meta.family).toMatch(/^pdf-/);
    }
  });

  it('builds full-list adapters for the text (XML/CSV) families', async () => {
    const rows = [
      { ...baseRow, source_key: 'xml-bonner-felony-id', family: 'xml-bonner', format: 'xml', base_url: 'https://example.test/w.xml' },
      { ...baseRow, source_key: 'csv-zuercher-teton-wy', family: 'csv-zuercher', format: 'csv', base_url: 'https://example.test/w.csv' },
    ];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(2);
    for (const a of adapters) {
      expect(a.mode).toBe('full-list');
      expect(typeof a.fetchAll).toBe('function');
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

describe('configRegistry — degraded signal', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  it('marks socrata degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 500 })) as any;
    const rows = [{ ...baseRow, source_key: 's', family: 'socrata', format: 'socrata', base_url: 'data.test', resource_id: 'r' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_500');
  });

  it('marks socrata degraded when fetch throws', async () => {
    global.fetch = (async () => { throw new Error('network down'); }) as any;
    const rows = [{ ...baseRow, source_key: 's', family: 'socrata', format: 'socrata', base_url: 'data.test', resource_id: 'r' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('fetch_threw');
  });

  it('marks arcgis degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 503 })) as any;
    const rows = [{ ...baseRow, source_key: 'a', family: 'arcgis', format: 'arcgis', base_url: 'https://gis.test/MapServer/0' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_503');
  });

  it('marks pdf family degraded when there is no text layer', async () => {
    global.fetch = (async () => ({ ok: false, status: 404 })) as any;
    const rows = [{ ...baseRow, source_key: 'p', family: 'pdf-zuercher', format: 'pdf', base_url: 'https://example.test/z.pdf' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchAll!({ DB: fakeDb(rows) } as any);
    expect(result.hits).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('no_text_layer');
  });

  it('marks text family (xml/csv) degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 403 })) as any;
    const rows = [{ ...baseRow, source_key: 'x', family: 'xml-bonner', format: 'xml', base_url: 'https://example.test/w.xml' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchAll!({ DB: fakeDb(rows) } as any);
    expect(result.hits).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_403');
  });

  it('logs a warning and returns null for an unmatched family', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = [{ ...baseRow, source_key: 'mystery', family: 'mystery-family', format: 'pdf', base_url: 'https://x.test/a.pdf' }];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/mystery.*mystery-family/));
    warnSpy.mockRestore();
  });

  it('logs a warning when the national_warrant_sources query throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingDb: any = { prepare() { return { bind() { return this; }, async all() { throw new Error('table missing'); } }; } };
    const adapters = await getConfigAdapters(throwingDb);
    expect(adapters).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
