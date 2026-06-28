import type { SourceResult, MergedDataPoint, IntelConnection } from './types';
import { deriveConfidence } from './confidence';

export interface FusionResult {
  mergedPoints: MergedDataPoint[];
  connections: IntelConnection[];
  successCount: number;
}

export function fuseResults(results: SourceResult[]): FusionResult {
  const map = new Map<string, MergedDataPoint>();
  const connections: IntelConnection[] = [];
  let successCount = 0;

  for (const r of results) {
    if (r.status === 'success') successCount++;
    for (const dp of r.dataPoints) {
      const key = `${dp.category}|${dp.field}|${dp.value.toLowerCase().trim()}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.includes(dp.source)) existing.sources.push(dp.source);
      } else {
        map.set(key, { category: dp.category, field: dp.field, value: dp.value, sources: [dp.source], confidence: 0 });
      }
    }
    connections.push(...r.connections);
  }

  const mergedPoints = Array.from(map.values()).map(dp => ({
    ...dp,
    confidence: deriveConfidence({ sources: dp.sources, hasInternalRecord: false, hasCrawlCorroboration: false }),
  }));

  return { mergedPoints, connections, successCount };
}
