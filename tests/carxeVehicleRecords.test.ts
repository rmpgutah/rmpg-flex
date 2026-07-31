// tests/carxeVehicleRecords.test.ts
// Unit tests for the pure helpers in src/utils/carxe/vehicleRecords.ts.
// The DB-touching functions (resolveVehicleRecord / upsertVehicleFromCarxe) are
// covered against a real D1 in test-workers/carxe.test.ts — these cover the
// mapping/parsing logic that has no DB dependency.
import { describe, it, expect } from 'vitest';
import {
  parseVehicleYear,
  normalizeId,
  fieldsFromPlateResult,
  fieldsFromSpecsResult,
  titleStatusFromHistory,
} from '../src/utils/carxe/vehicleRecords';
import type { CarxePlateResult, CarxeSpecsResult, CarxeHistoryResult } from '../src/utils/carxe/types';

describe('parseVehicleYear', () => {
  it('parses the string years the CarsXE plate decoder returns', () => {
    expect(parseVehicleYear('2015')).toBe(2015);
  });

  it('takes the first year from a range, instead of storing 0', () => {
    // vehicles_records.year is INTEGER. SQLite would coerce "2014-2015" to 0
    // rather than erroring, silently corrupting the record.
    expect(parseVehicleYear('2014-2015')).toBe(2014);
  });

  it('accepts a real number (the lien/theft endpoint returns year as a number)', () => {
    expect(parseVehicleYear(2015)).toBe(2015);
  });

  it('rejects junk and out-of-range values rather than writing them', () => {
    expect(parseVehicleYear(undefined)).toBeNull();
    expect(parseVehicleYear(null)).toBeNull();
    expect(parseVehicleYear('')).toBeNull();
    expect(parseVehicleYear('unknown')).toBeNull();
    expect(parseVehicleYear(1823)).toBeNull();
    expect(parseVehicleYear(3000)).toBeNull();
  });
});

describe('normalizeId', () => {
  it('upper-cases and trims', () => {
    expect(normalizeId('  abc123 ')).toBe('ABC123');
  });

  it('returns undefined for blanks so callers can skip the WHERE clause', () => {
    // Returning '' here would make resolveVehicleRecord match rows whose
    // plate/vin is literally empty — worse than not matching at all.
    expect(normalizeId('')).toBeUndefined();
    expect(normalizeId('   ')).toBeUndefined();
    expect(normalizeId(undefined)).toBeUndefined();
    expect(normalizeId(null)).toBeUndefined();
  });
});

describe('fieldsFromPlateResult', () => {
  it('maps the decoder payload onto vehicles_records columns', () => {
    const result = {
      success: true,
      input: { plate: '7XER187' },
      make: 'Dodge',
      model: 'Charger',
      trim: 'SXT',
      year: '2015',
      color: 'Black',
      vin: '2c3cdxfg1fh762860',
      style: 'Sedan',
    } as CarxePlateResult;

    expect(fieldsFromPlateResult(result)).toEqual({
      vin: '2C3CDXFG1FH762860', // normalized — stored VINs must be comparable
      make: 'Dodge',
      model: 'Charger',
      year: 2015,
      color: 'Black',
      trim: 'SXT',
      body_style: 'Sedan',
    });
  });

  it('prefers body_style over style when both are present', () => {
    const result = { success: true, input: { plate: 'X' }, style: 'Sedan', body_style: '4dr Sedan' } as CarxePlateResult;
    expect(fieldsFromPlateResult(result).body_style).toBe('4dr Sedan');
  });

  it('yields nulls (not undefined) for a sparse response so writes are skipped cleanly', () => {
    const fields = fieldsFromPlateResult({ success: true, input: { plate: 'X' } } as CarxePlateResult);
    expect(fields.make).toBeNull();
    expect(fields.year).toBeNull();
    expect(fields.vin).toBeNull();
  });
});

