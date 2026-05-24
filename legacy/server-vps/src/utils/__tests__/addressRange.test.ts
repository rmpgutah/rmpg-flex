import { describe, it, expect } from 'vitest';
import {
  interpolateAlongRange,
  parityMatches,
  normalizeStreetName,
} from '../addressRange';

describe('interpolateAlongRange', () => {
  it('returns 0.5 for the midpoint of an ascending range', () => {
    expect(interpolateAlongRange(100, 0, 200)).toBeCloseTo(0.5);
  });

  it('returns 0.5 for the midpoint of a descending range', () => {
    expect(interpolateAlongRange(100, 200, 0)).toBeCloseTo(0.5);
  });

  it('clamps house numbers above the range to 1.0', () => {
    expect(interpolateAlongRange(300, 0, 200)).toBe(1);
  });

  it('clamps house numbers below the range to 0.0', () => {
    expect(interpolateAlongRange(-50, 0, 200)).toBe(0);
  });

  it('returns 0 when endpoints are equal (no divide-by-zero)', () => {
    expect(interpolateAlongRange(100, 100, 100)).toBe(0);
  });
});

describe('parityMatches', () => {
  it('odd house matches O parity', () => {
    expect(parityMatches(101, 'O')).toBe(true);
  });
  it('even house does not match O parity', () => {
    expect(parityMatches(100, 'O')).toBe(false);
  });
  it('even house matches E parity', () => {
    expect(parityMatches(100, 'E')).toBe(true);
  });
  it('odd house does not match E parity', () => {
    expect(parityMatches(101, 'E')).toBe(false);
  });
  it('any house matches B parity', () => {
    expect(parityMatches(100, 'B')).toBe(true);
    expect(parityMatches(101, 'B')).toBe(true);
  });
  it('any house matches null parity', () => {
    expect(parityMatches(100, null)).toBe(true);
  });
});

describe('normalizeStreetName', () => {
  it('uppercases input', () => {
    expect(normalizeStreetName('main')).toBe('MAIN');
  });
  it('strips periods', () => {
    expect(normalizeStreetName('S. Main St.')).toBe('S MAIN ST');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeStreetName('south   main   street')).toBe('SOUTH MAIN STREET');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeStreetName('  main  ')).toBe('MAIN');
  });
  it('handles empty input', () => {
    expect(normalizeStreetName('')).toBe('');
  });
});
