import { describe, expect, it } from 'vitest';
import {
  beatChartCode,
  beatLetter,
  formatBeatDispatchCode,
  sectionPrefix,
  sectorChartLabel,
  zoneChartCode,
} from '../dispatchGeoCode';
import type { Beat, Sector, Zone } from '../../types/geography';

describe('sectionPrefix', () => {
  it('reduces 3-letter sector codes to chart 2-letter prefix', () => {
    expect(sectionPrefix('SLC')).toBe('SL');
    expect(sectionPrefix('UTC')).toBe('UT');
    expect(sectionPrefix('WBR')).toBe('WB');
    expect(sectionPrefix('DVS')).toBe('DV');
  });
  it('handles nullish and non-alpha input', () => {
    expect(sectionPrefix(null)).toBe('');
    expect(sectionPrefix('')).toBe('');
    expect(sectionPrefix('SL-1')).toBe('SL');
  });
});

describe('formatBeatDispatchCode', () => {
  it('formats the chart dispatch code', () => {
    expect(
      formatBeatDispatchCode({ section: 'SLC', zone: 'SLC', beat: 'A' }),
    ).toBe('SL-SLC/A');
    expect(
      formatBeatDispatchCode({ section: 'UTC', zone: 'PRO', beat: 'C' }),
    ).toBe('UT-PRO/C');
  });
  it('returns empty string when any component is missing', () => {
    expect(formatBeatDispatchCode({ section: 'SLC', zone: '', beat: 'A' })).toBe('');
    expect(formatBeatDispatchCode({ section: '', zone: 'SLC', beat: 'A' })).toBe('');
    expect(formatBeatDispatchCode({ section: 'SLC', zone: 'SLC', beat: null })).toBe('');
  });
});

describe('beatLetter', () => {
  it('prefers the explicit district_letter column', () => {
    expect(beatLetter({ district_letter: 'A', beat_code: 'whatever' } as Beat)).toBe('A');
  });
  it('falls back to trailing letter of beat_code', () => {
    expect(beatLetter({ district_letter: null, beat_code: 'SLC-B' } as Beat)).toBe('B');
    expect(beatLetter({ district_letter: null, beat_code: 'beat_3c' } as Beat)).toBe('C');
  });
  it('returns empty when no letter can be derived', () => {
    expect(beatLetter({ district_letter: null, beat_code: '12345' } as Beat)).toBe('');
  });
});

describe('beatChartCode', () => {
  it('synthesizes from joined sector/zone context', () => {
    const beat = {
      sector_code: 'SLC',
      zone_code: 'SLC',
      district_letter: 'A',
      beat_code: 'SLC-A',
      dispatch_code: null,
    } as Beat;
    expect(beatChartCode(beat)).toBe('SL-SLC/A');
  });
  it('falls back to persisted dispatch_code when context is missing', () => {
    const beat = {
      sector_code: null,
      zone_code: null,
      district_letter: null,
      beat_code: 'LEGACY',
      dispatch_code: 'LEGACY-CODE',
    } as Beat;
    expect(beatChartCode(beat)).toBe('LEGACY-CODE');
  });
});

describe('sectorChartLabel', () => {
  it('renders prefix + name', () => {
    expect(
      sectorChartLabel({ sector_code: 'SLC', sector_name: 'Salt Lake County' } as Sector),
    ).toBe('SL — Salt Lake County');
  });
});

describe('zoneChartCode', () => {
  it('renders section/zone composite', () => {
    expect(zoneChartCode({ sector_code: 'SLC', zone_code: 'SLC' } as Zone)).toBe('SL/SLC');
    expect(zoneChartCode({ sector_code: 'UTC', zone_code: 'PRO' } as Zone)).toBe('UT/PRO');
  });
  it('falls back to bare zone_code when sector context is missing', () => {
    expect(zoneChartCode({ sector_code: null, zone_code: 'PRO' } as Zone)).toBe('PRO');
  });
});
