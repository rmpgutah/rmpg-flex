import { describe, it, expect } from 'vitest';
import {
  groupByOfficerLane,
  extendRange,
} from '../schedulerLanes';
import type { ScheduleSlot } from '../schedulerView';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: 1, queue_id: 10, attempt_number: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  window_label: 'evening', notify_at: '2026-06-21T15:00',
  recipient_name: 'J. Smith', recipient_address: '123 Main',
  recipient_city: 'SLC', recipient_state: 'UT',
  case_number: '240-1', priority: 'normal', deadline: null,
  status: 'pending', notified: 0, dismissed: 0,
  officer_id: 1, manually_moved: 0, auto_replan_source: null,
  urgency_tier: 'standard',
  ...over,
});

describe('groupByOfficerLane', () => {
  it('separates slots by officer id within each day', () => {
    const a = slot({ id: 1, scheduled_date: '2026-06-21', officer_id: 1 });
    const b = slot({ id: 2, scheduled_date: '2026-06-21', officer_id: 2 });
    const c = slot({ id: 3, scheduled_date: '2026-06-22', officer_id: 1 });
    const result = groupByOfficerLane([a, b, c]);
    expect(result.get('2026-06-21')?.get(1)?.map((s) => s.id)).toEqual([1]);
    expect(result.get('2026-06-21')?.get(2)?.map((s) => s.id)).toEqual([2]);
    expect(result.get('2026-06-22')?.get(1)?.map((s) => s.id)).toEqual([3]);
  });

  it('groups unassigned slots under officer_id key 0 (sentinel)', () => {
    const a = slot({ id: 1, officer_id: null });
    const result = groupByOfficerLane([a]);
    expect(result.get('2026-06-21')?.get(0)?.map((s) => s.id)).toEqual([1]);
  });

  it('returns an empty Map for an empty input', () => {
    expect(groupByOfficerLane([]).size).toBe(0);
  });
});

describe('extendRange', () => {
  it('expands week → 7 days', () => {
    const days = extendRange('2026-06-21', 'week');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-06-21');
    expect(days[6]).toBe('2026-06-27');
  });

  it('expands two-week → 14 days', () => {
    const days = extendRange('2026-06-21', 'two-week');
    expect(days).toHaveLength(14);
    expect(days[13]).toBe('2026-07-04');
  });

  it('expands month → calendar month length (28-31 days)', () => {
    const days = extendRange('2026-06-21', 'month');
    expect(days[0]).toBe('2026-06-21');
    // June has 30 days; from the 21st to 31 days later = 2026-07-21.
    expect(days.length).toBe(31);
    expect(days[30]).toBe('2026-07-21');
  });
});
