import { describe, it, expect } from 'vitest';
import { deriveConfidence, mergeDataPoints } from '../src/utils/personIntel/confidence';
import type { RawDataPoint } from '../src/utils/personIntel/types';

describe('deriveConfidence', () => {
  it('base with one source = 0.40', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.40);
  });
  it('two sources = 0.58', () => {
    expect(deriveConfidence({ sources: ['MicroBilt', 'Pipl'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.58);
  });
  it('three sources = 0.76', () => {
    expect(deriveConfidence({ sources: ['MicroBilt', 'Pipl', 'Spokeo'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.76);
  });
  it('internal record bonus = +0.12', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: true, hasCrawlCorroboration: false })).toBeCloseTo(0.52);
  });
  it('crawl corroboration bonus = +0.08', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: false, hasCrawlCorroboration: true })).toBeCloseTo(0.48);
  });
  it('caps at 0.95', () => {
    expect(deriveConfidence({ sources: ['A', 'B', 'C', 'D'], hasInternalRecord: true, hasCrawlCorroboration: true })).toBeLessThanOrEqual(0.95);
  });
});

describe('mergeDataPoints', () => {
  it('dedupes identical values and merges sources', () => {
    const points: RawDataPoint[] = [
      { category: 'address', field: 'street', value: '123 Main St', source: 'MicroBilt' },
      { category: 'address', field: 'street', value: '123 Main St', source: 'Pipl' },
    ];
    const merged = mergeDataPoints(points);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toContain('MicroBilt');
    expect(merged[0].sources).toContain('Pipl');
  });
  it('keeps distinct values as separate points', () => {
    const points: RawDataPoint[] = [
      { category: 'phone', field: 'number', value: '8015550001', source: 'MicroBilt' },
      { category: 'phone', field: 'number', value: '8015550002', source: 'Pipl' },
    ];
    expect(mergeDataPoints(points)).toHaveLength(2);
  });
});
