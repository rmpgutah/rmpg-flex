import { describe, it, expect, vi } from 'vitest';
import { buildFleetioRequest, fleetioFetch, ping, listVehicles, createVehicle, configFromEnv, type FleetioConfig } from '../src/utils/fleetio/client';
import { FleetioConfigError } from '../src/utils/fleetio/errors';

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

describe('secret-hygiene invariants', () => {
  const cfg: FleetioConfig = {
    apiKey: 'tok_supersecret_1234567890',
    accountToken: 'acct_alsosecret_xyz',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  it('a 5xx body that echoes the API key does NOT leak it via error.message', async () => {
    // Worst case: Fleet.io's error body literally contains our key as a
    // substring (e.g. an "echo back of headers received" debugging response).
    const stub = vi.fn().mockResolvedValue(new Response(
      `{"error":"internal","echoed_auth":"Token tok_supersecret_1234567890"}`,
      { status: 503, headers: { 'content-type': 'application/json' } },
    ));
    try {
      await fleetioFetch({
        method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
        maxRetries: 0, backoffBaseMs: 0,
      });
      throw new Error('expected fleetioFetch to throw');
    } catch (err) {
      const e = err as { name: string; message: string; detail?: unknown };
      // The error MESSAGE must never contain the key. (We control the message
      // template — `Fleet.io ${status}`. This test pins that contract.)
      expect(e.message).not.toContain('tok_supersecret');
      expect(e.message).not.toContain('acct_alsosecret');
      // Detail MAY contain the key (it's the raw response body) — that's why
      // routes must NEVER return err.detail to the client. Tasks 9/10 only
      // surface err.message + err.name.
      expect(e.name).toBe('FleetioHttpError');
    }
  });

  it('FleetioConfigError message names the env var, not the value', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, apiKey: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ message: 'FLEETIO_API_KEY is unset' });
    // Message must NOT include the (empty) value or expose the accountToken.
    expect(stub).not.toHaveBeenCalled();
  });

  it('FleetioRateLimitError message contains the retry-after seconds, NOT the key', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('429', {
      status: 429, headers: { 'retry-after': '12' },
    }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0,
    })).rejects.toMatchObject({
      name: 'FleetioRateLimitError',
      retryAfterSeconds: 12,
    });
    // Defensive: the constructed message must not embed the API key.
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0,
    })).rejects.toMatchObject({ message: expect.not.stringContaining('tok_supersecret') });
  });
});

describe('typed resource methods', () => {
  const cfg: FleetioConfig = { apiKey: 'k', accountToken: 'a', apiBase: 'https://secure.fleetio.com/api/v1' };

  function jsonRespTm(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }

  it('ping — GET /accounts; returns { ok:true, account_id } on 200', async () => {
    const stub = vi.fn().mockResolvedValue(jsonRespTm({ id: 42, name: 'RMPG' }));
    const r = await ping({ config: cfg, fetchImpl: stub });
    expect(r).toEqual({ ok: true, account_id: 42, account_name: 'RMPG' });
    const [url, init] = stub.mock.calls[0];
    expect(String(url)).toBe('https://secure.fleetio.com/api/v1/accounts');
    expect(init.method).toBe('GET');
  });

  it('ping — 401 maps to { ok:false, error }', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const r = await ping({ config: cfg, fetchImpl: stub });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('listVehicles — passes page/per_page; returns parsed records', async () => {
    const stub = vi.fn().mockResolvedValue(jsonRespTm({
      records: [{ id: 1, name: 'Unit 1' }],
      pagination: { current_page: 1, total_pages: 1, total_entries: 1, per_page: 50 },
    }));
    const r = await listVehicles({ config: cfg, page: 2, perPage: 25, fetchImpl: stub });
    expect(r.records).toHaveLength(1);
    expect(stub.mock.calls[0][0]).toBe('https://secure.fleetio.com/api/v1/vehicles?page=2&per_page=25');
  });

  it('createVehicle — POSTs JSON body, returns the created record', async () => {
    const created = { id: 99, name: 'Unit 12', vin: 'ABC' };
    const stub = vi.fn().mockResolvedValue(jsonRespTm(created, { status: 201 }));
    const r = await createVehicle({
      config: cfg,
      payload: { name: 'Unit 12', vin: 'ABC' },
      fetchImpl: stub,
    });
    expect(r.id).toBe(99);
    expect(stub.mock.calls[0][1].method).toBe('POST');
    expect(stub.mock.calls[0][1].body).toBe('{"name":"Unit 12","vin":"ABC"}');
  });
});

describe('configFromEnv', () => {
  it('happy path — reads all three env values', () => {
    const c = configFromEnv({
      FLEETIO_API_KEY: 'tok_test_a',
      FLEETIO_ACCOUNT_TOKEN: 'acct_test_b',
      FLEETIO_API_BASE: 'https://example.test/api/v1',
    });
    expect(c).toEqual({
      apiKey: 'tok_test_a',
      accountToken: 'acct_test_b',
      apiBase: 'https://example.test/api/v1',
    });
  });

  it('defaults FLEETIO_API_BASE to the Fleet.io v1 endpoint when unset', () => {
    const c = configFromEnv({
      FLEETIO_API_KEY: 'tok_test_a',
      FLEETIO_ACCOUNT_TOKEN: 'acct_test_b',
    });
    expect(c.apiBase).toBe('https://secure.fleetio.com/api/v1');
  });

  it('throws FleetioConfigError when FLEETIO_API_KEY is missing', () => {
    expect(() => configFromEnv({
      FLEETIO_ACCOUNT_TOKEN: 'acct_test_b',
    })).toThrow(FleetioConfigError);
    expect(() => configFromEnv({
      FLEETIO_ACCOUNT_TOKEN: 'acct_test_b',
    })).toThrow('FLEETIO_API_KEY is unset');
  });

  it('throws FleetioConfigError when FLEETIO_ACCOUNT_TOKEN is missing', () => {
    expect(() => configFromEnv({
      FLEETIO_API_KEY: 'tok_test_a',
    })).toThrow(FleetioConfigError);
    expect(() => configFromEnv({
      FLEETIO_API_KEY: 'tok_test_a',
    })).toThrow('FLEETIO_ACCOUNT_TOKEN is unset');
  });
});
