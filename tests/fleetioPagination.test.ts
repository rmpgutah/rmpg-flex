// ============================================================
// Fleet.io pagination contract — regression suite
// ============================================================
// These pin the behaviour that was BROKEN before the 2026-07-26 hardening pass:
// the adapter declared a `{ records, pagination: { total_pages } }` body
// envelope that neither of Fleet.io's two real pagination contracts emits
// (grounded against developer.fleetio.com/docs/overview/pagination). The result
// was that every paginated walk stopped after one page — silently, with green
// tests, because the tests asserted the invented shape too.
//
// The point of each test here is that it FAILS against a single-page walk.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  parseListPage,
  iterateList,
  listAllVehicles,
  listAllFuelEntries,
  isRetryableMethod,
  FLEETIO_MAX_PAGES,
  type FleetioConfig,
} from '../src/utils/fleetio/client';

const cfg: FleetioConfig = {
  apiKey: 'tok_test',
  accountToken: 'acct_test',
  apiBase: 'https://secure.fleetio.com/api/v1',
};

function jsonResp(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('parseListPage — shape detection', () => {
  it('cursor era: { records, next_cursor } → records + cursor', () => {
    const page = parseListPage<{ id: number }>({
      records: [{ id: 1 }, { id: 2 }],
      next_cursor: 'CUR2',
      per_page: 100,
      estimated_remaining_count: 40,
    });
    expect(page.records).toHaveLength(2);
    expect(page.next_cursor).toBe('CUR2');
    expect(page.estimated_remaining_count).toBe(40);
  });

  it('cursor era: next_cursor null on the last page', () => {
    const page = parseListPage<{ id: number }>({ records: [{ id: 3 }], next_cursor: null });
    expect(page.next_cursor).toBeNull();
  });

  it('legacy: a BARE ARRAY body is records, not an empty result', () => {
    // The old code read `.records` off this and got undefined — then threw on
    // `for (const v of undefined)`, 502-ing the whole /pull.
    const page = parseListPage<{ id: number }>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(page.records).toHaveLength(3);
    expect(page.next_cursor).toBeNull();
  });

  it('legacy: total_pages comes from the X-Pagination-Total-Pages HEADER', () => {
    const headers = new Headers({ 'x-pagination-total-pages': '4' });
    const page = parseListPage<{ id: number }>([{ id: 1 }], headers);
    expect(page.total_pages).toBe(4);
  });

  it('an unexpected body degrades to an empty page rather than throwing', () => {
    expect(parseListPage<unknown>(null).records).toEqual([]);
    expect(parseListPage<unknown>('nope').records).toEqual([]);
  });
});

describe('iterateList — walks EVERY page', () => {
  it('follows next_cursor across pages until it is null', async () => {
    const stub = vi.fn()
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 1 }], next_cursor: 'C2' }))
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 2 }], next_cursor: 'C3' }))
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 3 }], next_cursor: null }));

    const r = await iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub });

    expect(r.records.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(r.pagesFetched).toBe(3);
    expect(r.truncated).toBe(false);
    // Page 1 carries no cursor; pages 2 and 3 carry the one they were handed.
    expect(String(stub.mock.calls[0][0])).not.toContain('start_cursor');
    expect(String(stub.mock.calls[1][0])).toContain('start_cursor=C2');
    expect(String(stub.mock.calls[2][0])).toContain('start_cursor=C3');
  });

  it('follows the legacy page walk using the header total_pages', async () => {
    const headers = { 'x-pagination-total-pages': '3' };
    const stub = vi.fn()
      .mockResolvedValueOnce(jsonResp([{ id: 1 }], headers))
      .mockResolvedValueOnce(jsonResp([{ id: 2 }], headers))
      .mockResolvedValueOnce(jsonResp([{ id: 3 }], headers));

    const r = await iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub });

    expect(r.records.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(r.pagesFetched).toBe(3);
    expect(String(stub.mock.calls[1][0])).toContain('page=2');
    expect(String(stub.mock.calls[2][0])).toContain('page=3');
  });

  it('single page → exactly one request (no speculative page 2)', async () => {
    const stub = vi.fn().mockResolvedValue(jsonResp({ records: [{ id: 1 }], next_cursor: null }));
    const r = await iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub });
    expect(r.pagesFetched).toBe(1);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('calls onPage BETWEEN requests so callers can pace against the rate limit', async () => {
    const stub = vi.fn()
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 1 }], next_cursor: 'C2' }))
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 2 }], next_cursor: null }));
    const onPage = vi.fn();

    await iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub, onPage });

    // Two requests, one gap between them — not called before the first.
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it('stops at FLEETIO_MAX_PAGES and REPORTS truncation instead of hiding it', async () => {
    // A server that always advertises another cursor must not spin forever.
    // mockImplementation, not mockResolvedValue: a Response body can only be
    // read once, so every call needs a freshly constructed one.
    const stub = vi.fn().mockImplementation(async () => jsonResp({ records: [{ id: 1 }], next_cursor: 'ALWAYS' }));
    const r = await iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub });
    expect(r.pagesFetched).toBe(FLEETIO_MAX_PAGES);
    expect(r.truncated).toBe(true);
  });

  it('propagates a mid-walk error rather than returning a short list', async () => {
    // A 429 on page 2 must not look like "the list ended at page 1" — that
    // would silently under-import and report success.
    const stub = vi.fn()
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 1 }], next_cursor: 'C2' }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }));

    await expect(
      iterateList<{ id: number }>('/vehicles', { config: cfg, fetchImpl: stub }),
    ).rejects.toMatchObject({ name: 'FleetioRateLimitError' });
  });
});

