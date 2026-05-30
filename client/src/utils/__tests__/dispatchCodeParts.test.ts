import { describe, it, expect } from 'vitest';
import {
  beatLeaf,
  sectionPrefix,
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

describe('sectionPrefix', () => {
  it('extracts the section prefix from a chart zone code', () => {
    expect(sectionPrefix('SL1-HER')).toBe('SL1');
    expect(sectionPrefix('UT2-PRO')).toBe('UT2');
    expect(sectionPrefix('DV1-NSL')).toBe('DV1');
  });
  it('takes only up to the first dash for compound city codes', () => {
    expect(sectionPrefix('SL1-NORTH-SLC')).toBe('SL1');
  });
  it('returns empty when there is no embedded section', () => {
    expect(sectionPrefix('SLC')).toBe('');
    expect(sectionPrefix('-LEADING')).toBe('');
  });
  it('handles nullish input', () => {
    expect(sectionPrefix(null)).toBe('');
    expect(sectionPrefix(undefined)).toBe('');
    expect(sectionPrefix('')).toBe('');
  });
  it('is the complement of zoneLeaf', () => {
    const z = 'SL1-HER';
    expect(`${sectionPrefix(z)}-${zoneLeaf(z)}`).toBe(z);
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
