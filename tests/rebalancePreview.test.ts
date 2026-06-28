import { describe, it, expect } from 'vitest';
import {
  previewRangeRebalance,
  type RebalanceQueueRow,
} from '../src/utils/rebalancePreview';

const row = (over: Partial<RebalanceQueueRow> = {}): RebalanceQueueRow => ({
  id: 1, deadline: null, max_attempts: 3, attempt_count: 0,
  priority: 'normal', urgency_tier: 'standard',
  ...over,
});

const NOW = '2026-06-11T10:00:00.000Z';

describe('previewRangeRebalance', () => {
  it('returns zeroed counts on an empty queue', () => {
    const result = previewRangeRebalance([], NOW);
    expect(result).toEqual({
      changes: [], skipped_manual: 0,
      tiers_promoted_critical: 0, priority_escalated: 0,
    });
  });

  it('proposes a critical promotion for a queue row near its deadline', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-06-12', priority: 'normal', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      queue_id: 1,
      reason: 'urgency_promotion',
      to_tier: 'critical',
      to_priority: 'rush',
    });
    expect(result.tiers_promoted_critical).toBe(1);
    expect(result.priority_escalated).toBe(1);
  });

  it('does NOT promote priority when it is already "urgent"', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-06-12', priority: 'urgent', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes[0]).toMatchObject({ queue_id: 1, to_priority: null });
    expect(result.priority_escalated).toBe(0);
  });

  it('does not change anything for a queue row already at the right tier', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-08-12', priority: 'normal', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes).toHaveLength(0);
  });

  it('produces a stable order across calls (sorted by queue_id)', () => {
    const queue = [
      row({ id: 2, deadline: '2026-06-12' }),
      row({ id: 1, deadline: '2026-06-12' }),
    ];
    const result = previewRangeRebalance(queue, NOW);
    expect(result.changes.map((c) => c.queue_id)).toEqual([1, 2]);
  });
});
