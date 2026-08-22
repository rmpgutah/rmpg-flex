// tests/vehicleEnrichment.test.ts
//
// Tests for enrichChain.ts (buildPlateKey + enrichVehicleRecord).
// Uses vitest module mocking to isolate API and DB dependencies.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Pure helper ─────────────────────────────────────────────────────────────

describe('buildPlateKey', () => {
  it('normalizes plate and state to uppercase', async () => {
    vi.resetModules();
    const { buildPlateKey } = await import('../src/utils/vehicleEnrichment/enrichChain');
    expect(buildPlateKey('abc123', 'ut')).toBe('ABC123|UT');
  });

  it('trims leading/trailing whitespace on both parts', async () => {
    vi.resetModules();
    const { buildPlateKey } = await import('../src/utils/vehicleEnrichment/enrichChain');
    expect(buildPlateKey('  ABC123  ', '  UT  ')).toBe('ABC123|UT');
  });

  it('handles empty state', async () => {
    vi.resetModules();
    const { buildPlateKey } = await import('../src/utils/vehicleEnrichment/enrichChain');
    expect(buildPlateKey('ABC123', '')).toBe('ABC123|');
  });
});

// ─── Cache hit ────────────────────────────────────────────────────────────────

describe('enrichVehicleRecord — cache hit', () => {
  it('returns fromCache=true and skips all API calls when cache row exists', async () => {
    vi.resetModules();
    vi.doMock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: vi.fn().mockRejectedValue(new Error('should not be called')),
      decodeVin: vi.fn().mockRejectedValue(new Error('should not be called')),
      decodePlate: vi.fn().mockRejectedValue(new Error('should not be called')),
    }));
    vi.doMock('../src/utils/vehicleEnrichment/rateLimit', () => ({
      checkAndReservePlateToVin: vi.fn().mockResolvedValue(undefined),
      checkAndReserveVinDecoder: vi.fn().mockResolvedValue(undefined),
      checkAndReservePlateDecoder: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/utils/carxe/vehicleRecords', () => ({
      upsertVehicleFromCarxe: vi.fn().mockResolvedValue({ vehicleId: 42, created: false, filled: 0 }),
      resolveVehicleRecord: vi.fn().mockResolvedValue(null),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      // first call = cache lookup (hit), second = vehicles_records id lookup
      first: vi.fn()
        .mockResolvedValueOnce({
          id: 1, plate_number: 'ABC123', state: 'UT',
          vin: '1HGBH41JXMN109186', make: 'Honda', model: 'Civic',
          year: 2021, trim: 'EX', color: 'Blue', vehicle_type: 'Passenger',
        })
        .mockResolvedValueOnce({ id: 42 }),
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      PLATE_TO_VIN_API_KEY: 'key1', VIN_DECODER_API_KEY: 'key2', PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('ABC123', 'UT', mockDb, mockEnv as never);

    expect(result.fromCache).toBe(true);
    expect(result.vehicleId).toBe(42);
    expect(result.data.vin).toBe('1HGBH41JXMN109186');
    expect(result.stepsRun).toHaveLength(0);
  });
});

// ─── force=true bypasses cache ────────────────────────────────────────────────

describe('enrichVehicleRecord — force bypasses cache', () => {
  it('calls the API chain even when a cache row exists', async () => {
    vi.resetModules();
    const plateToVinMock = vi.fn().mockResolvedValue({ vin: '1HGBH41JXMN109186' });
    vi.doMock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: plateToVinMock,
      decodeVin: vi.fn().mockResolvedValue({ make: 'Honda', model: 'Civic', year: 2021, trim: null, color: null, vehicle_type: null }),
      decodePlate: vi.fn().mockRejectedValue(new Error('not needed')),
    }));
    vi.doMock('../src/utils/vehicleEnrichment/rateLimit', () => ({
      checkAndReservePlateToVin: vi.fn().mockResolvedValue(undefined),
      checkAndReserveVinDecoder: vi.fn().mockResolvedValue(undefined),
      checkAndReservePlateDecoder: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/utils/carxe/vehicleRecords', () => ({
      upsertVehicleFromCarxe: vi.fn().mockResolvedValue({ vehicleId: 5, created: false, filled: 2 }),
      resolveVehicleRecord: vi.fn().mockResolvedValue({ id: 5, vin: null, plate_number: 'ABC123', flags: null }),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null), // returns null so cache upsert's run() mock handles it
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 5 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      PLATE_TO_VIN_API_KEY: 'key1', VIN_DECODER_API_KEY: 'key2', PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('ABC123', 'UT', mockDb, mockEnv as never, undefined, { force: true });

    expect(result.fromCache).toBe(false);
    expect(plateToVinMock).toHaveBeenCalled();
  });
});

// ─── Step 1 failure — chain continues with step 3, skips step 2 ──────────────

