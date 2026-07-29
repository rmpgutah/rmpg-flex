import { describe, it, expect } from 'vitest';
import {
  parseVehicleScope,
  vehicleScope,
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

  // This is the case that makes Number.isSafeInteger load-bearing rather than
  // belt-and-braces: a long digit run satisfies VEHICLE_ID_PATTERN (all ASCII
  // digits, no leading zero) and only the safe-integer check stops it.
  it('rejects values beyond the safe-integer range', () => {
    expect(parseVehicleScope('999999999999999999999999')).toBeNull();
  });

  it('rejects whitespace-padded input rather than silently trimming it', () => {
    expect(parseVehicleScope(' 42 ')).toBeNull();
    expect(parseVehicleScope('42\n')).toBeNull();
  });
});

describe('vehicleScope().and', () => {
  it('emits a bound predicate when scoped', () => {
    expect(vehicleScope(42).and('vehicle_id')).toBe('AND vehicle_id = ?');
  });

  it('emits an empty string when fleet-wide, leaving the query unchanged', () => {
    expect(vehicleScope(null).and('vehicle_id')).toBe('');
  });

  it('never interpolates the id into the SQL text', () => {
    expect(vehicleScope(42).and('vehicle_id')).not.toContain('42');
  });

  it('supports a qualified column for joined queries', () => {
    expect(vehicleScope(7).and('fv.id')).toBe('AND fv.id = ?');
  });

  it('throws on malicious/malformed column identifiers', () => {
    expect(() => vehicleScope(42).and('vehicle_id = 1; DROP TABLE fleet_vehicles; --')).toThrow();
    expect(() => vehicleScope(42).and('id) OR (1=1')).toThrow();
    expect(() => vehicleScope(42).and("id' OR '1'='1")).toThrow();
    expect(() => vehicleScope(42).and('id /* comment */')).toThrow();
    expect(() => vehicleScope(42).and('')).toThrow();
  });

  it('validates the column on the fleet-wide path too, not just when scoped', () => {
    // Otherwise a bad identifier stays hidden until someone passes ?vehicle_id=.
    expect(() => vehicleScope(null).and('id; DROP TABLE fleet_vehicles')).toThrow();
  });
});

describe('vehicleScope().binds', () => {
  it('derives one bind per scoped and() call rather than a hand-passed count', () => {
    const one = vehicleScope(42);
    one.and('vehicle_id');
    expect(one.binds()).toEqual([42]);

    const three = vehicleScope(42);
    three.and('vehicle_id');
    three.and('id');
    three.and('fv.id');
    expect(three.binds()).toEqual([42, 42, 42]);
  });

  it('reserves nothing when no predicate was emitted', () => {
    expect(vehicleScope(42).binds()).toEqual([]);
  });

  it('returns no binds when fleet-wide, however many and() calls were made', () => {
    const s = vehicleScope(null);
    s.and('vehicle_id');
    s.and('id');
    expect(s.binds()).toEqual([]);
  });

  // The regression this API exists to prevent: the fragment count and the bind
  // count are the same number by construction, so adding a predicate cannot
  // leave a `?` unbound the way scopeBinds(id, times) could.
  it('keeps fragments and binds in step as predicates are added', () => {
    for (const columns of [['vehicle_id'], ['vehicle_id', 'id'], ['a', 'b', 'c', 'd']]) {
      const s = vehicleScope(9);
      const sql = columns.map((col) => s.and(col)).join(' ');
      const placeholders = (sql.match(/\?/g) ?? []).length;
      expect(s.binds()).toHaveLength(placeholders);
    }
  });

  it('matches the real call shape, where and() runs inside the template literal', () => {
    // Argument evaluation is left to right, so every and() in the SQL string
    // has already run by the time ...binds() is evaluated.
    const build = (id: number | null) => {
      const s = vehicleScope(id);
      return [`SELECT 1 FROM t WHERE 1=1 ${s.and('vehicle_id')}`, ...s.binds()] as const;
    };
    expect(build(42)).toEqual(['SELECT 1 FROM t WHERE 1=1 AND vehicle_id = ?', 42]);
    expect(build(null)).toEqual(['SELECT 1 FROM t WHERE 1=1 ']);
  });
});

describe('vehicleScope() single-use sealing', () => {
  it('throws when and() is called after binds(), instead of emitting an unbound ?', () => {
    const s = vehicleScope(42);
    s.and('vehicle_id');
    s.binds();
    expect(() => s.and('id')).toThrow(/after binds/);
  });

  it('throws when one builder is reused for a second query', () => {
    const s = vehicleScope(42);
    s.and('vehicle_id');
    s.binds();
    expect(() => s.binds()).toThrow(/twice/);
  });

  it('seals even when fleet-wide, so misuse is caught on both paths', () => {
    const s = vehicleScope(null);
    s.binds();
    expect(() => s.binds()).toThrow();
    expect(() => s.and('vehicle_id')).toThrow();
  });
});

describe('FLEET_ONLY_BLOCKS', () => {
  it('names the blocks that are meaningless for a single vehicle', () => {
    expect(FLEET_ONLY_BLOCKS).toContain('mileage_distribution');
    expect(FLEET_ONLY_BLOCKS).toContain('status_breakdown');
    expect(FLEET_ONLY_BLOCKS).toContain('utilization');
    expect(FLEET_ONLY_BLOCKS).toContain('service_compliance');
    expect(FLEET_ONLY_BLOCKS).toContain('cost_per_mile_ranking');
    expect(FLEET_ONLY_BLOCKS).toContain('oldest_vehicle_year');
    // 'fuel_economy_ranking' is deliberately NOT in this list — the route
    // never returns that key (it returns the properly-scoped
    // 'fuel_economy_trend' instead), so it named a block that doesn't exist.
  });
});
