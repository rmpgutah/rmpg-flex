import { describe, expect, test } from 'vitest';
import { normalizeAddress, cacheKeyParcels, cacheKeyParcel } from '../src/utils/sl-assessor/cache';

describe('normalizeAddress', () => {
  test('lowercases and trims', () => {
    expect(normalizeAddress('  2200 S 500 E  ')).toBe('2200 s 500 e');
  });
  test('canonicalises directionals', () => {
    expect(normalizeAddress('2200 South 500 East')).toBe('2200 s 500 e');
    expect(normalizeAddress('123 NW Main Street')).toBe('123 nw main st');
  });
  test('canonicalises street types', () => {
    expect(normalizeAddress('123 Main Street')).toBe('123 main st');
    expect(normalizeAddress('123 Main Avenue')).toBe('123 main ave');
    expect(normalizeAddress('123 Main Boulevard')).toBe('123 main blvd');
  });
  test('collapses internal whitespace', () => {
    expect(normalizeAddress('2200   S    500\tE')).toBe('2200 s 500 e');
  });
  test('strips trailing city/state/zip', () => {
    expect(normalizeAddress('2200 S 500 E, Salt Lake City, UT 84106')).toBe('2200 s 500 e');
  });
  test('returns empty for blank input', () => {
    expect(normalizeAddress('  ')).toBe('');
    expect(normalizeAddress('')).toBe('');
  });
});

describe('cacheKey*', () => {
  test('cacheKeyParcels prefixes and normalises', () => {
    expect(cacheKeyParcels('2200 South 500 East')).toBe('assessor:parcels:2200 s 500 e');
  });
  test('cacheKeyParcel preserves dashes', () => {
    expect(cacheKeyParcel('16-04-301-005')).toBe('assessor:parcel:16-04-301-005');
  });
});
