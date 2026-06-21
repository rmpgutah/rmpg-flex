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
  constrained?: boolean;      // true when a location note shaped this window
}

// Options passed in from commitIntake once entity type + location note are known.
export interface PlanOptions {
  isBusiness?: boolean;
  locationNote?: {
    days_available?: number[] | null;
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Mon–Fri (0=Sun)

function localParts(d: Date, tz: string): { date: string; weekday: string; dowNum: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  const dowNum = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { date, weekday: wd, dowNum };
}

// Whole days from now until end-of-day on the deadline (date-only ISO).
export function daysUntilDeadline(nowIso: string, deadline: string | null): number | null {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const end = Date.parse(`${deadline}T23:59:59`);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - Date.parse(nowIso)) / DAY_MS);
}

// Next day offset from `now` that falls on an allowed day of week.
// minOffset ensures we don't collide with a previous attempt.
function nextAllowedDay(now: Date, minOffset: number, allowed: Set<number>, tz: string): number {
  let offset = minOffset;
  for (let guard = 0; guard < 14; guard++, offset++) {
    const d = new Date(now.getTime() + offset * DAY_MS);
    if (allowed.has(localParts(d, tz).dowNum)) return offset;
  }
  return minOffset;
}

// Next Saturday at least `minOffset` days out.
function nextSaturday(now: Date, minOffset: number, tz: string): number {
  let offset = minOffset;
  for (let guard = 0; guard < 14; guard++, offset++) {
    if (localParts(new Date(now.getTime() + offset * DAY_MS), tz).dowNum === 6) return offset;
  }
  return minOffset;
}

