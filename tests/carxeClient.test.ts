import { describe, it, expect, vi } from 'vitest';
import {
  CARXE_API_BASE_DEFAULT,
  configFromEnv,
  decodePlate,
  getSpecifications,
  getLienTheft,
  getHistory,
} from '../src/utils/carxe/client';
import { CarxeConfigError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from '../src/utils/carxe/errors';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('carxe/client — configFromEnv', () => {
  it('throws CarxeConfigError when CARXE_API_KEY is unset', () => {
    expect(() => configFromEnv({})).toThrow(CarxeConfigError);
  });

  it('builds config with default base when CARXE_API_BASE is unset', () => {
    const config = configFromEnv({ CARXE_API_KEY: 'test-key' });
    expect(config.apiKey).toBe('test-key');
    expect(config.apiBase).toBe(CARXE_API_BASE_DEFAULT);
  });

  it('uses CARXE_API_BASE override when set', () => {
    const config = configFromEnv({ CARXE_API_KEY: 'test-key', CARXE_API_BASE: 'https://sandbox.example.com' });
    expect(config.apiBase).toBe('https://sandbox.example.com');
  });
});

describe('carxe/client — decodePlate', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('sends key/plate/state as query params on a GET request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { plate: '7XER187' }, make: 'Kia' }));
    await decodePlate(config, { plate: '7XER187', state: 'CA' }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toContain('/v2/platedecoder');
    expect(url).toContain('key=test-key');
    expect(url).toContain('plate=7XER187');
    expect(url).toContain('state=CA');
  });

  it('parses a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { plate: '7XER187' }, make: 'Kia', model: 'Forte' }));
    const result = await decodePlate(config, { plate: '7XER187', state: 'CA' }, { fetchImpl });
    expect(result.make).toBe('Kia');
    expect(result.model).toBe('Forte');
  });

  it('throws CarxeHttpError on a 4xx response and does not retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'bad request' }, 400));
    await expect(decodePlate(config, { plate: 'BAD' }, { fetchImpl })).rejects.toBeInstanceOf(CarxeHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to maxRetries then throws CarxeHttpError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'upstream down' }, 502));
    await expect(
      decodePlate(config, { plate: '7XER187' }, { fetchImpl, maxRetries: 2, backoffBaseMs: 1 }),
    ).rejects.toBeInstanceOf(CarxeHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('throws CarxeRateLimitError on 429 without retrying in-band', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '5' }));
    await expect(decodePlate(config, { plate: '7XER187' }, { fetchImpl })).rejects.toBeInstanceOf(CarxeRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws CarxeTimeoutError when the request aborts', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    await expect(
      decodePlate(config, { plate: '7XER187' }, { fetchImpl, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(CarxeTimeoutError);
  });

  it('never includes the api key in a thrown error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    try {
      await decodePlate(config, { plate: '7XER187' }, { fetchImpl });
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(String(err.message)).not.toContain('test-key');
    }
  });
});

describe('carxe/client — getSpecifications', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /specs with key/vin params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { vin: 'WBAFR7C57CC811956' }, attributes: { make: 'BMW' } }));
    const result = await getSpecifications(config, { vin: 'WBAFR7C57CC811956' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/specs');
    expect(url).toContain('vin=WBAFR7C57CC811956');
    expect(result.attributes?.make).toBe('BMW');
  });
});

describe('carxe/client — getLienTheft', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /v1/lien-theft and returns events', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        input: { vin: '2C3CDXFG1FH762860' },
        events: [{ event: 'Active Theft', location: 'OH', details_list: ['stolen'] }],
      }),
    );
    const result = await getLienTheft(config, { vin: '2C3CDXFG1FH762860' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/v1/lien-theft');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe('Active Theft');
  });
});

describe('carxe/client — getHistory', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /history and returns the report shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ vin: 'WBAFR7C57CC811956', success: true, status: 'ok' }));
    const result = await getHistory(config, { vin: 'WBAFR7C57CC811956' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/history');
    expect(result.status).toBe('ok');
  });
});
