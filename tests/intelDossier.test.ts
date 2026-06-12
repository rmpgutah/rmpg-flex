import { describe, it, expect } from 'vitest';
import { mergeTimeline, rankAssociates, type TimelineEvent } from '../src/utils/intelDossier';

describe('mergeTimeline', () => {
  it('merges and sorts date-desc, tolerating null dates (sorted last)', () => {
    const a: TimelineEvent[] = [{ kind: 'call', id: 1, date: '2026-01-05', title: 'CFS-1', subtitle: '', status: 'closed' }];
    const b: TimelineEvent[] = [
      { kind: 'warrant', id: 2, date: '2026-03-01', title: 'W-2', subtitle: '', status: 'active' },
      { kind: 'citation', id: 3, date: null, title: 'CIT-3', subtitle: '', status: 'issued' },
    ];
    const merged = mergeTimeline([a, b]);
    expect(merged.map((e) => e.id)).toEqual([2, 1, 3]);
  });
});

describe('rankAssociates', () => {
  it('ranks by shared-event count and collects kinds, excluding the subject + cluster', () => {
    const co = [
      { person_id: 5, name: 'A B', kind: 'call' },
      { person_id: 5, name: 'A B', kind: 'incident' },
      { person_id: 6, name: 'C D', kind: 'call' },
      { person_id: 1, name: 'Self', kind: 'call' },   // subject — excluded
      { person_id: 9, name: 'Alias', kind: 'call' },  // cluster member — excluded
    ];
    const ranked = rankAssociates(co, new Set([1, 9]), 15);
    expect(ranked[0]).toEqual({ person_id: 5, name: 'A B', shared_events: 2, kinds: ['call', 'incident'] });
    expect(ranked[1].person_id).toBe(6);
    expect(ranked.find((r) => r.person_id === 1 || r.person_id === 9)).toBeUndefined();
  });

  it('caps at the limit', () => {
    const co = Array.from({ length: 30 }, (_, i) => ({ person_id: i + 2, name: `P${i}`, kind: 'call' }));
    expect(rankAssociates(co, new Set([1]), 15)).toHaveLength(15);
  });
});
