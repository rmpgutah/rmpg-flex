import { describe, it, expect, vi } from 'vitest';
import { buildFleetioRequest, fleetioFetch, type FleetioConfig } from '../src/utils/fleetio/client';

describe('buildFleetioRequest', () => {
  const cfg = {
    apiKey: 'tok_test_abc',
    accountToken: 'acct_xyz',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  it('GET — joins path, adds dual auth + accept headers, no body', () => {
    const req = buildFleetioRequest({ method: 'GET', path: '/vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['authorization']).toBe('Token tok_test_abc');
    expect(h['account-token']).toBe('acct_xyz');
    expect(h['accept']).toBe('application/json');
    expect(req.body).toBeUndefined();
  });

  it('POST — adds content-type, serializes body to JSON', () => {
    const req = buildFleetioRequest({
      method: 'POST',
      path: '/vehicles',
      config: cfg,
      body: { name: 'Unit 12', vin: 'ABC' },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['content-type']).toBe('application/json');
    expect(req.body).toBe('{"name":"Unit 12","vin":"ABC"}');
  });

  it('GET with query — encodes params, supports arrays and numbers', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 2, per_page: 50, 'q[vin_eq]': '1HGBH41JXMN109186' },
    });
    expect(req.url).toBe(
      'https://secure.fleetio.com/api/v1/vehicles?page=2&per_page=50&q%5Bvin_eq%5D=1HGBH41JXMN109186'
    );
  });

  it('normalizes a path with no leading slash (adds one)', () => {
    const req = buildFleetioRequest({ method: 'GET', path: 'vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
  });

  it('drops undefined/null query values (does not serialize them)', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 1, archived: undefined, foo: null as unknown as undefined },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles?page=1');
  });
});

describe('fleetioFetch', () => {
  const cfg: FleetioConfig = {
    apiKey: 'k',
    accountToken: 'a',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  function jsonResp(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }
  it('200 — returns parsed JSON', async () => {
    const stub = vi.fn().mockResolvedValue(jsonResp({ records: [], pagination: { current_page: 1, total_pages: 1, total_entries: 0, per_page: 50 } }));
    const r = await fleetioFetch<{ records: unknown[] }>({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
    });
    expect(r.records).toEqual([]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('429 with Retry-After — throws FleetioRateLimitError carrying the header value', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('rate limited', {
      status: 429, headers: { 'retry-after': '7' },
    }));
    await expect(fleetioFetch({ method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0 }))
      .rejects.toMatchObject({ name: 'FleetioRateLimitError', retryAfterSeconds: 7 });
  });

  it('5xx — retries up to maxRetries then throws FleetioHttpError', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
      maxRetries: 2, backoffBaseMs: 0,
    })).rejects.toMatchObject({ name: 'FleetioHttpError', status: 503 });
    // 1 initial + 2 retries = 3 calls
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('4xx (non-429) — throws immediately, no retry', async () => {
    const stub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad vin' }), {
      status: 422, headers: { 'content-type': 'application/json' },
    }));
    await expect(fleetioFetch({ method: 'POST', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 5, backoffBaseMs: 0 }))
      .rejects.toMatchObject({ name: 'FleetioHttpError', status: 422 });
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('timeout — aborts and throws FleetioTimeoutError', async () => {
    // stub fetch that never resolves; rely on AbortSignal to cancel it
    const stub = vi.fn().mockImplementation((_url, init) => new Promise((_, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
      timeoutMs: 10, maxRetries: 0,
    })).rejects.toMatchObject({ name: 'FleetioTimeoutError' });
  });

  it('missing apiKey — FleetioConfigError, never fetches', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, apiKey: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ name: 'FleetioConfigError' });
    expect(stub).not.toHaveBeenCalled();
  });

  it('missing accountToken — FleetioConfigError', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, accountToken: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ name: 'FleetioConfigError' });
  });
});
