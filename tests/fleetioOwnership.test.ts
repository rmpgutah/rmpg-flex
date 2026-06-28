import { describe, it, expect } from 'vitest';
import {
  VEHICLE_OWNERSHIP,
  FUEL_OWNERSHIP,
  getOwnership,
  outboundFieldFilter,
  partitionInboundFields,
  resolveSharedConflict,
  SHARED_CONFLICT_WINDOW_MS,
} from '../src/utils/fleetio/ownership';

describe('static maps are sane', () => {
  it('every VEHICLE_OWNERSHIP value is a valid class', () => {
    for (const v of Object.values(VEHICLE_OWNERSHIP)) {
      expect(['rmpg', 'fleetio', 'shared']).toContain(v);
    }
  });

  it('every FUEL_OWNERSHIP value is a valid class', () => {
    for (const v of Object.values(FUEL_OWNERSHIP)) {
      expect(['rmpg', 'fleetio', 'shared']).toContain(v);
    }
  });

  it('VEHICLE_OWNERSHIP includes the PR 3 schema-parity columns', () => {
    // Spot-check: every column added in mig 0136 should have an explicit class.
    expect(VEHICLE_OWNERSHIP.fuel_type_id).toBeDefined();
    expect(VEHICLE_OWNERSHIP.tire_size_id).toBeDefined();
    expect(VEHICLE_OWNERSHIP.oil_type_id).toBeDefined();
    expect(VEHICLE_OWNERSHIP.gvwr_lbs).toBeDefined();
    expect(VEHICLE_OWNERSHIP.watch_list).toBeDefined();
    expect(VEHICLE_OWNERSHIP.default_image_url).toBeDefined();
  });

  it('FUEL_OWNERSHIP includes the PR 3 schema-parity columns', () => {
    expect(FUEL_OWNERSHIP.vendor_id).toBeDefined();
    expect(FUEL_OWNERSHIP.geo_lat).toBeDefined();
    expect(FUEL_OWNERSHIP.geo_lng).toBeDefined();
    expect(FUEL_OWNERSHIP.receipt_r2_key).toBeDefined();
    expect(FUEL_OWNERSHIP.is_partial_fillup).toBeDefined();
    expect(FUEL_OWNERSHIP.reference_number).toBeDefined();
  });
});

describe('getOwnership', () => {
  it('returns the correct class for a known field', () => {
    expect(getOwnership('vehicle', 'vehicle_name')).toBe('rmpg');
    expect(getOwnership('vehicle', 'next_service_mileage')).toBe('fleetio');
    expect(getOwnership('vehicle', 'vin')).toBe('shared');
    expect(getOwnership('fuel_entry', 'driver_id')).toBe('rmpg');
    expect(getOwnership('fuel_entry', 'gallons')).toBe('shared');
  });

  it('returns null for an unknown field on a known resource', () => {
    expect(getOwnership('vehicle', 'some_made_up_column')).toBeNull();
  });

  it('returns null for an unknown resource', () => {
    expect(getOwnership('mystery_resource', 'vin')).toBeNull();
  });
});

describe('outboundFieldFilter', () => {
  it('keeps rmpg + shared fields, drops fleetio-owned ones', () => {
    const out = outboundFieldFilter('vehicle', [
      'vehicle_name',          // rmpg → keep
      'vin',                   // shared → keep
      'next_service_mileage',  // fleetio → drop
      'watch_list',            // fleetio → drop
      'color',                 // rmpg → keep
    ]);
    expect(out.sort()).toEqual(['color', 'vehicle_name', 'vin']);
  });

  it('passes unknown fields through (caller decides)', () => {
    const out = outboundFieldFilter('vehicle', ['vehicle_name', 'some_unknown_col']);
    expect(out.sort()).toEqual(['some_unknown_col', 'vehicle_name']);
  });

  it('returns input unchanged for an unknown resource (defensive)', () => {
    const out = outboundFieldFilter('mystery', ['a', 'b']);
    expect(out.sort()).toEqual(['a', 'b']);
  });
});

describe('partitionInboundFields', () => {
  it('routes each field to its bucket by ownership class', () => {
    const { apply, conflict, unknown } = partitionInboundFields('vehicle', [
      'vehicle_name',          // rmpg → conflict
      'next_service_mileage',  // fleetio → apply
      'vin',                   // shared → apply
      'unknown_xyz',           // not in map → unknown
      'watch_list',            // fleetio → apply
      'is_take_home',          // rmpg → conflict
    ]);
    expect(apply.sort()).toEqual(['next_service_mileage', 'vin', 'watch_list']);
    expect(conflict.sort()).toEqual(['is_take_home', 'vehicle_name']);
    expect(unknown).toEqual(['unknown_xyz']);
  });

  it('on unknown resource, every field goes to unknown', () => {
    const out = partitionInboundFields('mystery', ['a', 'b']);
    expect(out.apply).toEqual([]);
    expect(out.conflict).toEqual([]);
    expect(out.unknown.sort()).toEqual(['a', 'b']);
  });

  it('on empty input, every bucket is empty', () => {
    const out = partitionInboundFields('vehicle', []);
    expect(out.apply).toEqual([]);
    expect(out.conflict).toEqual([]);
    expect(out.unknown).toEqual([]);
  });
});

describe('resolveSharedConflict', () => {
  const t0 = 1_700_000_000_000;
  it('returns unresolved when timestamps are inside the window', () => {
    expect(resolveSharedConflict(t0, t0 + 30_000)).toBe('unresolved');     // 30s
    expect(resolveSharedConflict(t0, t0 + SHARED_CONFLICT_WINDOW_MS)).toBe('unresolved'); // exact boundary
    expect(resolveSharedConflict(t0, t0 - 30_000)).toBe('unresolved');     // remote earlier
  });

  it('remote_wins when remote is strictly newer outside the window', () => {
    expect(resolveSharedConflict(t0, t0 + 61_000)).toBe('remote_wins');
    expect(resolveSharedConflict(t0, t0 + 5 * 60_000)).toBe('remote_wins');
  });

  it('local_wins when local is strictly newer outside the window', () => {
    expect(resolveSharedConflict(t0 + 61_000, t0)).toBe('local_wins');
  });

  it('on exactly-equal timestamps, returns unresolved', () => {
    expect(resolveSharedConflict(t0, t0)).toBe('unresolved');
  });

  it('honors a custom window when explicitly passed', () => {
    expect(resolveSharedConflict(t0, t0 + 10_000, 5_000)).toBe('remote_wins');
    expect(resolveSharedConflict(t0, t0 + 10_000, 15_000)).toBe('unresolved');
  });
});