describe('fieldsFromSpecsResult', () => {
  it('maps attributes onto the spec columns', () => {
    const result = {
      success: true,
      input: { vin: 'X' },
      attributes: {
        make: 'Dodge',
        model: 'Charger',
        year: '2015',
        trim: 'SXT',
        body_style: 'Sedan',
        engine: '3.6L V6',
        fuel_type: 'Gasoline',
        transmission: '8-Speed Automatic',
        drive_type: 'RWD',
        doors: '4',
      },
    } as CarxeSpecsResult;

    expect(fieldsFromSpecsResult(result)).toMatchObject({
      make: 'Dodge',
      year: 2015,
      trim: 'SXT',
      body_style: 'Sedan',
      engine_type: '3.6L V6',
      fuel_type: 'Gasoline',
      transmission: '8-Speed Automatic',
      drive_type: 'RWD',
      doors: 4,
    });
  });

  it('probes alternate key names, since CarsXE specs keys vary by data provider', () => {
    const result = {
      success: true,
      input: { vin: 'X' },
      attributes: { transmission_short: '8A', driven_wheels: 'AWD', body_type: 'SUV', number_of_doors: '5' },
    } as CarxeSpecsResult;

    const fields = fieldsFromSpecsResult(result);
    expect(fields.transmission).toBe('8A');
    expect(fields.drive_type).toBe('AWD');
    expect(fields.body_style).toBe('SUV');
    expect(fields.doors).toBe(5);
  });

  it('rejects implausible door counts rather than writing them', () => {
    const mk = (doors: string) =>
      fieldsFromSpecsResult({ success: true, input: { vin: 'X' }, attributes: { doors } } as CarxeSpecsResult).doors;
    expect(mk('0')).toBeNull();
    expect(mk('99')).toBeNull();
    expect(mk('not-a-number')).toBeNull();
  });

  it('tolerates a missing attributes dict entirely', () => {
    const fields = fieldsFromSpecsResult({ success: true, input: { vin: 'X' } } as CarxeSpecsResult);
    expect(fields.make).toBeNull();
    expect(fields.doors).toBeNull();
  });
});

describe('titleStatusFromHistory', () => {
  it('prefers a title BRAND over a plain title status — the brand is the operationally significant fact', () => {
    const result = {
      vin: 'X',
      success: true,
      brandsInformation: [{ brand: 'SALVAGE' }],
      currentTitleInformation: [{ titleStatus: 'Current' }],
    } as unknown as CarxeHistoryResult;
    expect(titleStatusFromHistory(result)).toBe('SALVAGE');
  });

  it('falls back to title status when no brand is present', () => {
    const result = {
      vin: 'X',
      success: true,
      currentTitleInformation: [{ titleStatus: 'Clear' }],
    } as unknown as CarxeHistoryResult;
    expect(titleStatusFromHistory(result)).toBe('Clear');
  });

  it('falls back to junk/salvage disposition last', () => {
    const result = {
      vin: 'X',
      success: true,
      junkAndSalvageInformation: [{ disposition: 'SOLD' }],
    } as unknown as CarxeHistoryResult;
    expect(titleStatusFromHistory(result)).toBe('SOLD');
  });

  it('skips blank/unusable entries rather than writing an empty string', () => {
    const result = {
      vin: 'X',
      success: true,
      brandsInformation: [{ brand: '   ' }, { brand: 'FLOOD' }],
    } as unknown as CarxeHistoryResult;
    expect(titleStatusFromHistory(result)).toBe('FLOOD');
  });

  it('returns null for an empty or malformed history payload instead of throwing', () => {
    // CarsXE nests history differently per data provider, so these arrays are
    // typed unknown[] — a non-object entry must not crash the walk.
    expect(titleStatusFromHistory({ vin: 'X', success: true } as CarxeHistoryResult)).toBeNull();
    expect(titleStatusFromHistory({ vin: 'X', success: true, brandsInformation: [] } as unknown as CarxeHistoryResult)).toBeNull();
    expect(
      titleStatusFromHistory({ vin: 'X', success: true, brandsInformation: ['nope', null, 42] } as unknown as CarxeHistoryResult),
    ).toBeNull();
    expect(
      titleStatusFromHistory({ vin: 'X', success: true, brandsInformation: 'not-an-array' } as unknown as CarxeHistoryResult),
    ).toBeNull();
  });
});
