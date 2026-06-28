import { describe, it, expect } from 'vitest';
import { fuseResults } from '../src/utils/personIntel/fusion';
import type { SourceResult } from '../src/utils/personIntel/types';

describe('fuseResults', () => {
  it('merges duplicate values from different sources', () => {
    const results: SourceResult[] = [
      { sourceName: 'MicroBilt', phase: 2, status: 'success', dataPoints: [
        { category: 'address', field: 'city', value: 'Salt Lake City', source: 'MicroBilt' },
      ], connections: [], responseTimeMs: 100 },
      { sourceName: 'Pipl', phase: 2, status: 'success', dataPoints: [
        { category: 'address', field: 'city', value: 'Salt Lake City', source: 'Pipl' },
      ], connections: [], responseTimeMs: 200 },
    ];
    const fused = fuseResults(results);
    const cityPoints = fused.mergedPoints.filter(p => p.field === 'city');
    expect(cityPoints).toHaveLength(1);
    expect(cityPoints[0].sources).toContain('MicroBilt');
    expect(cityPoints[0].sources).toContain('Pipl');
    expect(cityPoints[0].confidence).toBeCloseTo(0.58);
  });

  it('filters noise below 0.40', () => {
    const results: SourceResult[] = [
      { sourceName: 'MicroBilt', phase: 2, status: 'success', dataPoints: [
        { category: 'online', field: 'profile', value: 'x', source: 'MicroBilt' },
      ], connections: [], responseTimeMs: 100 },
    ];
    const fused = fuseResults(results);
    // Single source with no internal/crawl corroboration → 0.40 exactly → not noise
    expect(fused.mergedPoints[0].confidence).toBeCloseTo(0.40);
  });

  it('collects connections from all sources', () => {
    const results: SourceResult[] = [
      { sourceName: 'Pipl', phase: 2, status: 'success', dataPoints: [], connections: [
        { fromSubject: 'John Doe', relationship: 'associate', toSubject: 'Jane Smith', confidence: 0.55, sources: ['Pipl'] },
      ], responseTimeMs: 100 },
    ];
    const fused = fuseResults(results);
    expect(fused.connections).toHaveLength(1);
  });
});