describe('listAllVehicles / listAllFuelEntries', () => {
  it('listAllVehicles returns records from every page', async () => {
    const stub = vi.fn()
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 1, name: 'A' }], next_cursor: 'C2' }))
      .mockResolvedValueOnce(jsonResp({ records: [{ id: 2, name: 'B' }], next_cursor: null }));
    const r = await listAllVehicles({ config: cfg, fetchImpl: stub });
    expect(r.records).toHaveLength(2);
  });

  it('listAllFuelEntries drops entries belonging to another vehicle', async () => {
    // Guards against an ignored server-side ?vehicle_id= filter attributing the
    // whole account's fuel history to one unit.
    const stub = vi.fn().mockResolvedValue(jsonResp({
      records: [
        { id: 900, vehicle_id: 501, date: '2026-07-01', us_gallons: 12, cost: 40, liters: null },
        { id: 901, vehicle_id: 999, date: '2026-07-02', us_gallons: 9, cost: 30, liters: null },
      ],
      next_cursor: null,
    }));

    const r = await listAllFuelEntries({ config: cfg, vehicleId: 501, fetchImpl: stub });

    expect(r.records.map((x) => x.id)).toEqual([900]);
    expect(r.filteredOut).toBe(1);
  });
});

describe('retry safety by HTTP method', () => {
  it('classifies only idempotent verbs as replayable', () => {
    expect(isRetryableMethod('GET')).toBe(true);
    expect(isRetryableMethod('PATCH')).toBe(true);
    expect(isRetryableMethod('PUT')).toBe(true);
    expect(isRetryableMethod('POST')).toBe(false);
    expect(isRetryableMethod('DELETE')).toBe(false);
  });

  it('a POST that times out is NOT replayed (would double-create remotely)', async () => {
    const { createVehicle } = await import('../src/utils/fleetio/client');
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const stub = vi.fn().mockRejectedValue(abort);

    await expect(
      createVehicle({ config: cfg, payload: { name: 'Unit 9' }, fetchImpl: stub }),
    ).rejects.toMatchObject({ name: 'FleetioTimeoutError' });

    // Exactly one attempt. A replay of a POST that may already have committed
    // creates a second remote vehicle we can never see or reconcile.
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('a POST that 500s is NOT replayed either', async () => {
    const { createVehicle } = await import('../src/utils/fleetio/client');
    const stub = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      createVehicle({ config: cfg, payload: { name: 'Unit 9' }, fetchImpl: stub }),
    ).rejects.toMatchObject({ name: 'FleetioHttpError', status: 500 });
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('a GET that 500s IS retried', async () => {
    const stub = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(jsonResp({ records: [], next_cursor: null }));
    const r = await listAllVehicles({ config: cfg, fetchImpl: stub });
    expect(r.records).toEqual([]);
    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe('verb correctness for archive vs destroy', () => {
  it('archiveVendor archives (PATCH /vendors/:id/archive) — never DELETEs', async () => {
    const { archiveVendor } = await import('../src/utils/fleetio/client');
    const stub = vi.fn().mockResolvedValue(jsonResp({ id: 7, name: 'Acme', archived_at: '2026-07-26T00:00:00Z' }));

    await archiveVendor({ config: cfg, fleetioId: 7, fetchImpl: stub });

    const [url, init] = stub.mock.calls[0];
    // RMPG's own vendor delete is a soft delete (active = 0) because historical
    // work orders reference vendor_id — a hard remote DELETE would destroy the
    // matching Fleet.io history. PATCH (not POST) confirmed live 2026-07-29
    // against developer.fleetio.com/reference/archive-vendor.
    expect(String(url)).toBe('https://secure.fleetio.com/api/v1/vendors/7/archive');
    expect(init.method).toBe('PATCH');
  });

  it('deleteFuelEntry hard-deletes, matching RMPG\'s own hard delete', async () => {
    const { deleteFuelEntry } = await import('../src/utils/fleetio/client');
    const stub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await deleteFuelEntry({ config: cfg, fleetioId: 900, fetchImpl: stub });

    const [url, init] = stub.mock.calls[0];
    expect(String(url)).toBe('https://secure.fleetio.com/api/v1/fuel_entries/900');
    expect(init.method).toBe('DELETE');
  });
});
