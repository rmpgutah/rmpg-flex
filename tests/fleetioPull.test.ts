import { describe, it, expect } from 'vitest';
import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction } from '../src/utils/fleetio/pull';
import type { FleetioVehicle } from '../src/utils/fleetio/types';
import type { LocalVehicleForMatch } from '../src/utils/fleetio/pull';

function fioVehicle(overrides: Partial<FleetioVehicle> = {}): FleetioVehicle {
  return {
    id: 501, name: 'PS-D19', vin: '1C6SRFMTXNN283482', license_plate: '8JAR3',
    year: 2022, make: 'Dodge (RAM)', model: '1500 Bighorn', color: 'White',
    archived_at: null, created_at: '2026-01-01', updated_at: '2026-01-01',
    ...overrides,
  };
}

const localRow: LocalVehicleForMatch = {
  id: 1, vin: '1C6SRFMTXNN283482', plate_number: '8JAR3',
  vehicle_number: 'PS-D19', vehicle_name: 'PS-D19',
};

describe('matchLocalVehicle', () => {
  it('matches by VIN even when name/plate differ', () => {
    const fio = fioVehicle({ name: 'Different Name', license_plate: 'ZZZ999' });
    expect(matchLocalVehicle(fio, [localRow])).toEqual(localRow);
  });

  it('falls back to license plate when VIN is absent', () => {
    const fio = fioVehicle({ vin: null, name: 'Different Name' });
    expect(matchLocalVehicle(fio, [localRow])).toEqual(localRow);
  });

  it('falls back to name/vehicle_number when VIN and plate are absent', () => {
    const fio = fioVehicle({ vin: null, license_plate: null });
    expect(matchLocalVehicle(fio, [localRow])).toEqual(localRow);
  });

  it('is case- and whitespace-insensitive', () => {
    const fio = fioVehicle({ vin: ' 1c6srfmtxnn283482 ' });
    expect(matchLocalVehicle(fio, [localRow])).toEqual(localRow);
  });

  it('returns null when nothing matches', () => {
    const fio = fioVehicle({ vin: 'UNKNOWNVIN', license_plate: 'NEW999', name: 'New Truck' });
    expect(matchLocalVehicle(fio, [localRow])).toBeNull();
  });

  it('returns null against an empty local list', () => {
    expect(matchLocalVehicle(fioVehicle(), [])).toBeNull();
  });
});

describe('buildLocalInsertFromFleetio', () => {
  it('maps a Fleet.io vehicle to an insertable fleet_vehicles row', () => {
    const row = buildLocalInsertFromFleetio(fioVehicle());
    expect(row).toEqual({
      vehicle_name: 'PS-D19',
      vehicle_number: 'PS-D19',
      vin: '1C6SRFMTXNN283482',
      plate_number: '8JAR3',
      year: 2022,
      make: 'Dodge (RAM)',
      model: '1500 Bighorn',
      color: 'White',
      status: 'in_service',
    });
  });

  it('returns null when the Fleet.io vehicle has no name', () => {
    expect(buildLocalInsertFromFleetio(fioVehicle({ name: null }))).toBeNull();
    expect(buildLocalInsertFromFleetio(fioVehicle({ name: '' }))).toBeNull();
    expect(buildLocalInsertFromFleetio(fioVehicle({ name: '   ' }))).toBeNull();
  });

  it('nulls out missing optional fields rather than passing through undefined', () => {
    const row = buildLocalInsertFromFleetio(fioVehicle({ vin: null, license_plate: null, make: null, model: null, color: null, year: null }));
    expect(row).toEqual({
      vehicle_name: 'PS-D19',
      vehicle_number: 'PS-D19',
      vin: null,
      plate_number: null,
      year: null,
      make: null,
      model: null,
      color: null,
      status: 'in_service',
    });
  });
});

describe('decideMatchAction', () => {
  // Guards fleetio_links' UNIQUE(rmpg_table, rmpg_id) — a second link
  // attempt for an rmpg_id that already has one must be a conflict, not
  // another insert (which would throw and abort the whole /pull reconcile).
  it('links when the matched local row has no existing link', () => {
    expect(decideMatchAction(1, new Set())).toBe('link');
    expect(decideMatchAction(1, new Set([2, 3]))).toBe('link');
  });

  it('flags a conflict when the matched local row already has a link', () => {
    // Scenario: local row already linked to a different Fleet.io vehicle,
    // either from an earlier /pull run or an earlier vehicle in this same
    // run matching the same local row via a shared VIN/plate/name.
    expect(decideMatchAction(1, new Set([1]))).toBe('conflict');
    expect(decideMatchAction(2, new Set([1, 2, 3]))).toBe('conflict');
  });
});
