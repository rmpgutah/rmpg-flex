/**
 * Pure aggregation utilities for the Business dossier endpoint.
 *
 * No DB access, no Express imports — deterministic transformations only.
 * All time-of-day / day-of-week math runs in America/Denver (Mountain Time)
 * via Luxon, which handles DST transitions correctly.
 */
import { DateTime } from 'luxon';

const TZ = 'America/Denver';

/**
 * Day-of-week keys used in the hours JSON.
 * Index 0 corresponds to Monday so the array lines up with Luxon's
 * `weekday` value (1=Monday … 7=Sunday) via `(weekday - 1) % 7`.
 */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface DayHours {
  open: string;  // 'HH:MM' 24h
  close: string; // 'HH:MM' 24h
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Returns true if `now` falls inside the open-close window for the
 * business's hours JSON, in America/Denver. Cross-midnight windows
 * (close < open) are handled by also consulting the previous day's
 * hours. Holidays in `holidaysJson` (array of YYYY-MM-DD strings)
 * force a false return regardless of hours.
 */
export function computeIsCurrentlyOpen(
  hoursJson: string | null | undefined,
  now: Date = new Date(),
  holidaysJson: string | null | undefined = null,
): boolean {
  if (!hoursJson) return false;

  let hours: Record<string, DayHours>;
  try {
    hours = JSON.parse(hoursJson);
  } catch {
    return false;
  }
  if (!hours || typeof hours !== 'object') return false;

  const dt = DateTime.fromJSDate(now).setZone(TZ);
  if (!dt.isValid) return false;

  // Holiday short-circuit
  if (holidaysJson) {
    try {
      const holidays: string[] = JSON.parse(holidaysJson);
      const today = dt.toISODate();
      if (Array.isArray(holidays) && today && holidays.includes(today)) {
        return false;
      }
    } catch {
      // ignore malformed holidays
    }
  }

  const dayIdx = (dt.weekday - 1) % 7; // 0=Mon … 6=Sun
  const todayKey = DAY_KEYS[dayIdx];
  const todaysHours = hours[todayKey];
  const currentMin = dt.hour * 60 + dt.minute;

  if (todaysHours && todaysHours.open && todaysHours.close) {
    const openMin = parseHHMM(todaysHours.open);
    const closeMin = parseHHMM(todaysHours.close);
    if (closeMin < openMin) {
      // Cross-midnight: open from openMin today through closeMin tomorrow.
      // If we're past openMin today, we're open. If we're before closeMin
      // today, that's covered by yesterday's window (handled below).
      if (currentMin >= openMin) return true;
    } else if (currentMin >= openMin && currentMin <= closeMin) {
      return true;
    }
  }

  // Check yesterday's cross-midnight window (e.g. bar Fri 18:00-02:00,
  // querying Sat 01:30 — yesterday's window covers it).
  const yesterdayIdx = (dt.weekday - 2 + 7) % 7;
  const yesterdayKey = DAY_KEYS[yesterdayIdx];
  const yHours = hours[yesterdayKey];
  if (yHours && yHours.open && yHours.close) {
    const yOpen = parseHHMM(yHours.open);
    const yClose = parseHHMM(yHours.close);
    if (yClose < yOpen && currentMin <= yClose) {
      return true;
    }
  }

  return false;
}

/**
 * Computes a 7×6 heatmap: matrix[day_of_week][hour_bucket].
 *  - day 0 = Monday, day 6 = Sunday
 *  - bucket size 4 hours; bucket 0 = 00:00–03:59, … bucket 5 = 20:00–23:59
 * Always returns a fully-shaped 7×6 matrix even for empty input.
 */
export function computeHeatmap(
  events: Array<{ occurred_at: string }>,
): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]);
  for (const e of events) {
    if (!e || !e.occurred_at) continue;
    const dt = DateTime.fromISO(e.occurred_at, { zone: TZ });
    if (!dt.isValid) continue;
    const day = (dt.weekday - 1) % 7;
    const bucket = Math.min(5, Math.max(0, Math.floor(dt.hour / 4)));
    matrix[day][bucket]++;
  }
  return matrix;
}

/**
 * Computes period-over-period trend.
 *  - pct_change: integer percent change in event count (recent vs prior).
 *    Special-cases divide-by-zero: 0/0 → 0, n/0 → 100.
 *  - week_buckets: length-4 array of recent-event counts grouped by week.
 *    week_buckets[3] is the most recent 7 days; [0] is days 22–28.
 *    Events older than 28 days from now() are dropped.
 */
export function computeTrend(
  recent: Array<{ occurred_at: string }>,
  prior: Array<{ occurred_at: string }>,
): { pct_change: number; week_buckets: number[] } {
  const recentCount = recent.length;
  const priorCount = prior.length;

  let pct_change: number;
  if (priorCount === 0) {
    pct_change = recentCount === 0 ? 0 : 100;
  } else {
    pct_change = Math.round(((recentCount - priorCount) / priorCount) * 100);
  }

  const week_buckets = [0, 0, 0, 0];
  const now = DateTime.now();
  for (const e of recent) {
    if (!e || !e.occurred_at) continue;
    const dt = DateTime.fromISO(e.occurred_at);
    if (!dt.isValid) continue;
    const days = now.diff(dt, 'days').days;
    if (days < 0 || days >= 28) continue;
    const weeksAgo = Math.floor(days / 7); // 0..3
    week_buckets[3 - weeksAgo]++;
  }

  return { pct_change, week_buckets };
}

interface LinkedPersonRisk {
  active_warrant_count?: number;
  is_sex_offender?: boolean | number;
  flags?: string;
}

/**
 * Heuristic risk score for a business based on linked persons and
 * recent incident count. Higher = more attention warranted.
 *  - +5 per incident in last 30 days, capped at 30
 *  - +15 per linked person with an active warrant
 *  - +10 per linked person flagged as sex offender
 *  - +12 per linked person whose flags string contains 'VIOLENT'
 *
 * Levels: <15 low, 15–39 moderate, 40–69 high, ≥70 critical.
 */
export function computeRiskScore(
  _business: any,
  linkedPersons: LinkedPersonRisk[],
  incidentCount30d: number,
): { score: number; level: 'low' | 'moderate' | 'high' | 'critical' } {
  let score = 0;
  score += Math.min((incidentCount30d || 0) * 5, 30);
  for (const p of linkedPersons || []) {
    if (!p) continue;
    if ((p.active_warrant_count || 0) > 0) score += 15;
    if (p.is_sex_offender) score += 10;
    if (typeof p.flags === 'string' && p.flags.includes('VIOLENT')) score += 12;
  }

  let level: 'low' | 'moderate' | 'high' | 'critical';
  if (score >= 70) level = 'critical';
  else if (score >= 40) level = 'high';
  else if (score >= 15) level = 'moderate';
  else level = 'low';

  return { score, level };
}
