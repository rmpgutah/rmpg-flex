// tests/sl-assessor.lookup.test.ts
// Orchestrator tests for lookupParcelsWithFallback — the fallback chain that
// the route uses to keep the SLCo Assessor panel useful when one source fails.
// Chain order under test: Firecrawl → direct fetch → AI extract → stale cache.
// Each layer is mocked so the test is hermetic.

import { describe, expect, test, vi, beforeEach } from 'vitest';

// First test cold-loads callAi → anthropic → openai modules, which can take
// >5s under transform pressure when this file runs in a bundled suite.
// 15s is generous and only affects the first slow test.
const TEST_TIMEOUT = 15_000;
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// We import lazily inside tests so module-level fetch spies are picked up.
const fixture = (n: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', n), 'utf8');

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string, _t?: string) => {
      const v = store.get(k);
      if (!v) return null;
      try { return JSON.parse(v); } catch { return v; }
    }),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _store: store,
  };
}

describe('lookupParcelsWithFallback', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('returns Firecrawl parcels when scrape + parse succeed', { timeout: TEST_TIMEOUT }, async () => {
    const html = fixture('multi.html');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html } }), { status: 200 }),
    );
    const kv = makeKv();
    const { lookupParcelsWithFallback } = await import('../src/utils/sl-assessor/lookup');
    const out = await lookupParcelsWithFallback(
      { FIRECRAWL_API_KEY: 'sk_test', KV: kv as unknown as KVNamespace },
      '2200 S 500 E',
    );
    expect(out.source).toBe('firecrawl');
    expect(out.parcels.length).toBeGreaterThanOrEqual(1);
    expect(out.degraded).toBe(false);
  });

  test('falls back to stale cache when Firecrawl errors and no AI key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('upstream boom', { status: 502 }),
    );
    const kv = makeKv();
    // Seed the durable / stale entry with two parcels from a prior run.
    const stale = [
      { parcel_number: '16-04-301-005', owner_of_record: 'SMITH JOHN', situs_address: '2200 S 500 E', land_sqft: 8000, total_market_value: 450000, detail_url: '?parcel=16-04-301-005' },
    ];
    kv._store.set('assessor:parcels:durable:2200 s 500 e', JSON.stringify(stale));
    const { lookupParcelsWithFallback } = await import('../src/utils/sl-assessor/lookup');
    const out = await lookupParcelsWithFallback(
      { FIRECRAWL_API_KEY: 'sk_test', KV: kv as unknown as KVNamespace },
      '2200 S 500 E',
    );
    expect(out.source).toBe('stale_cache');
    expect(out.degraded).toBe(true);
    expect(out.parcels).toEqual(stale);
  });

  test('returns empty + no_match code when every layer yields nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html: '<html><body>nothing here</body></html>' } }), { status: 200 }),
    );
    const kv = makeKv();
    const { lookupParcelsWithFallback } = await import('../src/utils/sl-assessor/lookup');
    const out = await lookupParcelsWithFallback(
      { FIRECRAWL_API_KEY: 'sk_test', KV: kv as unknown as KVNamespace },
      '9999 Nowhere Ln',
    );
    expect(out.parcels).toEqual([]);
    expect(out.source).toBe('none');
    // not_configured implies the chain never ran — here Firecrawl ran but
    // returned non-parsable HTML, so the code should reflect that, not config.
    expect(out.code).not.toBe('not_configured');
  });

  test('returns not_configured (no throw) when neither Firecrawl nor AI key is set', async () => {
    const kv = makeKv();
    const { lookupParcelsWithFallback } = await import('../src/utils/sl-assessor/lookup');
    const out = await lookupParcelsWithFallback(
      { KV: kv as unknown as KVNamespace } as any,
      '2200 S 500 E',
    );
    expect(out.parcels).toEqual([]);
    expect(out.code).toBe('not_configured');
    expect(out.source).toBe('none');
  });

  test('writes a durable (no-TTL) cache entry on a successful fetch', async () => {
    const html = fixture('multi.html');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html } }), { status: 200 }),
    );
    const kv = makeKv();
    const { lookupParcelsWithFallback } = await import('../src/utils/sl-assessor/lookup');
    await lookupParcelsWithFallback(
      { FIRECRAWL_API_KEY: 'sk_test', KV: kv as unknown as KVNamespace },
      '2200 S 500 E',
    );
    // The 30d-TTL key AND the durable key should both have been written.
    expect(kv.put).toHaveBeenCalled();
    const keysWritten = kv.put.mock.calls.map((c) => c[0]);
    expect(keysWritten).toEqual(expect.arrayContaining([
      expect.stringMatching(/^assessor:parcels:[^:]+$/),
      expect.stringMatching(/^assessor:parcels:durable:/),
    ]));
  });
});
