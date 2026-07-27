import { describe, it, expect } from 'vitest';
import {
  dayRangeFromAnchor,
  groupByDay,
  formatDayHeader,
  computeChipBand,
  layoutDayChips,
  type ScheduleSlot,
} from '../schedulerView';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: 1, queue_id: 10, attempt: 0, attempt_number: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  window_label: 'evening', notify_at: '2026-06-21T15:00', notify_before_secs: 3600,
  recipient_name: 'J. Smith', recipient_address: '123 Main',
  recipient_city: 'SLC', recipient_state: 'UT',
  case_number: '240-1', priority: 'normal', deadline: null,
  status: 'pending', notified: 0, dismissed: 0,
  officer_id: null, manually_moved: 0, auto_replan_source: null,
  urgency_tier: 'standard',
  ...over,
});

describe('dayRangeFromAnchor', () => {
  it('returns 7 sequential YYYY-MM-DD strings starting at the anchor', () => {
    const days = dayRangeFromAnchor('2026-06-21', 7);
    expect(days).toEqual([
      '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24',
      '2026-06-25', '2026-06-26', '2026-06-27',
    ]);
  });

  it('handles month rollover', () => {
    const days = dayRangeFromAnchor('2026-06-29', 4);
    expect(days).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
  });
});

describe('groupByDay', () => {
  it('groups slots by scheduled_date and keeps order within a day', () => {
    const a = slot({ id: 1, scheduled_date: '2026-06-21', window_start: '08:00' });
    const b = slot({ id: 2, scheduled_date: '2026-06-21', window_start: '17:00' });
    const c = slot({ id: 3, scheduled_date: '2026-06-22', window_start: '09:00' });
    const grouped = groupByDay([b, a, c]);
    expect(grouped.get('2026-06-21')?.map(s => s.id)).toEqual([1, 2]);
    expect(grouped.get('2026-06-22')?.map(s => s.id)).toEqual([3]);
  });

  it('returns an empty Map for an empty input', () => {
    expect(groupByDay([]).size).toBe(0);
  });
});

describe('formatDayHeader', () => {
  it('returns short weekday + day-of-month from a YYYY-MM-DD string', () => {
    // 2026-06-21 is a Sunday in any timezone (the date is fixed by the string).
    expect(formatDayHeader('2026-06-21')).toBe('Sun 21');
  });

  it('handles single-digit days', () => {
    expect(formatDayHeader('2026-06-07')).toBe('Sun 7');
  });
});

describe('computeChipBand', () => {
  it('maps an evening 17:00–20:30 window to row 6, span 3', () => {
    // 2-hour bands starting at 06:00:
    //   06–08 = row 1, 08–10 = row 2, 10–12 = row 3, 12–14 = row 4,
    //   14–16 = row 5, 16–18 = row 6, 18–20 = row 7, 20–22 = row 8, 22–24 = row 9.
    // Window 17:00–20:30 starts in row 6, spans into row 8 → row=6 span=3.
    const band = computeChipBand('17:00', '20:30');
    expect(band).toEqual({ rowStart: 6, rowSpan: 3 });
  });

  it('clamps a pre-dawn window 04:00–05:00 to row 1', () => {
    expect(computeChipBand('04:00', '05:00')).toEqual({ rowStart: 1, rowSpan: 1 });
  });

  it('clamps a midnight-spanning window to the last visible band', () => {
    expect(computeChipBand('23:00', '23:59')).toEqual({ rowStart: 9, rowSpan: 1 });
  });
});

describe('layoutDayChips', () => {
  // Bands: computeChipBand maps 06:00 → row 1, 08:00 → row 2, ... 2h each.
  const at = (id: number, start: string, end: string) =>
    slot({ id, window_start: start, window_end: end });

  it('gives a lone chip the full width', () => {
    const [only] = layoutDayChips([at(1, '08:00', '10:00')]);
    expect(only).toMatchObject({ rowStart: 2, rowSpan: 1, lane: 0, lanes: 1 });
  });

  it('splits two chips sharing a band into side-by-side lanes', () => {
    const out = layoutDayChips([at(1, '08:00', '10:00'), at(2, '08:00', '10:00')]);
    expect(out.map((c) => [c.slot.id, c.lane, c.lanes])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
    ]);
  });

  it('reuses a lane once the previous chip in it has ended', () => {
    // 08–10 and 10–12 do not overlap, so both sit in lane 0 at full width.
    const out = layoutDayChips([at(1, '08:00', '10:00'), at(2, '10:00', '12:00')]);
    expect(out.map((c) => [c.lane, c.lanes])).toEqual([[0, 1], [0, 1]]);
  });

  it('scopes lane count to the overlap cluster, not the whole day', () => {
    // Cluster A: two chips overlapping in the morning ⇒ 2 lanes.
    // Cluster B: one isolated evening chip ⇒ must stay full width.
    const out = layoutDayChips([
      at(1, '08:00', '10:00'), at(2, '08:00', '10:00'), at(3, '20:00', '22:00'),
    ]);
    const byId = new Map(out.map((c) => [c.slot.id, c]));
    expect(byId.get(1)!.lanes).toBe(2);
    expect(byId.get(2)!.lanes).toBe(2);
    expect(byId.get(3)!).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('keeps a long chip and the chips it spans in distinct lanes', () => {
    const out = layoutDayChips([
      at(1, '08:00', '16:00'), at(2, '10:00', '12:00'), at(3, '12:00', '14:00'),
    ]);
    const byId = new Map(out.map((c) => [c.slot.id, c]));
    expect(byId.get(1)!.lane).toBe(0);
    // 2 and 3 don't overlap each other, so they share lane 1 — but all three
    // belong to one cluster, so every chip is sized for 2 lanes.
    expect(byId.get(2)!.lane).toBe(1);
    expect(byId.get(3)!.lane).toBe(1);
    expect(out.every((c) => c.lanes === 2)).toBe(true);
  });

  it('returns an empty layout for an empty day', () => {
    expect(layoutDayChips([])).toEqual([]);
  });
});
