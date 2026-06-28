// ============================================================
// RMPG Flex — Multi-officer swim-lane layout helpers (pure)
// ============================================================
// Used by ServeSchedulerPage to render slots split per officer per
// day. Unassigned slots (officer_id NULL) share lane key `0`.
// ============================================================

import type { ScheduleSlot } from './schedulerView';

export interface LaneAssignment {
  date: string;
  officer_id: number; // 0 = unassigned sentinel
  slots: ScheduleSlot[];
}

// Map<date, Map<officer_id (0 = unassigned), ScheduleSlot[]>> — slots within each
// lane are sorted by window_start.
export function groupByOfficerLane(
  slots: ScheduleSlot[],
): Map<string, Map<number, ScheduleSlot[]>> {
  const out = new Map<string, Map<number, ScheduleSlot[]>>();
  for (const s of slots) {
    const dayMap = out.get(s.scheduled_date) ?? new Map<number, ScheduleSlot[]>();
    const key = s.officer_id ?? 0;
    const arr = dayMap.get(key) ?? [];
    arr.push(s);
    dayMap.set(key, arr);
    out.set(s.scheduled_date, dayMap);
  }
  for (const dayMap of out.values()) {
    for (const arr of dayMap.values()) {
      arr.sort((a, b) => a.window_start.localeCompare(b.window_start));
    }
  }
  return out;
}

export type RangeMode = 'week' | 'two-week' | 'month';

const COUNTS: Record<RangeMode, number> = { week: 7, 'two-week': 14, month: 31 };

// Expand a (anchor, mode) pair into N consecutive YYYY-MM-DD strings.
// Month mode is fixed-31 — the page renders calendar boundaries on top.
export function extendRange(anchorYmd: string, mode: RangeMode): string[] {
  const [y, m, d] = anchorYmd.split('-').map(Number);
  const out: string[] = [];
  const count = COUNTS[mode];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i)); // new-date-ok: epoch from Date.UTC, not a server string
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}