export function planAttemptWindows(
  nowIso: string,
  deadline: string | null,
  tz = 'America/Denver',
  options: PlanOptions = {},
): AttemptWindow[] {
  const now = new Date(nowIso);
  const days = daysUntilDeadline(nowIso, deadline);
  const tight = days !== null && days <= 4;
  const { isBusiness = false, locationNote } = options;

  // ── Resolve allowed days ──────────────────────────────────
  let allowedDows: Set<number>;
  if (locationNote?.days_available && locationNote.days_available.length) {
    allowedDows = new Set(locationNote.days_available);
  } else if (isBusiness) {
    allowedDows = WEEKDAYS; // businesses are weekday-only by default
  } else {
    allowedDows = new Set([0, 1, 2, 3, 4, 5, 6]); // residential = any day
  }

  const constrained = !!(locationNote?.hours_start || locationNote?.cutoff_time || locationNote?.days_available);

  // ── Resolve attempt window strings ────────────────────────
  // Priority: location note > entity-type defaults
  type SlotSpec = { offset: number | 'next-sat' | 'next-weekday'; window: string; focus: string };

  let slots: SlotSpec[];

  if (locationNote?.hours_start) {
    // Note-defined hours: build two windows within the allowed band.
    const start = locationNote.hours_start;           // e.g. "08:00"
    const end = locationNote.cutoff_time
      || locationNote.hours_end
      || '17:00';                                     // fall back to end-of-standard-day

    // Mid-morning: 30 min after open
    const [sh, sm] = start.split(':').map(Number);
    const midMornH = sh;
    const midMornEnd = `${String(Math.min(sh + 2, Number(end.split(':')[0]))).padStart(2, '0')}:00`;
    const midMornStart = `${String(midMornH).padStart(2, '0')}:${String(sm + 30 < 60 ? sm + 30 : 0).padStart(2, '0')}`;
    const midMornWin = `${midMornStart}–${midMornEnd}`;

    // Mid-afternoon: 1.5 h before cutoff/close
    const [eh, em] = end.split(':').map(Number);
    const aftEndH = eh;
    const aftEndM = em;
    const aftStartTotalMin = (aftEndH * 60 + aftEndM) - 90;
    const aftStartH = Math.max(sh, Math.floor(aftStartTotalMin / 60));
    const aftStartM = aftStartTotalMin % 60;
    const aftWin = `${String(aftStartH).padStart(2, '0')}:${String(aftStartM < 0 ? 0 : aftStartM).padStart(2, '0')}–${end}`;

    slots = tight
      ? [
          { offset: 'next-weekday', window: midMornWin, focus: `per site: attempt within noted hours (${start}–${end})` },
          { offset: 'next-weekday', window: aftWin, focus: 'afternoon window — vary time-of-day' },
          { offset: 'next-weekday', window: midMornWin, focus: 'third attempt — front-load before deadline' },
        ]
      : [
          { offset: 'next-weekday', window: midMornWin, focus: `per site: attempt within noted hours (${start}–${end})` },
          { offset: 'next-weekday', window: aftWin, focus: 'afternoon window — vary time-of-day' },
          { offset: 'next-weekday', window: midMornWin, focus: 'third attempt — per site constraints observed' },
        ];

  } else if (isBusiness) {
    // Business defaults — no note but we know it's corporate service.
    slots = tight
      ? [
          { offset: 'next-weekday', window: '09:30–11:30', focus: 'mid-morning — arrive after opening rush' },
          { offset: 'next-weekday', window: '13:30–15:30', focus: 'early afternoon — before end-of-day cutoff' },
          { offset: 'next-weekday', window: '09:30–11:30', focus: 'third attempt — confirm entity still at address' },
        ]
      : [
          { offset: 'next-weekday', window: '09:30–11:30', focus: 'mid-morning — arrive after opening rush, registered-agent hours' },
          { offset: 'next-weekday', window: '13:30–15:30', focus: 'early afternoon — avoid lunch gap, before end-of-day cutoff' },
          { offset: 'next-weekday', window: '09:30–11:30', focus: 'third attempt — verify current registered agent before tendering' },
        ];

  } else {
    // Residential defaults — standard diligence pattern.
    slots = tight
      ? [
          { offset: 0, window: '17:00–20:30', focus: 'evening — highest residential hit rate' },
          { offset: 1, window: '07:00–09:00', focus: 'early morning — catch before work departure' },
          { offset: 2, window: '11:00–14:00', focus: 'midday — vary the pattern' },
        ]
      : [
          { offset: 1, window: '17:00–20:30', focus: 'evening — highest residential hit rate' },
          { offset: 2, window: '07:00–09:00', focus: 'early morning — catch before work departure' },
          { offset: 'next-sat', window: '10:00–14:00', focus: 'weekend midday — peak residential hit rate Sat 08:00–10:00' },
        ];
  }

  // ── Resolve offsets to concrete dates ────────────────────
  const result: AttemptWindow[] = [];
  let lastOffset = -1;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    let offset: number;

    if (slot.offset === 'next-sat') {
      offset = nextSaturday(now, Math.max(3, lastOffset + 1), tz);
    } else if (slot.offset === 'next-weekday') {
      offset = nextAllowedDay(now, Math.max(lastOffset + 1, i === 0 ? 1 : lastOffset + 2), allowedDows, tz);
    } else {
      offset = slot.offset;
    }

    // Clamp to deadline.
    if (days !== null && offset > days) offset = Math.max(0, days);

    const { date, weekday } = localParts(new Date(now.getTime() + offset * DAY_MS), tz);
    result.push({ attempt: i + 1, date, weekday, window: slot.window, focus: slot.focus, constrained });
    lastOffset = offset;
  }

  return result;
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

// ── Geographic clustering ──────────────────────────────────────
// Stable cluster id for grouping nearby attempts on the same officer's day.
// 3-decimal lat/lng truncation = ~110 m cell — same building shares; different
// ZIPs do not. Falls back to ZIP5 when lat/lng is missing.
// IMPORTANT: uses Math.trunc(x * 1000) / 1000, NOT toFixed(3), because
// toFixed rounds, which would split adjacent buildings between two cells.
// Format: `g-{lat3}-{lng3}`. For US coordinates (always negative lng) the
// template dash + negative sign render as `--` in the output, giving a
// stable two-character delimiter.
export function clusterByProximity(
  lat: number | null,
  lng: number | null,
  zip: string | null,
): string | null {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const lat3 = (Math.trunc(lat * 1000) / 1000).toFixed(3);
    const lng3 = (Math.trunc(lng * 1000) / 1000).toFixed(3);
    return `g-${lat3}-${lng3}`;
  }
  if (zip && /^\d{5}/.test(zip)) {
    return `z-${zip.slice(0, 5)}`;
  }
  return null;
}
