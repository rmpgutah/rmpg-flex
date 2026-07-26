import { describe, it, expect } from 'vitest';
import {
  parseVehicleScope,
  scopeAnd,
  scopeBinds,
  FLEET_ONLY_BLOCKS,
} from '../src/utils/fleetAnalyticsScope';

describe('parseVehicleScope', () => {
  it('returns the id for a positive integer string', () => {
    expect(parseVehicleScope('42')).toBe(42);
  });

  it('returns null for absent input (fleet-wide is the default)', () => {
    expect(parseVehicleScope(undefined)).toBeNull();
    expect(parseVehicleScope(null)).toBeNull();
    expect(parseVehicleScope('')).toBeNull();
  });

  it('rejects non-numeric input rather than binding NaN', () => {
    expect(parseVehicleScope('abc')).toBeNull();
    expect(parseVehicleScope('7; DROP TABLE fleet_vehicles')).toBeNull();
  });

  it('rejects zero, negatives, and floats — ids are positive integers', () => {
    expect(parseVehicleScope('0')).toBeNull();
    expect(parseVehicleScope('-3')).toBeNull();
    expect(parseVehicleScope('4.5')).toBeNull();
  });

  it('rejects Infinity', () => {
    expect(parseVehicleScope('Infinity')).toBeNull();
  });

  it('rejects hex notation', () => {
    expect(parseVehicleScope('0x2A')).toBeNull();
  });

  it('rejects scientific notation', () => {
    expect(parseVehicleScope('1e2')).toBeNull();
  });

  it('rejects values beyond the safe-integer range', () => {
    expect(parseVehicleScope('999999999999999999999999')).toBeNull();
  });

  it('rejects whitespace-padded input rather than silently trimming it', () => {
    expect(parseVehicleScope(' 42 ')).toBeNull();
    expect(parseVehicleScope('42\n')).toBeNull();
  });
});

describe('scopeAnd', () => {
  it('emits a bound predicate when scoped', () => {
    expect(scopeAnd('vehicle_id', 42)).toBe('AND vehicle_id = ?');
  });

  it('emits an empty string when fleet-wide, leaving the query unchanged', () => {
    expect(scopeAnd('vehicle_id', null)).toBe('');
  });

  it('never interpolates the id into the SQL text', () => {
    expect(scopeAnd('vehicle_id', 42)).not.toContain('42');
  });

  it('supports a qualified column for joined queries', () => {
    expect(scopeAnd('fv.id', 7)).toBe('AND fv.id = ?');
  });

  it('throws on malicious/malformed column identifiers', () => {
    expect(() => scopeAnd('vehicle_id = 1; DROP TABLE fleet_vehicles; --', 42)).toThrow();
    expect(() => scopeAnd('id) OR (1=1', 42)).toThrow();
    expect(() => scopeAnd("id' OR '1'='1", 42)).toThrow();
    expect(() => scopeAnd('id /* comment */', 42)).toThrow();
    expect(() => scopeAnd('', 42)).toThrow();
  });
});

describe('scopeBinds', () => {
  it('returns one bind per predicate when scoped', () => {
    expect(scopeBinds(42)).toEqual([42]);
    expect(scopeBinds(42, 3)).toEqual([42, 42, 42]);
  });

  it('returns no binds when fleet-wide', () => {
    expect(scopeBinds(null)).toEqual([]);
    expect(scopeBinds(null, 3)).toEqual([]);
  });
});

describe('FLEET_ONLY_BLOCKS', () => {
  it('names the blocks that are meaningless for a single vehicle', () => {
    expect(FLEET_ONLY_BLOCKS).toContain('mileage_distribution');
    expect(FLEET_ONLY_BLOCKS).toContain('status_breakdown');
    expect(FLEET_ONLY_BLOCKS).toContain('utilization');
    expect(FLEET_ONLY_BLOCKS).toContain('service_compliance');
    expect(FLEET_ONLY_BLOCKS).toContain('cost_per_mile_ranking');
    expect(FLEET_ONLY_BLOCKS).toContain('fuel_economy_ranking');
  });
});
