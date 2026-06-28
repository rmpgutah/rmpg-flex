// Collapse person hits that resolve to the same canonical identity into one
// card (so duplicates of the same human don't spam results). Non-persons and
// persons without a canonical link pass through as singletons.
import type { QueryHit } from './useIntelQuery';

export interface ClusteredHit { hit: QueryHit; linkedCount: number }

export function clusterHits(hits: QueryHit[]): ClusteredHit[] {
  const byCanonical = new Map<number, QueryHit[]>();
  const out: ClusteredHit[] = [];
  for (const h of hits) {
    const canonical = h.type === 'person' ? h.cluster?.canonical_person_id ?? null : null;
    if (canonical == null) { out.push({ hit: h, linkedCount: 1 }); continue; }
    byCanonical.set(canonical, [...(byCanonical.get(canonical) || []), h]);
  }
  for (const group of byCanonical.values()) {
    group.sort((a, b) => b.score - a.score);
    out.push({ hit: group[0], linkedCount: group.length });
  }
  out.sort((a, b) => b.hit.score - a.hit.score);
  return out;
}
