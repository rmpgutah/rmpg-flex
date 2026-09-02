// ============================================================
// RMPG Flex — Date/Time Utility Functions
// ============================================================
// Handles parsing of server timestamps, including backward
// compatibility with legacy timezone-naive strings.
// ============================================================

const pad2 = (n: number) => String(n).padStart(2, '0');

// ── Display timezone (default Mountain, optional device) ────
// By default every displayed date/time is Mountain Time, DST-aware, regardless
// of the viewer's device (see timeZoneMode.ts; users can switch to 'device'
// mode). Storage stays UTC. The global shim pins toLocale* output to the chosen
// zone; the helpers below cover the formatters that read Date getters directly
// (getHours/getDate/...), which the shim can't touch, plus the wall-clock→UTC
// conversion for time edits. All resolve the zone via displayTimeZone():
// an IANA zone (e.g. America/Denver) or undefined = the device's local zone.
import { displayTimeZone } from './timeZoneMode';
import { getSystemSetting, getBoolSetting } from './systemSettings';
export { MOUNTAIN_TIME_ZONE, getTimeZoneMode, setTimeZoneMode } from './timeZoneMode';

interface ZoneParts { year: number; month: number; day: number; hour: number; minute: number; second: number; }

const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Setting-aware part formatters ───────────────────────────
// Honour Console Settings → Display (date_format / time_format) +
// Localization (time_format_seconds). Defaults reproduce the previous
// hardcoded MM/DD/YYYY + 24h behaviour, so unconfigured installs are
// byte-identical to before.
function formatDateParts(p: ZoneParts): string {
  const MM = pad2(p.month), DD = pad2(p.day), YYYY = String(p.year);
  switch (getSystemSetting('date_format', 'MM/DD/YYYY')) {
    case 'DD/MM/YYYY': return `${DD}/${MM}/${YYYY}`;
    case 'YYYY-MM-DD': return `${YYYY}-${MM}-${DD}`;
    case 'DD-MMM-YYYY': return `${DD}-${MONTHS_ABBR[p.month - 1]}-${YYYY}`;
    default: return `${MM}/${DD}/${YYYY}`;
  }
}

function formatTimeParts(p: ZoneParts, withSeconds: boolean): string {
  if (getSystemSetting('time_format', '24h') === '12h') {
    let h = p.hour % 12; if (h === 0) h = 12;
    const ampm = p.hour < 12 ? 'AM' : 'PM';
    return withSeconds
      ? `${h}:${pad2(p.minute)}:${pad2(p.second)} ${ampm}`
      : `${h}:${pad2(p.minute)} ${ampm}`;
  }
  return withSeconds
    ? `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
    : `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Wall-clock components of an instant in the active display zone (DST-aware). */
function zoneParts(d: Date): ZoneParts {
  if (!d || isNaN(d.getTime())) {
    return { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  }
  const tz = displayTimeZone();
  if (!tz) {
    // Device mode — read the device's local wall-clock directly.
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
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

/** Display-zone offset from UTC (ms) at the given instant: zone_wall − UTC. */
function zoneOffsetMs(d: Date): number {
  if (!displayTimeZone()) return -d.getTimezoneOffset() * 60000; // device offset
  const p = zoneParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - d.getTime();
}

/**
 * Returns today's date as "YYYY-MM-DD" in the browser's local timezone.
 * Avoids the `.toISOString().split('T')[0]` pattern which uses UTC and
 * produces incorrect dates near midnight in non-UTC timezones.
 */
export function localToday(): string {
  const p = zoneParts(new Date());
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Convert a Date to "YYYY-MM-DD" in Mountain Time (not the device zone, not UTC).
 */
export function dateToLocalYMD(d: Date): string {
  const p = zoneParts(d);
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
  return formatTimeParts(zoneParts(d), getBoolSetting('time_format_seconds', false));
}

/**
 * Format a server timestamp for display as date + time in the active
 * display zone. Layout follows Console Settings → Display (date_format /
 * time_format); defaults to MM/DD/YYYY HH:MM:SS (24h).
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  const p = zoneParts(d);
  return `${formatDateParts(p)} ${formatTimeParts(p, true)}`;
}

/**
 * Format a server timestamp as date only, in the active display zone.
 * Layout follows Console Settings → Display (date_format).
 */
export function formatDate(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '';
  return formatDateParts(zoneParts(d));
}

/**
 * Format a server timestamp for display as date only (e.g., "Feb 26, 2026"), Mountain Time.
 */
export function formatDateLong(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: displayTimeZone() });
}

// ── Safe formatting for inline JSX (returns '—' for null/invalid) ───

/** Safe locale date string — replaces `new Date(x).toLocaleDateString()` */
export function safeDateStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: displayTimeZone() });
}

/** Safe locale date+time string — replaces `new Date(x).toLocaleString()` */
export function safeDateTimeStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: displayTimeZone() });
}

/** Safe locale time string — replaces `new Date(x).toLocaleTimeString()` */
export function safeTimeStr(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const d = parseTimestamp(value);
  return isNaN(d.getTime()) ? fallback : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: displayTimeZone() });
}

/**
 * Display a clock-time (HH:MM) string for a time_entries timestamp pair.
 *
 * `local` is the Denver wall-clock string written by nowDualStamp() — no
 * offset, already in the operator's zone, so we just format the HH:MM
 * portion as-is. `utc` is the canonical ISO string and the fallback when
 * `local` is absent (historical rows pre-backfill, or admin paths that
 * don't dual-stamp). When falling back to UTC we MUST pass timeZone so the
 * Intl format converts UTC → Denver rather than using device-local.
 *
 * Returns '-' when both inputs are null/undefined or unparseable.
 */
export function displayClockTime(
  local: string | null | undefined,
  utc: string | null | undefined,
  fallback = '-',
): string {
  // Local-only — render the HH:MM portion of the wall-clock string verbatim.
  if (local) {
    // Format: 'YYYY-MM-DDTHH:MM:SS' (no offset). Extract HH:MM directly so we
    // don't round-trip through Date and risk a zone re-interpretation.
    const m = /T(\d{2}):(\d{2})/.exec(local);
    if (m) return `${m[1]}:${m[2]}`;
  }
  // UTC fallback — explicitly format in the display zone.
  if (utc) {
    const d = parseTimestamp(utc);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: displayTimeZone(),
      });
    }
  }
  return fallback;
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: displayTimeZone() });
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
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: displayTimeZone() })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: displayTimeZone() })}`;
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
  const p = zoneParts(d);
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
  const utc = new Date(provisional.getTime() - zoneOffsetMs(provisional));
  return utc.toISOString().replace('T', ' ').slice(0, 19);
}
