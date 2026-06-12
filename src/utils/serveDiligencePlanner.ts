// ============================================================
// RMPG Flex — Serve Intake diligence planner
// ============================================================
// Turns the diligence doctrine (vary time-of-day, include a weekend,
// front-load against the deadline) into a concrete dated attempt plan
// at intake time. Pure functions of (nowIso, deadline) — no Date.now()
// inside — so a plan is reproducible for any audit of why an attempt
// was recommended on a given day.
//
// Consumers (commitIntake):
//   • RECOMMENDED ATTEMPT PLAN section of the INTAKE briefing note
//   • serve_queue.parsed_data._intake.attempt_plan (machine-readable)
//   • /upload response → success-card plan table
// ============================================================

import type { ServePriority } from './serveIntakeExtract';

export interface AttemptWindow {
  attempt: number;            // 1-based
  date: string;               // YYYY-MM-DD (America/Denver)
  weekday: string;            // 'Mon'..'Sun'
  window: string;             // '17:00–20:30'
  focus: string;              // why this window
}

const DAY_MS = 86_400_000;

function localParts(d: Date, tz: string): { date: string; weekday: string } {
  // en-CA gives ISO YYYY-MM-DD directly.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return { date, weekday };
}

// Whole days from now until end-of-day on the deadline (date-only ISO).
// null when there is no deadline. Negative when already past.
export function daysUntilDeadline(nowIso: string, deadline: string | null): number | null {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const end = Date.parse(`${deadline}T23:59:59`);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - Date.parse(nowIso)) / DAY_MS);
}

// Three staggered attempt windows. Normal cadence: tomorrow evening,
// +2 days early morning, then the next Saturday midday (weekend attempt).
// With a deadline inside 4 days the plan compresses to daily attempts
// starting today; every window is clamped to land on or before the
// deadline so the plan never recommends a dead attempt.
export function planAttemptWindows(
  nowIso: string,
  deadline: string | null,
  tz = 'America/Denver',
): AttemptWindow[] {
  const now = new Date(nowIso);
  const days = daysUntilDeadline(nowIso, deadline);
  const tight = days !== null && days <= 4;

  const slots: Array<{ offset: number | 'next-sat'; window: string; focus: string }> = tight
    ? [
        { offset: 0, window: '17:00–20:30', focus: 'evening — highest residential hit rate' },
        { offset: 1, window: '07:00–09:00', focus: 'early morning — catch before work departure' },
        { offset: 2, window: '11:00–14:00', focus: 'midday — vary the pattern' },
      ]
    : [
        { offset: 1, window: '17:00–20:30', focus: 'evening — highest residential hit rate' },
        { offset: 2, window: '07:00–09:00', focus: 'early morning — catch before work departure' },
        { offset: 'next-sat', window: '10:00–14:00', focus: 'weekend midday' },
      ];

  return slots.map((slot, i) => {
    let offset: number;
    if (slot.offset === 'next-sat') {
      // First Saturday at least 3 days out (so it never collides with
      // attempt 2); cap the search defensively.
      offset = 3;
      while (localParts(new Date(now.getTime() + offset * DAY_MS), tz).weekday !== 'Sat' && offset < 10) offset++;
    } else {
      offset = slot.offset;
    }
    // Clamp to the deadline — an attempt after it is worthless.
    if (days !== null && offset > days) offset = Math.max(0, days);
    const { date, weekday } = localParts(new Date(now.getTime() + offset * DAY_MS), tz);
    return { attempt: i + 1, date, weekday, window: slot.window, focus: slot.focus };
  });
}

// Deadline-proximity escalation: ≤3 days → urgent, ≤7 days → rush.
// Only ever raises — a client-requested 'urgent' on a far deadline stays.
const PRIORITY_RANK: Record<ServePriority, number> = { routine: 0, normal: 1, rush: 2, urgent: 3 };

export function escalatePriorityForDeadline(
  priority: ServePriority,
  nowIso: string,
  deadline: string | null,
): ServePriority {
  const days = daysUntilDeadline(nowIso, deadline);
  if (days === null) return priority;
  const floor: ServePriority = days <= 3 ? 'urgent' : days <= 7 ? 'rush' : priority;
  return PRIORITY_RANK[floor] > PRIORITY_RANK[priority] ? floor : priority;
}
