import { describe, it, expect } from 'vitest';
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
