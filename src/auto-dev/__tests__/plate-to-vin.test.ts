import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlateToVinClient } from '../plate-to-vin.js';
import {
  PlateValidationError,
  AutoDevApiError,
  RateLimitExceededError,
} from '../plate-to-vin.js';
import type { PlateToVinResponse, PlateToVinClientConfig } from '../types.js';

const MOCK_RESPONSE: PlateToVinResponse = {
  vin: '1N4BL4BV3LC205823',
  year: 2020,
  make: 'Nissan',
  model: 'Altima',
  trim: '2.5 S Sedan 4D',
  drivetrain: 'FWD',
  engine: '4-Cyl, 2.5 Liter',
  transmission: 'Automatic, Xtronic CVT',
  isDefault: true,
};

const MOCK_ERROR_BODY = {
  status: 404,
  error: 'Plate not found',
  code: 'PLATE_NOT_FOUND',
  path: '/plate/CA/ABC123',
  requestId: 'a1b2c3d4',
};

function makeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function makeClient(overrides?: Partial<PlateToVinClientConfig>) {
  return new PlateToVinClient({
    apiKey: 'test-key',
    cacheTtlMs: 0,
    maxRetries: 2,
    initialBackoffMs: 0,
    maxRequestsPerSecond: 100,
    ...overrides,
  });
}

// ─── Input Validation ────────────────────────────────────────────────────────

describe('Input Validation', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects empty plate', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: '' })).rejects.toThrow(PlateValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects plate shorter than 2 chars', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: 'A' })).rejects.toThrow(PlateValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects plate longer than 8 chars after stripping hyphens', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: 'ABCDEFGHI' })).rejects.toThrow(
      PlateValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects non-alphanumeric characters (excluding hyphens)', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: 'ABC 12!' })).rejects.toThrow(
      PlateValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects invalid state code', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'XX', plate: 'ABC123' })).rejects.toThrow(
      PlateValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('strips hyphens before length check — AB-1234 is a valid 6-char plate', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: 'AB-1234' })).resolves.toBeDefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('never calls fetch when validation fails', async () => {
    const client = makeClient();
    await expect(client.lookup({ state: 'ZZ', plate: '!!!' })).rejects.toThrow(
      PlateValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Success Path ─────────────────────────────────────────────────────────────

describe('Success Path', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed PlateToVinResponse object', async () => {
    const client = makeClient();
    const result = await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(result).toEqual(MOCK_RESPONSE);
  });

  it('sends correct URL with path segments /{state}/{plate}', async () => {
    const client = makeClient();
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.auto.dev/plate/CA/ABC123');
  });

  it('sends Authorization: Bearer header', async () => {
    const client = makeClient();
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
  });

  it('upper-cases plate and state in the URL', async () => {
    const client = makeClient();
    await client.lookup({ state: 'ca', plate: 'abc123' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.auto.dev/plate/CA/ABC123');
  });
});

// ─── API Error Handling ───────────────────────────────────────────────────────

describe('API Error Handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws AutoDevApiError with .code, .requestId, .statusCode on 404', async () => {
    vi.stubGlobal('fetch', makeFetch(404, MOCK_ERROR_BODY));
    const client = makeClient();
    const err = await client.lookup({ state: 'CA', plate: 'ABC123' }).catch((e) => e);
    expect(err).toBeInstanceOf(AutoDevApiError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('PLATE_NOT_FOUND');
    expect(err.requestId).toBe('a1b2c3d4');
  });

  it('throws a generic Error on non-JSON error body (raw 500)', async () => {
    const badFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', badFetch);
    const client = makeClient({ maxRetries: 0 });
    await expect(client.lookup({ state: 'CA', plate: 'ABC123' })).rejects.toThrow(Error);
  });
});

// ─── Retry Logic ─────────────────────────────────────────────────────────────

describe('Retry Logic', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries on 503, then succeeds on second attempt', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: 'Service Unavailable' }),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(MOCK_RESPONSE),
        text: () => Promise.resolve(''),
      });
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient();
    const result = await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(result).toEqual(MOCK_RESPONSE);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and respects Retry-After header', async () => {
    vi.useFakeTimers();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '1' : null) },
        json: () => Promise.resolve({ error: 'Too Many Requests' }),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(MOCK_RESPONSE),
        text: () => Promise.resolve(''),
      });
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient();
    const lookupPromise = client.lookup({ state: 'CA', plate: 'ABC123' });
    await vi.runAllTimersAsync();
    const result = await lookupPromise;
    expect(result).toEqual(MOCK_RESPONSE);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws after exhausting all retry attempts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      json: () => Promise.resolve({ error: 'Service Unavailable' }),
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient({ maxRetries: 2 });
    await expect(client.lookup({ state: 'CA', plate: 'ABC123' })).rejects.toThrow();
    // 1 initial + 2 retries = 3 total calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 400 client errors — fetch called only once', async () => {
    vi.stubGlobal('fetch', makeFetch(400, { ...MOCK_ERROR_BODY, status: 400, code: 'INVALID_PLATE_FORMAT' }));
    const client = makeClient();
    await expect(client.lookup({ state: 'CA', plate: 'AB' })).rejects.toThrow(AutoDevApiError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

// ─── Caching ─────────────────────────────────────────────────────────────────

describe('Caching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('second identical call returns cached result — fetch called only once', async () => {
    const mockFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient({ cacheTtlMs: 60_000 });
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('cache is case-insensitive — abc-123 and ABC123 are the same key', async () => {
    const mockFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient({ cacheTtlMs: 60_000 });
    await client.lookup({ state: 'ca', plate: 'abc-123' });
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('entry is evicted after TTL expires', async () => {
    vi.useFakeTimers();
    const mockFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient({ cacheTtlMs: 1_000 });
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    vi.advanceTimersByTime(2_000);
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('errors are NOT cached — failed call followed by successful call makes 2 fetches', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: 'Unavailable' }),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(MOCK_RESPONSE),
        text: () => Promise.resolve(''),
      });
    vi.stubGlobal('fetch', mockFetch);
    const client = makeClient({ cacheTtlMs: 60_000, maxRetries: 0 });
    await expect(client.lookup({ state: 'CA', plate: 'ABC123' })).rejects.toThrow();
    const result = await client.lookup({ state: 'CA', plate: 'ABC123' });
    expect(result).toEqual(MOCK_RESPONSE);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

describe('Rate Limiting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws RateLimitExceededError when token bucket is empty', async () => {
    vi.stubGlobal('fetch', makeFetch(200, MOCK_RESPONSE));
    // maxRequestsPerSecond=1 with cacheTtlMs=0 means the second call exhausts the bucket
    const client = makeClient({ maxRequestsPerSecond: 1, cacheTtlMs: 0 });
    // First call succeeds (consumes the token)
    await client.lookup({ state: 'CA', plate: 'ABC123' });
    // Second call on a different plate hits an empty bucket
    await expect(client.lookup({ state: 'CA', plate: 'XY9999' })).rejects.toThrow(
      RateLimitExceededError,
    );
  });
});
