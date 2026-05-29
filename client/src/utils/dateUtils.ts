// ============================================================
// RMPG Flex — Date/Time Utility Functions
// ============================================================
// Handles parsing of server timestamps, including backward
// compatibility with legacy timezone-naive strings.
// ============================================================

const pad2 = (n: number) => String(n).padStart(2, '0');

// ── Mandatory Mountain Time ─────────────────────────────────
// RMPG is a Utah operation: every displayed date/time is Mountain Time,
// DST-aware, regardless of the viewer's device. Storage stays UTC. The
// global shim in enforceMountainTime.ts pins all toLocale* output to MT;
// the helpers below cover the formatters that read Date getters directly
// (getHours/getDate/...), which the shim can't touch, plus the MT→UTC
// conversion needed when a user edits a wall-clock time.
export const APP_TIME_ZONE = 'America/Denver';

interface MtParts { year: number; month: number; day: number; hour: number; minute: number; second: number; }

/** Wall-clock components of an instant in Mountain Time (DST-aware). */
function mtParts(d: Date): MtParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some engines emit '24' for midnight under hour12:false
  return {
    year: parseInt(get('year'), 10), month: parseInt(get('month'), 10), day: parseInt(get('day'), 10),
    hour, minute: parseInt(get('minute'), 10), second: parseInt(get('second'), 10),
  };
}

/** Mountain Time offset from UTC (ms) at the given instant: MT_wall − UTC. */
function mtOffsetMs(d: Date): number {
  const p = mtParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - d.getTime();
}

/**
 * Returns today's date as "YYYY-MM-DD" in the browser's local timezone.
 * Avoids the `.toISOString().split('T')[0]` pattern which uses UTC and
 * produces incorrect dates near midnight in non-UTC timezones.
 */
export function localToday(): string {
  const p = mtParts(new Date());
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Convert a Date to "YYYY-MM-DD" in Mountain Time (not the device zone, not UTC).
 */
export function dateToLocalYMD(d: Date): string {
  const p = mtParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Parse a server timestamp string into a Date object.
 *
 * New timestamps from the server are ISO 8601 with timezone offset:
 *   "2025-01-15T14:30:00-07:00"
 *
 * Legacy timestamps stored in the DB lack timezone info:
 *   "2025-01-15 14:30:00"
 *
 * The server (Cloudflare Workers + D1) runs in UTC and writes
 * timezone-naive strings like "2025-01-15 14:30:00" that are actually
 * UTC wall-clock. We therefore interpret naive timestamps as UTC and
 * let the browser render them in the viewer's local zone (Mountain for
 * RMPG), which is DST-aware automatically — no fixed offset needed.
 *
 * (Pre-2026 this assumed Mountain Time, to compensate for the VPS era's
 * `datetime('now','-7 hours')` storage convention. That convention was
 * removed app-wide in the UTC-standardization change; all timestamps are
 * now UTC, so assuming UTC here is the correct + DST-safe interpretation.
 * A fixed -7h was also wrong half the year — MDT is UTC-6, not -7.)
 */
export function parseTimestamp(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();

  // Already has timezone info (T with + or -, or Z suffix) — parse directly
  if (dateStr.includes('T') && (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr))) {
    return new Date(dateStr);
  }

  // Naive "YYYY-MM-DD HH:MM:SS" — server stores these as UTC wall-clock.
  // Append 'Z' so JS parses as UTC; the browser then renders in the
  // viewer's local timezone (DST-aware).
  if (dateStr.includes(' ') && !dateStr.includes('T')) {
    return new Date(dateStr.replace(' ', 'T') + 'Z');
  }
  // Same for naive ISO without offset ("2025-01-15T14:30:00") — treat as UTC.
  if (dateStr.includes('T') && !dateStr.includes('Z') && !/[+-]\d{2}:?\d{2}$/.test(dateStr)
      && /\d{2}:\d{2}/.test(dateStr)) {
    return new Date(dateStr + 'Z');
  }

  // Date-only "YYYY-MM-DD" — append T00:00:00 to force LOCAL timezone parsing
  // Without this, `new Date('2026-03-28')` is parsed as UTC midnight, which
  // in Mountain Time (UTC-7) becomes 2026-03-27T17:00:00 — the PREVIOUS day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00');
  }

  // Other formats — let the browser handle it
  const result = new Date(dateStr);
  return isNaN(result.getTime()) ? new Date() : result;
}

