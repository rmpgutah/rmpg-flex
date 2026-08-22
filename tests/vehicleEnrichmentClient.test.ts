import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import {
  VehicleEnrichConfigError,
  VehicleEnrichTimeoutError,
  VehicleEnrichHttpError,
  VehicleEnrichRateLimitError,
} from '../src/utils/vehicleEnrichment/types';
import {
  checkAndReservePlateToVin,
  checkAndReserveVinDecoder,
  checkAndReservePlateDecoder,
  ENRICH_RATE_LIMITS,
} from '../src/utils/vehicleEnrichment/rateLimit';
import { plateToVin, decodeVin, decodePlate } from '../src/utils/vehicleEnrichment/client';

const originalFetch = globalThis.fetch;

beforeAll(() => {
  // nothing — just ensures originalFetch is captured before any test mutates it
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('VehicleEnrich error types', () => {
  it('VehicleEnrichConfigError is an Error with correct name', () => {
    const err = new VehicleEnrichConfigError('PLATE_TO_VIN_API_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichConfigError');
    expect(err.apiKey).toBe('PLATE_TO_VIN_API_KEY');
  });

  it('VehicleEnrichTimeoutError is an Error with correct name', () => {
    const err = new VehicleEnrichTimeoutError('plateToVin', 10000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichTimeoutError');
    expect(err.step).toBe('plateToVin');
    expect(err.timeoutMs).toBe(10000);
  });

  it('VehicleEnrichHttpError carries status and step', () => {
    const err = new VehicleEnrichHttpError('decodeVin', 429, 'Too Many Requests');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichHttpError');
    expect(err.step).toBe('decodeVin');
    expect(err.status).toBe(429);
  });

  it('VehicleEnrichRateLimitError is an Error with correct name and api field', () => {
    const err = new VehicleEnrichRateLimitError('plateToVin');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichRateLimitError');
    expect(err.api).toBe('plateToVin');
  });
});

describe('vehicle enrichment rate limits', () => {
  const makeKv = (stored: Record<string, string>) => ({
    get: async (k: string) => stored[k] ?? null,
    put: async (k: string, v: string) => { stored[k] = v; },
  });

  it('allows call when under daily limit (plateToVin)', async () => {
    const kv = makeKv({});
    await expect(checkAndReservePlateToVin(kv, Date.now())).resolves.toBeUndefined();
  });

  it('blocks when daily budget exhausted (plateToVin)', async () => {
    const kv = makeKv({});
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    // Pre-fill to the limit
    await kv.put(`vehicle_enrich:plate_to_vin:day:${day}`, String(ENRICH_RATE_LIMITS.plateToVin.daily));
    await expect(checkAndReservePlateToVin(kv, now)).rejects.toThrow(VehicleEnrichRateLimitError);
  });

  it('allows vinDecoder call when under monthly limit', async () => {
    const kv = makeKv({});
    await expect(checkAndReserveVinDecoder(kv, Date.now())).resolves.toBeUndefined();
  });

  it('blocks vinDecoder when monthly budget exhausted', async () => {
    const kv = makeKv({});
    const now = Date.now();
    const month = new Date(now).toISOString().slice(0, 7);
    await kv.put(`vehicle_enrich:vin_decoder:month:${month}`, String(ENRICH_RATE_LIMITS.vinDecoder.monthly));
    await expect(checkAndReserveVinDecoder(kv, now)).rejects.toThrow(VehicleEnrichRateLimitError);
  });

  it('allows plateDecoder call when under daily limit', async () => {
    const kv = makeKv({});
    await expect(checkAndReservePlateDecoder(kv, Date.now())).resolves.toBeUndefined();
  });
});

describe('plateToVin client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(plateToVin('ABC123', 'UT', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('returns vin from successful response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ vin: '1HGBH41JXMN109186' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const result = await plateToVin('ABC123', 'UT', 'test-key');
    expect(result.vin).toBe('1HGBH41JXMN109186');
  });

  it('throws VehicleEnrichHttpError on 401 without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'Unauthorized',
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(plateToVin('ABC123', 'UT', 'bad-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null vin when API returns no match', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ vin: null }),
    }) as unknown as typeof fetch;
    const result = await plateToVin('ZZZNONE', 'UT', 'test-key');
    expect(result.vin).toBeNull();
  });

  it('retries on 500 and succeeds if retry returns 200', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ vin: '1HGBH41JXMN109186' }) });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const result = await plateToVin('ABC123', 'UT', 'test-key');
    expect(result.vin).toBe('1HGBH41JXMN109186');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws VehicleEnrichHttpError when both 500 calls fail', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(plateToVin('ABC123', 'UT', 'test-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('decodeVin client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(decodeVin('1HGBH41JXMN109186', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('returns decoded fields from successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        make: 'Honda', model: 'Civic', year: 2021,
        trim: 'EX', color: 'Blue', vehicle_type: 'Passenger',
      }),
    }) as unknown as typeof fetch;
    const result = await decodeVin('1HGBH41JXMN109186', 'test-key');
    expect(result.make).toBe('Honda');
    expect(result.year).toBe(2021);
  });

  it('throws VehicleEnrichHttpError on 400 without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'Bad Request',
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(decodeVin('BADINPUT', 'test-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('decodePlate client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(decodePlate('ABC123', 'UT', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('throws VehicleEnrichHttpError when both 500 calls fail', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(decodePlate('ABC123', 'UT', 'test-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('parses string-form year correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ make: 'Ford', model: 'F-150', year: '2019', vehicle_type: 'Truck' }),
    }) as unknown as typeof fetch;
    const result = await decodePlate('ABC123', 'UT', 'test-key');
    expect(result.year).toBe(2019);
  });
});
