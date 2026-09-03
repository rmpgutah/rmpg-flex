// ============================================================
// Process-server stop timing: dwell ranges + next-attempt windows
// ============================================================
// Onsite time is knock + paperwork + attempt log, not knock-only.
// Old 10–20 min caps systematically under-planned real PSO visits (30–45+ min
// on scene) and jammed the rest of the day's route. Learned averages from
// serve_dwell_times are clamped into these ranges so outliers (forgotten app)
// cannot blow a shift, but a real 35-minute apartment visit is plannable.
//
// Visit windows come from, in order:
//   1. serve_attempt_schedules next slot (logged after a failed attempt)
//   2. queue time_window (named band or HH:MM-HH:MM)
//   3. last attempt's hour → rotate to the next diligence band
// ============================================================

export type DefendantType = 'individual' | 'apartment' | 'business';

export interface ServeHhMmWindow {
  start: string; // HH:MM
  end: string;
  source: 'schedule' | 'time_window' | 'last_attempt';
}

export const DWELL_RANGE_S: Record<DefendantType, { min: number; max: number; default: number }> = {
  individual: { min: 8 * 60, max: 40 * 60, default: 18 * 60 },
  apartment: { min: 10 * 60, max: 45 * 60, default: 20 * 60 },
  business: { min: 12 * 60, max: 45 * 60, default: 22 * 60 },
};

export function clampDwellSeconds(type: DefendantType, learnedSeconds?: number | null): number {
  const range = DWELL_RANGE_S[type] ?? DWELL_RANGE_S.individual;
  if (learnedSeconds == null || !Number.isFinite(learnedSeconds)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(learnedSeconds)));
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function padHhMm(raw: string): string | null {
  const m = HHMM.exec(raw.trim());
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

/** Parse "18:00-21:00", "18:00–21:00", or "18:00 to 21:00". */
export function parseHhMmRange(raw: string | null | undefined): { start: string; end: string } | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+to\s+/i, '-').replace(/[–—]/g, '-');
  const m = cleaned.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const start = padHhMm(m[1]);
  const end = padHhMm(m[2]);
  if (!start || !end) return null;
  return { start, end };
}

export function namedBandToRange(tw: string | null | undefined): { start: string; end: string } | null {
  switch ((tw || '').trim().toLowerCase()) {
    case 'morning': return { start: '06:00', end: '12:00' };
    case 'afternoon': return { start: '12:00', end: '17:00' };
    case 'evening': return { start: '17:00', end: '21:00' };
    default: return null;
  }
}

function denverHour(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(ms)));
  return Number.isFinite(hour) ? hour : null;
}

function denverYmd(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** After a no-answer, rotate time-of-day. Afternoon fail → 18:00–21:00 same date. */
export function nextBandAfterAttempt(attemptAtIso: string, routeDate: string): { start: string; end: string } | null {
  const hour = denverHour(attemptAtIso);
  if (hour == null) return { start: '18:00', end: '21:00' };
  const ymd = denverYmd(attemptAtIso);
  if (hour < 12) return { start: '12:00', end: '17:00' };
  if (hour < 17) return { start: '18:00', end: '21:00' };
  // Evening fail: morning next calendar day. If the officer is still planning
  // the failed day, keep them out of the front of the run (window already closed).
  if (ymd && ymd === routeDate) return { start: '18:00', end: '21:00' };
  return { start: '08:00', end: '12:00' };
}

export function resolveServeWindow(input: {
  routeDate: string;
  nextAttemptDate?: string | null;
  nextAttemptWindow?: string | null;
  timeWindow?: string | null;
  lastAttemptAt?: string | null;
}): ServeHhMmWindow | null {
  const scheduled = parseHhMmRange(input.nextAttemptWindow);
  if (scheduled && (!input.nextAttemptDate || input.nextAttemptDate <= input.routeDate)) {
    return { ...scheduled, source: 'schedule' };
  }

  const named = namedBandToRange(input.timeWindow);
  if (named) return { ...named, source: 'time_window' };
  const explicit = parseHhMmRange(input.timeWindow);
  if (explicit) return { ...explicit, source: 'time_window' };

  if (input.lastAttemptAt) {
    const rotated = nextBandAfterAttempt(input.lastAttemptAt, input.routeDate);
    if (rotated) return { ...rotated, source: 'last_attempt' };
  }
  return null;
}

export function formatWindowLabel(win: ServeHhMmWindow | null, fallback?: string | null): string {
  if (win) return `${win.start}–${win.end}`;
  return fallback || 'anytime';
}
