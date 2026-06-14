import { describe, it, expect, vi, afterEach } from 'vitest';
import { getConfigAdapters } from '../src/utils/warrantSources/configRegistry';

afterEach(() => vi.unstubAllGlobals());

// Minimal fake D1 returning one source row for getConfigAdapters().
function dbWithSource(row: Record<string, unknown>) {
  const mk = () => ({ bind: () => mk(), all: async () => ({ results: [row] }), first: async () => null, run: async () => ({ meta: {} }) });
  return { prepare: () => mk() } as any;
}

const ARCGIS_ROW = {
  source_key: 'arcgis-arlington-tx', family: 'arcgis', display_name: 'Arlington', state: 'TX',
  jurisdiction: 'Arlington', base_url: 'https://h/svc/MapServer/9', resource_id: null,
  field_map: '{"first":"FirstName","last":"LastName","case_no":"CitationNumber"}',
  mode: 'full-list', format: 'arcgis', kind: 'criminal', enabled: 1, priority: 2,
};

function arcgisPage(oidStart: number, count: number, exceeded: boolean) {
  const features = Array.from({ length: count }, (_, i) => ({
    attributes: { OBJECTID: oidStart + i, FirstName: 'A', LastName: 'B', CitationNumber: `C${oidStart + i}` },
  }));
  return { ok: true, json: async () => ({ features, exceededTransferLimit: exceeded }) };
}

describe('arcgis fetchChunk', () => {
  it('keyset-loops up to the budget then returns done=false with the last OBJECTID', async () => {
    // 2000 + 2000 + 2000 = 6000 ≥ CHUNK_TARGET(5000); third page still full → not done.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(arcgisPage(1, 2000, true))
      .mockResolvedValueOnce(arcgisPage(2001, 2000, true))
      .mockResolvedValueOnce(arcgisPage(4001, 2000, true));
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!(null, { DB: dbWithSource(ARCGIS_ROW) });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.hits.length).toBe(6000);
    expect(res.done).toBe(false);
    expect(res.nextCursor).toBe('6000');          // last OBJECTID seen
    expect(fetchMock.mock.calls[0][0]).toContain('where=OBJECTID%3E0');
    expect(fetchMock.mock.calls[1][0]).toContain('where=OBJECTID%3E2000');
  });

  it('resumes from the cursor and reports done on a short final page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(arcgisPage(6001, 37, false));
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!('6000', { DB: dbWithSource(ARCGIS_ROW) });

    expect(fetchMock.mock.calls[0][0]).toContain('where=OBJECTID%3E6000');
    expect(res.hits.length).toBe(37);
    expect(res.done).toBe(true);
    expect(res.nextCursor).toBe('6037');
  });

  it('on a fetch error mid-loop keeps what it has and stays not-done with the cursor unmoved past failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(arcgisPage(1, 2000, true))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!(null, { DB: dbWithSource(ARCGIS_ROW) });

    expect(res.hits.length).toBe(2000);
    expect(res.done).toBe(false);
    expect(res.nextCursor).toBe('2000');          // resume after the rows we DID get
  });
});

describe('socrata fetchChunk', () => {
  const ROW = { ...ARCGIS_ROW, source_key: 'socrata-x', family: 'socrata', format: 'socrata',
    base_url: 'data.x.gov', resource_id: 'ab12-cd34',
    field_map: '{"first":"first","last":"last","case_no":"fileno"}' };

  it('fetches one offset page and advances the offset cursor', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ first: 'A', last: 'B', fileno: `F${i}` }));
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => rows });
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ROW));
    const res = await adapter.fetchChunk!('0', { DB: dbWithSource(ROW) });

    expect(fetchMock.mock.calls[0][0]).toBe('https://data.x.gov/resource/ab12-cd34.json?$limit=5000&$offset=0&$order=:id');
    expect(res.done).toBe(false);                 // full page → more remain
    expect(res.nextCursor).toBe('5000');
  });

  it('reports done on a short page', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ first: 'A', last: 'B', fileno: `F${i}` }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => rows }));
    const [adapter] = await getConfigAdapters(dbWithSource(ROW));
    const res = await adapter.fetchChunk!('5000', { DB: dbWithSource(ROW) });
    expect(res.done).toBe(true);
  });
});
