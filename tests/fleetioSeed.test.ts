import { describe, it, expect } from 'vitest';
import { buildVehiclePayload, mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio } from '../src/utils/fleetio/seed';

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

describe('mapVehicleFieldsToFleetio', () => {
  it('translates RMPG raw-row field names to Fleet.io field names', () => {
    expect(mapVehicleFieldsToFleetio({
      vehicle_name: 'PS-D19', plate_number: '8JAR3', vin: 'X', year: 2022,
      make: 'Dodge', model: '1500', color: 'White',
    })).toEqual({
      name: 'PS-D19', license_plate: '8JAR3', vin: 'X', year: 2022,
      make: 'Dodge', model: '1500', color: 'White',
    });
  });

  it('drops every RMPG-internal column with no Fleet.io equivalent (the live 422 cause)', () => {
    const mapped = mapVehicleFieldsToFleetio({
      id: 1, vehicle_name: 'PS-D19', vehicle_number: 'PS-D19', assigned_unit_id: 1,
      total_maintenance_cost: null, total_fuel_cost: null, lienholder: 'Bank',
      equipment: '["Lightbar"]', purchase_vendor: 'Prestman', is_pursuit_rated: 0,
      pursuit_rated: 0, watch_list: 0, current_mileage: 94016, created_at: 'x', updated_at: 'y',
    });
    expect(mapped).toEqual({ name: 'PS-D19' });
  });

  it('falls back to vehicle_number, then "VIN <vin>", for name', () => {
    expect(mapVehicleFieldsToFleetio({ vehicle_number: 'U-12' }).name).toBe('U-12');
    expect(mapVehicleFieldsToFleetio({ vin: 'ABC123' }).name).toBe('VIN ABC123');
    expect(mapVehicleFieldsToFleetio({})).not.toHaveProperty('name');
  });
});

describe('mapFuelEntryFieldsToFleetio', () => {
  it('translates RMPG fuel_log column names to Fleet.io fuel_entries field names', () => {
    expect(mapFuelEntryFieldsToFleetio({
      vehicle_id: 42, fuel_date: '2026-07-17', gallons: 5.026, total_cost: 20,
    })).toEqual({ vehicle_id: 42, date: '2026-07-17', us_gallons: 5.026, cost: 20 });
  });

  it('drops RMPG-only fields with no Fleet.io equivalent (the live 422 cause)', () => {
    const mapped = mapFuelEntryFieldsToFleetio({
      id: 92, vehicle_id: 1, fuel_date: '2026-07-17', gallons: 5.026,
      cost_per_gallon: 3.979, fuel_type: 'regular', station: 'Maverik 627',
      payment_method: 'Cash', driver_name: 'X', location: 'Y', mpg: null,
      total_cost: 20, custom_fields_json: null,
    });
    expect(mapped).toEqual({ vehicle_id: 1, date: '2026-07-17', us_gallons: 5.026, cost: 20 });
  });
});
