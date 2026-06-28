import { describe, it, expect } from 'vitest';
import {
  msToSpeed, formatSpeed, formatDistanceShort, formatDistanceLong,
  formatElevation, metersToMiles, metersToKm, speedColor,
} from '../navUnits';

describe('navUnits — speed conversion', () => {
  it('converts m/s to mph and km/h', () => {
    expect(msToSpeed(10, 'imperial')).toBeCloseTo(22.369, 2);
    expect(msToSpeed(10, 'metric')).toBeCloseTo(36, 5);
  });
  it('clamps invalid/negative to 0', () => {
    expect(msToSpeed(-5, 'imperial')).toBe(0);
    expect(msToSpeed(NaN, 'metric')).toBe(0);
  });
  it('formats speed with unit label', () => {
    expect(formatSpeed(58, 'imperial')).toBe('58 mph');
    expect(formatSpeed(93, 'metric')).toBe('93 km/h');
  });
});

describe('navUnits — distance', () => {
  it('metersToMiles / metersToKm boundary', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
    expect(metersToKm(1000)).toBe(1);
  });
  it('short distance emits ft / m', () => {
    expect(formatDistanceShort(30, 'imperial')).toMatch(/ ft$/);
    expect(formatDistanceShort(30, 'metric')).toBe('30 m');
  });
  it('long distance emits mi / km with adaptive precision', () => {
    expect(formatDistanceLong(1609.344, 'imperial')).toBe('1.0 mi');
    expect(formatDistanceLong(1000, 'metric')).toBe('1.0 km');
    expect(formatDistanceLong(40233.6, 'imperial')).toBe('25 mi');
  });
});

describe('navUnits — elevation', () => {
  it('keeps feet imperial, converts metric', () => {
    expect(formatElevation(100, 'imperial')).toBe('100 ft');
    expect(formatElevation(328.084, 'metric')).toBe('100 m');
  });
});

describe('navUnits — speedColor bands (unit-correct)', () => {
  const GOLD = '#d4a017';
  const AMBER = '#c47f17';
  const RED = '#b3261e';
  it('imperial bands', () => {
    expect(speedColor(25, 'imperial')).toBe(GOLD);
    expect(speedColor(35, 'imperial')).toBe(GOLD);
    expect(speedColor(50, 'imperial')).toBe(AMBER);
    expect(speedColor(65, 'imperial')).toBe(AMBER);
    expect(speedColor(80, 'imperial')).toBe(RED);
  });
  it('metric bands track km/h thresholds', () => {
    expect(speedColor(56, 'metric')).toBe(GOLD);
    expect(speedColor(90, 'metric')).toBe(AMBER);
    expect(speedColor(120, 'metric')).toBe(RED);
  });
});
