import { describe, it, expect } from 'vitest';
import { sightingSourceKey, sightingSource, ALL_SOURCES } from '../alprSource';

describe('sightingSourceKey', () => {
  it('classifies ClearPath dashcam reads', () => {
    expect(sightingSourceKey('ClearPath dashcam Sierra 19 @ 123 Main St')).toBe('dashcam');
    expect(sightingSourceKey('clearpath dashcam')).toBe('dashcam');
  });
  it('classifies field ALPR camera scans', () => {
    expect(sightingSourceKey('ALPR: silver Ford Super Duty 2017')).toBe('camera');
    expect(sightingSourceKey('ALPR capture (Workers AI)')).toBe('camera');
  });
  it('falls back to manual for anything else', () => {
    expect(sightingSourceKey('3533 Terra Sol Drive Observed')).toBe('manual');
    expect(sightingSourceKey('')).toBe('manual');
    expect(sightingSourceKey(null)).toBe('manual');
  });
  it('exposes a badge + color per source', () => {
    expect(sightingSource('ClearPath dashcam x').label).toBe('DASHCAM');
    expect(sightingSource('ALPR: x').color).toBe('#3b82f6');
    expect(sightingSource(null).label).toBe('MANUAL');
  });
  it('does not false-positive on free-text manual notes mentioning ALPR', () => {
    expect(sightingSourceKey('ALPR camera was offline, entered manually')).toBe('manual');
  });
  it('classifies a "ALPR:" prefix even with leading whitespace', () => {
    expect(sightingSourceKey('  ALPR: x')).toBe('camera');
  });
  it('classifies the bare "ALPR" legend chip', () => {
    expect(sightingSourceKey('ALPR')).toBe('camera');
  });
  it('exposes the expected set of source keys in ALL_SOURCES', () => {
    expect(ALL_SOURCES.map((s) => s.key)).toEqual(['camera', 'dashcam', 'manual']);
  });
});
