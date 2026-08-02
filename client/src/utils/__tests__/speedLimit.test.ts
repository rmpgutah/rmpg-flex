import { describe, it, expect } from 'vitest';
import { parseMaxspeedMph, decodeMaxspeedAnnotation } from '../speedLimit';

describe('parseMaxspeedMph', () => {
  it('parses a bare number', () => {
    expect(parseMaxspeedMph(35)).toBe(35);
  });
  it('parses a bare numeric string', () => {
    expect(parseMaxspeedMph('35')).toBe(35);
  });
  it('parses an explicit mph string', () => {
    expect(parseMaxspeedMph('35 mph')).toBe(35);
  });
  it('converts km/h to mph', () => {
    expect(parseMaxspeedMph('50 km/h')).toBe(31);
  });
  it('converts the kph spelling too', () => {
    expect(parseMaxspeedMph('50 kph')).toBe(31);
  });
  it('returns null for a non-numeric OSM value', () => {
    // Real OSM data carries these; they are not speeds.
    expect(parseMaxspeedMph('none')).toBeNull();
    expect(parseMaxspeedMph('signals')).toBeNull();
  });
  it('returns null for nullish and non-string input', () => {
    expect(parseMaxspeedMph(null)).toBeNull();
    expect(parseMaxspeedMph(undefined)).toBeNull();
    expect(parseMaxspeedMph({})).toBeNull();
  });
  it('rejects zero and negative speeds', () => {
    expect(parseMaxspeedMph(0)).toBeNull();
    expect(parseMaxspeedMph('-20')).toBeNull();
  });
});

describe('decodeMaxspeedAnnotation', () => {
  it('decodes an mph entry', () => {
    expect(decodeMaxspeedAnnotation({ speed: 55, unit: 'mph' })).toBe(55);
  });
  it('decodes and converts a km/h entry', () => {
    expect(decodeMaxspeedAnnotation({ speed: 56, unit: 'km/h' })).toBe(35);
  });
  it('returns null when Mapbox reports the limit unknown', () => {
    expect(decodeMaxspeedAnnotation({ unknown: true })).toBeNull();
  });
  it('returns null when Mapbox reports no limit (autobahn)', () => {
    expect(decodeMaxspeedAnnotation({ none: true })).toBeNull();
  });
  it('returns null for malformed entries', () => {
    expect(decodeMaxspeedAnnotation(null)).toBeNull();
    expect(decodeMaxspeedAnnotation({})).toBeNull();
    expect(decodeMaxspeedAnnotation({ speed: 55 })).toBeNull(); // unit required
  });
});
