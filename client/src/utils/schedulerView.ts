// ============================================================
// RMPG Flex — ServeSchedulerPanel pure layout helpers
// ============================================================
// All functions are pure (no React, no DOM, no Date.now). The panel's
// dynamic state lives in component-local React state; these helpers
// just shape data for rendering.
//
// Band layout: the WeekTimeline panel renders 06:00–24:00 in 2-hour bands.
//   Row 1 = 06–08, Row 2 = 08–10, ..., Row 9 = 22–24.
//   Earlier hours snap to row 1; later hours clamp to row 9.
// ============================================================

export interface ScheduleSlot {
  id: number;
  queue_id: number;
  attempt_number: number;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  window_label: string | null;
  notify_at: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  case_number: string | null;
  priority: string;
  deadline: string | null;
  status: string;
  notified: number;
  dismissed: number;
  officer_id: number | null;
  manually_moved: number;
  auto_replan_source: number | null;
  urgency_tier: 'critical' | 'tight' | 'standard' | null;
}

// 7-day rolling window starting at `anchorYmd`. Returns N consecutive
// YYYY-MM-DD strings; handles month + year rollover via Date math.
export function dayRangeFromAnchor(anchorYmd: string, count: number): string[] {
  const [y, m, d] = anchorYmd.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i)); // new-date-ok: epoch from Date.UTC, not a server string
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

// Group by scheduled_date AND sort each day's slots by window_start.
export function groupByDay(slots: ScheduleSlot[]): Map<string, ScheduleSlot[]> {
  const map = new Map<string, ScheduleSlot[]>();
  for (const s of slots) {
    const arr = map.get(s.scheduled_date) ?? [];
    arr.push(s);
    map.set(s.scheduled_date, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.window_start.localeCompare(b.window_start));
  }
  return map;
}

// "Sun 21" — short weekday + day number, no leading zero on day.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // new-date-ok: epoch from Date.UTC, not a server string
  return `${WEEKDAYS[dt.getUTCDay()]} ${d}`;
}

// Map an HH:MM window to a 2-hour band row + row span.
// Row 1 = 06–08, row 9 = 22–24. Pre-dawn snaps to row 1; post-midnight clamps to row 9.
export function computeChipBand(
  windowStart: string,
  windowEnd: string,
): { rowStart: number; rowSpan: number } {
  const startH = parseInt(windowStart.split(':')[0], 10);
  const endH = parseInt(windowEnd.split(':')[0], 10);
  const endM = parseInt(windowEnd.split(':')[1] ?? '0', 10);

  const rowStart = Math.max(1, Math.min(9, Math.floor((startH - 6) / 2) + 1));
  // End row uses ceiling so a 20:30 end lands in row 8 (18–20 + spill into 20–22).
  const endBucket = Math.max(1, Math.min(9,
    Math.ceil((endH * 60 + endM - 6 * 60) / 120),
  ));
  const rowSpan = Math.max(1, endBucket - rowStart + 1);
  return { rowStart, rowSpan };
}
