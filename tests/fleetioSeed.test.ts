import { describe, it, expect } from 'vitest';
import { buildVehiclePayload, mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio, mapVendorFieldsToFleetio, mapPartFieldsToFleetio, mapWorkOrderFieldsToFleetio } from '../src/utils/fleetio/seed';

describe('buildVehiclePayload', () => {
  const baseRow = {
    id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12',
    vin: '1HGBH41JXMN109186', plate_number: 'ABC123',
    year: 2022, make: 'Ford', model: 'Explorer', color: 'Black',
  };

  it('maps every required + optional field present on the row, incl. the required primary_meter_unit default', () => {
    expect(buildVehiclePayload(baseRow)).toEqual({
      name: 'Unit 12',
      primary_meter_unit: 'mi',
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

  it('sends the REQUIRED primary_meter_unit only when isCreate is true (never on update — see comment)', () => {
    const payload = { vehicle_name: 'PS-D19' };
    expect(mapVehicleFieldsToFleetio(payload, true)).toHaveProperty('primary_meter_unit', 'mi');
    expect(mapVehicleFieldsToFleetio(payload, false)).not.toHaveProperty('primary_meter_unit');
    expect(mapVehicleFieldsToFleetio(payload)).not.toHaveProperty('primary_meter_unit'); // default false
  });
});

describe('mapFuelEntryFieldsToFleetio', () => {
  it('translates RMPG fuel_log column names to Fleet.io fuel_entries field names', () => {
    expect(mapFuelEntryFieldsToFleetio({
      vehicle_id: 42, fuel_date: '2026-07-17', gallons: 5.026, cost_per_gallon: 3.979, odometer: 93918.8,
    })).toEqual({
      vehicle_id: 42, date: '2026-07-17', us_gallons: 5.026, price_per_volume_unit: 3.979,
      meter_entry_attributes: { value: '93918.8' },
    });
  });

  it('drops RMPG-only fields with no Fleet.io equivalent, and includes the REQUIRED meter_entry_attributes (the live 422 cause)', () => {
    const mapped = mapFuelEntryFieldsToFleetio({
      id: 92, vehicle_id: 1, fuel_date: '2026-07-17', gallons: 5.026,
      cost_per_gallon: 3.979, fuel_type: 'regular', station: 'Maverik 627',
      payment_method: 'Cash', driver_name: 'X', location: 'Y', mpg: null,
      total_cost: 20, odometer: 93918.8, custom_fields_json: null,
    });
    expect(mapped).toEqual({
      vehicle_id: 1, date: '2026-07-17', us_gallons: 5.026, price_per_volume_unit: 3.979,
      meter_entry_attributes: { value: '93918.8' },
    });
  });

  it('omits meter_entry_attributes when odometer is absent (Fleet.io will 422 — no valid meter value to send)', () => {
    expect(mapFuelEntryFieldsToFleetio({
      vehicle_id: 42, fuel_date: '2026-07-17', gallons: 5.026,
    })).toEqual({ vehicle_id: 42, date: '2026-07-17', us_gallons: 5.026 });
  });
});

describe('mapVendorFieldsToFleetio', () => {
  it('translates RMPG vendor field names to Fleet.io\'s real vendor field names', () => {
    expect(mapVendorFieldsToFleetio({
      name: 'AutoZone', address: '123 Main St', city: 'Salt Lake City',
      state: 'UT', zip: '84115', phone: '801-555-0100', email: 'ap@autozone.example',
    })).toEqual({
      name: 'AutoZone', street_address: '123 Main St', city: 'Salt Lake City',
      region: 'UT', postal_code: '84115', phone: '801-555-0100', contact_email: 'ap@autozone.example',
    });
  });

  it('drops RMPG-internal ref_vendors columns with no Fleet.io equivalent', () => {
    const mapped = mapVendorFieldsToFleetio({
      id: 2, name: 'AutoZone', kind: 'parts_supplier', lat: 40.7, lng: -111.9,
      notes: 'internal note', active: 1, created_at: 'x', updated_at: 'y',
    });
    expect(mapped).toEqual({ name: 'AutoZone' });
  });

  it('omits empty-string and null/undefined fields', () => {
    const mapped = mapVendorFieldsToFleetio({ name: 'AutoZone', phone: '', email: null, zip: undefined });
    expect(mapped).toEqual({ name: 'AutoZone' });
  });
});

describe('mapPartFieldsToFleetio', () => {
  it('translates RMPG part field names to Fleet.io\'s real part field names', () => {
    expect(mapPartFieldsToFleetio({
      name: 'Oil Filter', part_number: 'PF-46', category: 'Filters',
      description: 'Standard oil filter', unit_cost: 8.5, supplier: 'AutoZone',
    })).toEqual({
      number: 'PF-46', part_category_name: 'Filters',
      description: 'Standard oil filter', unit_cost: 8.5, part_manufacturer_name: 'AutoZone',
    });
  });

  it('drops `name` — Parts have no Fleet.io name field, they\'re identified by `number`', () => {
    const mapped = mapPartFieldsToFleetio({ name: 'Oil Filter', description: 'Standard oil filter' });
    expect(mapped).toEqual({ description: 'Standard oil filter' });
  });

  it('drops RMPG-internal fleet_parts columns with no Fleet.io equivalent', () => {
    const mapped = mapPartFieldsToFleetio({
      id: 5, name: 'Oil Filter', quantity_on_hand: 12, reorder_point: 3,
      location: 'Shelf A2', compatible_vehicles: '[1,2,3]',
    });
    expect(mapped).toEqual({});
  });

  it('omits empty-string and null/undefined fields', () => {
    const mapped = mapPartFieldsToFleetio({ part_number: 'PF-46', supplier: '', unit_cost: null });
    expect(mapped).toEqual({ number: 'PF-46' });
  });
});

describe('mapWorkOrderFieldsToFleetio', () => {
  it('translates RMPG work_orders field names to Fleet.io\'s real work_order field names', () => {
    expect(mapWorkOrderFieldsToFleetio({
      vehicle_id: 42, vendor_id: 7, opened_at: '2026-07-17T10:00:00Z', closed_at: '2026-07-18T10:00:00Z',
      summary: 'Brake replacement', odometer_at_open: 94000, odometer_at_close: 94050, notes: 'Customer requested rush job',
    })).toEqual({
      vehicle_id: 42, vendor_id: 7, issued_at: '2026-07-17T10:00:00Z', completed_at: '2026-07-18T10:00:00Z',
      description: 'Brake replacement',
      starting_meter_entry_attributes: { value: '94000' },
      ending_meter_entry_attributes: { value: '94050' },
      comments_attributes: [{ comment: 'Customer requested rush job' }],
    });
  });

  it('sends the REQUIRED issued_at field derived from opened_at (the live 422 cause)', () => {
    const mapped = mapWorkOrderFieldsToFleetio({ vehicle_id: 1, opened_at: '2026-07-17T10:00:00Z' });
    expect(mapped).toEqual({ vehicle_id: 1, issued_at: '2026-07-17T10:00:00Z' });
  });

  it('drops RMPG-internal work_orders columns with no Fleet.io equivalent (category_code, assigned_to_user_id, created_by, status, est_cost, actual_cost, vmrs_*_code, custom_fields_json)', () => {
    const mapped = mapWorkOrderFieldsToFleetio({
      id: 9, vehicle_id: 1, category_code: 'BRAKE', assigned_to_user_id: 4, created_by: 3,
      status: 'open', est_cost: 200, actual_cost: 210, vmrs_system_code: '013', vmrs_assembly_code: '001',
      vmrs_component_code: '002', custom_fields_json: '{}',
    });
    expect(mapped).toEqual({ vehicle_id: 1 });
  });
});
