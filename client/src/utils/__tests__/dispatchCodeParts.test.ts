import { describe, it, expect } from 'vitest';
import {
  beatLeaf,
  sectionZoneBeatCombined,
  zoneLeaf,
} from '../dispatchCodeParts';

describe('zoneLeaf', () => {
  it('strips the section prefix from a chart zone code', () => {
    expect(zoneLeaf('SL1-HER')).toBe('HER');
    expect(zoneLeaf('UT2-PRO')).toBe('PRO');
    expect(zoneLeaf('DV1-NSL')).toBe('NSL');
  });
  it('handles compound city codes that contain a dash', () => {
    // Only the first dash is the section separator.
    expect(zoneLeaf('SL1-NORTH-SLC')).toBe('NORTH-SLC');
  });
  it('returns the raw value when there is no dash', () => {
    expect(zoneLeaf('SLC')).toBe('SLC');
  });
  it('handles nullish input', () => {
    expect(zoneLeaf(null)).toBe('');
    expect(zoneLeaf(undefined)).toBe('');
    expect(zoneLeaf('')).toBe('');
  });
});

describe('beatLeaf', () => {
  it('returns the trailing letter from a chart beat code', () => {
    expect(beatLeaf('SL1-HER/C')).toBe('C');
    expect(beatLeaf('UT2-PRO/A')).toBe('A');
    expect(beatLeaf('DV1-NSL/B')).toBe('B');
  });
  it('handles a multi-char trailing token', () => {
    expect(beatLeaf('SL1-HER/A1')).toBe('A1');
  });
  it('returns the raw value when there is no slash', () => {
    expect(beatLeaf('UNINC')).toBe('UNINC');
  });
  it('handles nullish input', () => {
    expect(beatLeaf(null)).toBe('');
    expect(beatLeaf(undefined)).toBe('');
    expect(beatLeaf('')).toBe('');
  });
});

describe('sectionZoneBeatCombined', () => {
  it('renders SL1/HER/C with all-slash separators from beat_code', () => {
    expect(sectionZoneBeatCombined('SL1', 'SL1-HER', 'SL1-HER/C')).toBe('SL1/HER/C');
  });
  it('falls back to zone_code when beat_id is missing', () => {
    expect(sectionZoneBeatCombined('SL1', 'SL1-HER', null)).toBe('SL1/HER');
  });
  it('falls back to sector_id when zone_id is missing', () => {
    expect(sectionZoneBeatCombined('SL1', null, null)).toBe('SL1');
  });
  it('returns empty when no parts are present', () => {
    expect(sectionZoneBeatCombined(null, null, null)).toBe('');
  });
});
