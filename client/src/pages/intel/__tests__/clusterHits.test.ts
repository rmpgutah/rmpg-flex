import { describe, it, expect } from 'vitest';
import { clusterHits } from '../clusterHits';
import type { QueryHit } from '../useIntelQuery';

const h = (id: number, canonical: number | null): QueryHit => ({
  type: 'person', id, label: `P${id}`, snippet: '', flags: [], score: 50,
  cluster: { canonical_person_id: canonical, pending_suggestions: 0 },
});

describe('clusterHits', () => {
  it('collapses persons sharing a canonical id into one card', () => {
    const out = clusterHits([h(1, 5), h(2, 5), h(3, null)]);
    // 1 and 2 share canonical 5 → one cluster; 3 stands alone
    expect(out.length).toBe(2);
    const merged = out.find((c) => c.linkedCount && c.linkedCount > 1);
    expect(merged?.linkedCount).toBe(2);
  });

  it('leaves non-person hits untouched', () => {
    const v: QueryHit = { type: 'vehicle', id: 9, label: 'Ford', snippet: '', flags: [], score: 40 };
    const out = clusterHits([v]);
    expect(out.length).toBe(1);
    expect(out[0].hit.type).toBe('vehicle');
  });
});