describe('enrichVehicleRecord — step 1 failure', () => {
  it('skips step 2 (no VIN) and tries step 3 when plateToVin fails', async () => {
    vi.resetModules();
    const decodeVinMock = vi.fn();
    const decodePlateMock = vi.fn().mockResolvedValue({ make: 'Toyota', model: 'Corolla', year: 2020, vehicle_type: 'Sedan' });

    vi.doMock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: vi.fn().mockRejectedValue(new Error('network error')),
      decodeVin: decodeVinMock,
      decodePlate: decodePlateMock,
    }));
    vi.doMock('../src/utils/vehicleEnrichment/rateLimit', () => ({
      checkAndReservePlateToVin: vi.fn().mockResolvedValue(undefined),
      checkAndReserveVinDecoder: vi.fn().mockResolvedValue(undefined),
      checkAndReservePlateDecoder: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/utils/carxe/vehicleRecords', () => ({
      upsertVehicleFromCarxe: vi.fn().mockResolvedValue({ vehicleId: 7, created: true, filled: 3 }),
      resolveVehicleRecord: vi.fn().mockResolvedValue(null),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null), // cache miss
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 7 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      PLATE_TO_VIN_API_KEY: 'key1', VIN_DECODER_API_KEY: 'key2', PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('XYZ999', 'UT', mockDb, mockEnv as never);

    expect(result.fromCache).toBe(false);
    expect(result.stepErrors['plateToVin']).toBeDefined();
    expect(decodeVinMock).not.toHaveBeenCalled(); // no VIN, step 2 skipped
    expect(decodePlateMock).toHaveBeenCalled();   // step 3 tried
    expect(result.stepsRun).toContain('decodePlate');
    expect(result.data.make).toBe('Toyota');
  });
});

// ─── All steps fail — no throw, row unchanged ────────────────────────────────

describe('enrichVehicleRecord — all steps fail', () => {
  it('does not throw and returns stepErrors when all API calls fail', async () => {
    vi.resetModules();
    const upsertMock = vi.fn();

    vi.doMock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: vi.fn().mockRejectedValue(new Error('network')),
      decodeVin: vi.fn().mockRejectedValue(new Error('network')),
      decodePlate: vi.fn().mockRejectedValue(new Error('network')),
    }));
    vi.doMock('../src/utils/vehicleEnrichment/rateLimit', () => ({
      checkAndReservePlateToVin: vi.fn().mockResolvedValue(undefined),
      checkAndReserveVinDecoder: vi.fn().mockResolvedValue(undefined),
      checkAndReservePlateDecoder: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/utils/carxe/vehicleRecords', () => ({
      upsertVehicleFromCarxe: upsertMock,
      resolveVehicleRecord: vi.fn().mockResolvedValue(null),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn()
        .mockResolvedValueOnce(null)        // cache miss
        .mockResolvedValueOnce({ id: 5 }), // fallback vehicleId lookup
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      PLATE_TO_VIN_API_KEY: 'key1', VIN_DECODER_API_KEY: 'key2', PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('FAIL99', 'UT', mockDb, mockEnv as never);

    expect(result.fromCache).toBe(false);
    expect(result.stepsRun).toHaveLength(0);
    expect(Object.keys(result.stepErrors).length).toBeGreaterThan(0);
    expect(result.stepErrors['plateToVin']).toBeDefined();
    // upsertVehicleFromCarxe must NOT have been called (no data to write)
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

// ─── Successful chain: upsertVehicleFromCarxe called with merged data ─────────

describe('enrichVehicleRecord — successful chain', () => {
  it('calls upsertVehicleFromCarxe with merged make/model/vin data', async () => {
    vi.resetModules();
    const upsertMock = vi.fn().mockResolvedValue({ vehicleId: 99, created: false, filled: 4 });

    vi.doMock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: vi.fn().mockResolvedValue({ vin: '1HGBH41JXMN109186' }),
      decodeVin: vi.fn().mockResolvedValue({ make: 'Honda', model: 'Civic', year: 2021, trim: 'EX', color: 'Blue', vehicle_type: 'Passenger' }),
      decodePlate: vi.fn().mockRejectedValue(new Error('not needed')),
    }));
    vi.doMock('../src/utils/vehicleEnrichment/rateLimit', () => ({
      checkAndReservePlateToVin: vi.fn().mockResolvedValue(undefined),
      checkAndReserveVinDecoder: vi.fn().mockResolvedValue(undefined),
      checkAndReservePlateDecoder: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/utils/carxe/vehicleRecords', () => ({
      upsertVehicleFromCarxe: upsertMock,
      resolveVehicleRecord: vi.fn().mockResolvedValue({ id: 99, vin: null, plate_number: 'GOOD1', flags: null }),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null), // cache miss
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 99 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      PLATE_TO_VIN_API_KEY: 'key1', VIN_DECODER_API_KEY: 'key2', PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('GOOD1', 'UT', mockDb, mockEnv as never);

    expect(result.vehicleId).toBe(99);
    expect(result.fromCache).toBe(false);
    expect(result.stepsRun).toContain('plateToVin');
    expect(result.stepsRun).toContain('decodeVin');
    expect(result.data.make).toBe('Honda');
    expect(result.data.vin).toBe('1HGBH41JXMN109186');
    expect(upsertMock).toHaveBeenCalledWith(
      mockDb,
      { plate: 'GOOD1', state: 'UT' },
      expect.objectContaining({ vin: '1HGBH41JXMN109186', make: 'Honda', model: 'Civic' }),
      'vehicle-enrichment-api',
    );
  });
});