/**
 * Format a server timestamp for display as a short time (HH:MM 24h).
 */
export function formatShortTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TIME_ZONE });
}

/**
 * Format a server timestamp for display as MM/DD/YYYY HH:MM:SS (24h), Mountain Time.
 * Uses MT wall-clock parts (not device-local getters).
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  const p = mtParts(d);
  return `${pad2(p.month)}/${pad2(p.day)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/**
 * Format a server timestamp as MM/DD/YYYY only (no time), Mountain Time.
 */
export function formatDate(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  const p = mtParts(d);
  return `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
}

/**
 * Format a server timestamp for display as date only (e.g., "Feb 26, 2026"), Mountain Time.
 */
export function formatDateLong(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: APP_TIME_ZONE });
}

// ── Safe formatting for inline JSX (returns '—' for null/invalid) ───

/** Safe locale date string — replaces `new Date(x).toLocaleDateString()` */
export function safeDateStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: APP_TIME_ZONE });
}

/** Safe locale date+time string — replaces `new Date(x).toLocaleString()` */
export function safeDateTimeStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: APP_TIME_ZONE });
}

/** Safe locale time string — replaces `new Date(x).toLocaleTimeString()` */
export function safeTimeStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: APP_TIME_ZONE });
}

/**
 * Format a server timestamp as a relative date (e.g., "2 hours ago").
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return 'just now'; // future date safety
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// Additional date utilities
// ============================================================

/**
 * Format a date range as a readable string: "Jan 15 - Feb 20, 2026"
 */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '';
  if (start && !end) return `${formatDateLong(start)} - Present`;
  if (!start && end) return `Until ${formatDateLong(end)}`;
  const s = parseTimestamp(start);
  const e = parseTimestamp(end);
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: APP_TIME_ZONE })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: APP_TIME_ZONE })}`;
  }
  return `${formatDateLong(start)} – ${formatDateLong(end)}`;
}

/**
 * Get the number of days between two dates.
 */
export function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = parseTimestamp(start);
  const e = parseTimestamp(end);
  const diff = e.getTime() - s.getTime();
  return Number.isFinite(diff) ? Math.round(diff / 86400000) : 0;
}

/**
 * Check if a date is within N days from now (useful for expiry warnings).
 */
export function isWithinDays(dateStr: string, days: number): boolean {
  if (!dateStr) return false;
  const d = parseTimestamp(dateStr);
  const now = new Date();
  const diffDays = (d.getTime() - now.getTime()) / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/**
 * Check if a date is in the past.
 */
export function isPast(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return parseTimestamp(dateStr).getTime() < Date.now();
}

/**
 * Get the start and end of today in Mountain Time (as naive wall-clock strings).
 */
export function todayRange(): { start: string; end: string } {
  const today = localToday(); // MT "YYYY-MM-DD"
  return { start: `${today}T00:00:00`, end: `${today}T23:59:59` };
}

/**
 * Format a stored (UTC) timestamp as a datetime-local input value in Mountain
 * Time ("YYYY-MM-DDTHH:MM"). The value a user sees/edits is MT wall-clock.
 * On save, convert it back with mtDatetimeLocalToUtc().
 */
export function toDatetimeLocalValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  const p = mtParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Convert a Mountain-Time wall-clock string from a datetime-local input
 * ("YYYY-MM-DDTHH:MM" or with seconds) into a naive UTC string
 * ("YYYY-MM-DD HH:MM:SS") suitable for storage. DST-aware: the MT→UTC offset
 * is resolved at the edited instant. Inverse of toDatetimeLocalValue().
 */
export function mtDatetimeLocalToUtc(localStr: string | null | undefined): string {
  if (!localStr) return '';
  const naive = localStr.length === 16 ? `${localStr}:00` : localStr; // ensure seconds
  // Provisional instant: treat the wall-clock as if it were UTC, then subtract
  // the actual Mountain Time offset at that instant to get the true UTC time.
  const provisional = new Date(`${naive}Z`);
  if (isNaN(provisional.getTime())) return '';
  const utc = new Date(provisional.getTime() - mtOffsetMs(provisional));
  return utc.toISOString().replace('T', ' ').slice(0, 19);
}
