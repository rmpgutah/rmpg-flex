// ============================================================
// RMPG Flex — Date/Time Utility Functions
// ============================================================
// ALL display formatting is pinned to America/Denver (Mountain Time).
// MANDATORY for RMPG Flex — Rocky Mountain Protective Group operates
// exclusively in Salt Lake City, UT. Officer device timezone is ignored.
// ============================================================

const MOUNTAIN_TZ = 'America/Denver';
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Returns today's date as "YYYY-MM-DD" in Mountain Time.
 * Avoids browser-timezone drift near midnight.
 */
export function localToday(): string {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Convert a Date to "YYYY-MM-DD" in Mountain Time.
 */
export function dateToLocalYMD(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Parse a server timestamp string into a Date object.
 *
 * New timestamps from the server are ISO 8601 with Mountain Time offset:
 *   "2026-03-17T22:43:00-07:00"
 *
 * Legacy timestamps stored in the DB lack timezone info:
 *   "2025-01-15 14:30:00"
 *
 * Legacy strings are assumed to be Mountain Time and are corrected by
 * appending the correct MST/MDT offset for that date.
 */
export function parseTimestamp(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();

  // Already has timezone info (ISO 8601 with + / - / Z) — parse directly
  if (dateStr.includes('T') && (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr))) {
    return new Date(dateStr);
  }

  // Legacy format: "YYYY-MM-DD HH:MM:SS" — assume Mountain Time
  if (dateStr.includes(' ') && !dateStr.includes('T')) {
    const naive = new Date(dateStr.replace(' ', 'T') + 'Z'); // parse as UTC to get a Date
    // Determine the Mountain Time offset for this specific date (handles MST/MDT)
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: MOUNTAIN_TZ,
        timeZoneName: 'shortOffset',
      });
      const parts = fmt.formatToParts(naive);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart?.value) {
        const match = tzPart.value.match(/(?:GMT|UTC)([+-]\d{1,2})(?::(\d{2}))?/);
        if (match) {
          const h = parseInt(match[1], 10);
          const mins = match[2] ? parseInt(match[2], 10) : 0;
          const sign = h < 0 ? '-' : '+';
          const absH = pad2(Math.abs(h));
          const absM = pad2(mins);
          return new Date(dateStr.replace(' ', 'T') + `${sign}${absH}:${absM}`);
        }
      }
    } catch { /* fallback */ }
    return new Date(dateStr.replace(' ', 'T') + '-07:00'); // fallback: MST
  }

  return new Date(dateStr);
}

// ── Mountain Time Intl formatters (reused across helpers) ────────────────────

const MTN_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  hour: '2-digit', minute: '2-digit',
  hour12: false,
});

const MTN_TIME_12H_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  hour: 'numeric', minute: '2-digit',
  hour12: true,
});

const MTN_DATETIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

const MTN_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

const MTN_DATE_LONG_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  month: 'short', day: 'numeric', year: 'numeric',
});

const MTN_DATE_SHORT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ,
  month: 'short', day: 'numeric',
});

/**
 * Format a server timestamp as HH:MM (24-hour, Mountain Time).
 */
export function formatShortTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return MTN_TIME_FMT.format(d);
}

/**
 * Format a server timestamp as 12-hour time with AM/PM (Mountain Time).
 * Example: "10:43 PM"
 */
export function formatShortTime12h(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return MTN_TIME_12H_FMT.format(d);
}

/**
 * Format a server timestamp as MM/DD/YYYY HH:MM:SS (24h, Mountain Time).
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  const parts = MTN_DATETIME_FMT.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Format as MM/DD/YYYY (Mountain Time date only).
 */
export function formatDate(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  const parts = MTN_DATE_FMT.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('month')}/${get('day')}/${get('year')}`;
}

/**
 * Format as "Feb 26, 2026" (Mountain Time).
 */
export function formatDateLong(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return MTN_DATE_LONG_FMT.format(d);
}

/**
 * Format as relative time ("2 hours ago"), falling back to "Feb 26" for old dates.
 * All comparisons are in Mountain Time.
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return MTN_DATE_SHORT_FMT.format(d);
}
