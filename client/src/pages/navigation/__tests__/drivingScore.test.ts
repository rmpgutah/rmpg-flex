import { describe, it, expect } from 'vitest';
import { tripDrivingScore } from '../drivingScore';

describe('tripDrivingScore', () => {
  it('scores 100 for a clean trip', () => {
    expect(tripDrivingScore({ harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0 })).toBe(100);
  });
  it('deducts per harsh event across all three categories', () => {
    expect(tripDrivingScore({ harsh_accel_count: 1, harsh_brake_count: 1, harsh_corner_count: 1 })).toBe(76);
  });
  it('floors at 0 for very harsh trips', () => {
    expect(tripDrivingScore({ harsh_accel_count: 10, harsh_brake_count: 10, harsh_corner_count: 10 })).toBe(0);
  });
});
