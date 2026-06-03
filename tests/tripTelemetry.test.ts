import { describe, it, expect } from 'vitest';
import { emptyAgg, accumulate, haversineM, type IncomingFix } from '../src/utils/tripTelemetry';

const at = (lat: number, lng: number, ts: number, speed: number | null = null): IncomingFix =>
  ({ lat, lng, speed, heading: null, ts });

describe('tripTelemetry.accumulate', () => {
  it('first fix seeds state, adds no distance', () => {
    const a = accumulate(emptyAgg(), at(40.76, -111.89, 1000));
    expect(a.distance_m).toBe(0);
    expect(a.fix_count).toBe(1);
    expect(a.prev_lat).toBeCloseTo(40.76);
  });

  it('accumulates distance across two fixes (~100m apart)', () => {
    let a = accumulate(emptyAgg(), at(40.7600, -111.8900, 0));
    a = accumulate(a, at(40.7609, -111.8900, 10_000)); // ~100m north
    expect(a.distance_m).toBeGreaterThan(90);
    expect(a.distance_m).toBeLessThan(110);
  });

  it('tracks max_speed from device speed (m/s)', () => {
    let a = accumulate(emptyAgg(), at(40.76, -111.89, 0, 5));
    a = accumulate(a, at(40.761, -111.89, 5_000, 20));
    expect(a.max_speed).toBe(20);
  });

  it('ignores teleport jumps (>5km between fixes) in distance', () => {
    let a = accumulate(emptyAgg(), at(40.76, -111.89, 0));
    a = accumulate(a, at(41.50, -112.50, 5_000)); // ~90km — bad fix
    expect(a.distance_m).toBe(0);
  });

  it('counts a harsh brake when decel exceeds the LE threshold', () => {
    let a = accumulate(emptyAgg(), at(40.7600, -111.8900, 0, 26.8)); // ~60 mph
    a = accumulate(a, at(40.7601, -111.8900, 1_000, 2.2));           // ~5 mph
    expect(a.harsh_brake_count).toBe(1);
  });
});

describe('haversineM', () => {
  it('measures ~111km per degree of latitude', () => {
    expect(haversineM(40, -111, 41, -111)).toBeGreaterThan(110_000);
    expect(haversineM(40, -111, 41, -111)).toBeLessThan(112_000);
  });
});
