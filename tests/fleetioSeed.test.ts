import { describe, it, expect } from 'vitest';
import { buildVehiclePayload } from '../src/utils/fleetio/seed';

describe('buildVehiclePayload', () => {
  const baseRow = {
    id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12',
    vin: '1HGBH41JXMN109186', plate_number: 'ABC123',
    year: 2022, make: 'Ford', model: 'Explorer', color: 'Black',
  };

  it('maps every required + optional field present on the row', () => {
    expect(buildVehiclePayload(baseRow)).toEqual({
      name: 'Unit 12',
      vin: '1HGBH41JXMN109186',
      license_plate: 'ABC123',
      year: 2022,
      make: 'Ford',
      model: 'Explorer',
      color: 'Black',
    });
  });

  it('falls back to vehicle_number when vehicle_name is null', () => {
    const r = { ...baseRow, vehicle_name: null };
    expect(buildVehiclePayload(r)?.name).toBe('U-12');
  });

  it('falls back to "VIN <vin>" when both name and number are null', () => {
    const r = { ...baseRow, vehicle_name: null, vehicle_number: null };
    expect(buildVehiclePayload(r)?.name).toBe('VIN 1HGBH41JXMN109186');
  });

  it('returns null when no usable name can be derived (no name, no number, no VIN)', () => {
    const r = { ...baseRow, vehicle_name: null, vehicle_number: null, vin: null };
    expect(buildVehiclePayload(r)).toBeNull();
  });

  it('omits empty string fields (Fleet.io rejects empty strings on some columns)', () => {
    const r = { ...baseRow, color: '' as unknown as string, plate_number: '' as unknown as string };
    const p = buildVehiclePayload(r);
    expect(p).not.toHaveProperty('color');
    expect(p).not.toHaveProperty('license_plate');
  });

  it('passes null year through unchanged', () => {
    const r = { ...baseRow, year: null };
    expect(buildVehiclePayload(r)?.year).toBeNull();
  });
});
