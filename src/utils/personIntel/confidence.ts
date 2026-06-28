import type { ConfidenceOpts, RawDataPoint, MergedDataPoint } from './types';

export function deriveConfidence(opts: ConfidenceOpts): number {
  const { sources, hasInternalRecord, hasCrawlCorroboration } = opts;
  const uniqueSources = Math.min(sources.length, 4);
  let score = 0.40 + (uniqueSources - 1) * 0.18;
  if (hasInternalRecord) score += 0.12;
  if (hasCrawlCorroboration) score += 0.08;
  return Math.min(0.95, Math.max(0.05, score));
}

export function mergeDataPoints(points: RawDataPoint[]): MergedDataPoint[] {
  const map = new Map<string, MergedDataPoint>();
  for (const p of points) {
    const key = `${p.category}|${p.field}|${p.value.toLowerCase().trim()}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.sources.includes(p.source)) existing.sources.push(p.source);
    } else {
      map.set(key, { category: p.category, field: p.field, value: p.value, sources: [p.source], confidence: 0 });
    }
  }
  const result = Array.from(map.values());
  for (const dp of result) {
    dp.confidence = deriveConfidence({ sources: dp.sources, hasInternalRecord: false, hasCrawlCorroboration: false });
  }
  return result;
}
