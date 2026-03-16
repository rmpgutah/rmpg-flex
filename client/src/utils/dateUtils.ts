// ============================================================
// RMPG Flex — Date/Time Utility Functions
// ============================================================
// Handles parsing of server timestamps, including backward
// compatibility with legacy timezone-naive strings.
// ============================================================

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Returns today's date as "YYYY-MM-DD" in the browser's local timezone.
 * Avoids the `.toISOString().split('T')[0]` pattern which uses UTC and
 * produces incorrect dates near midnight in non-UTC timezones.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Convert a Date to "YYYY-MM-DD" in local timezone (not UTC).
 */
export function dateToLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
 * JavaScript's `new Date("2025-01-15 14:30:00")` treats timezone-naive
 * strings as UTC, causing times to display ~6–7 hours ahead of actual
 * Mountain Time. This helper detects legacy formats and appends the
 * Mountain Time offset so they're interpreted correctly.
 */
export function parseTimestamp(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();

  // Already has timezone info (T with + or -, or Z suffix) — parse directly
  if (dateStr.includes('T') && (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr))) {
    return new Date(dateStr);
  }

  // Legacy format: "YYYY-MM-DD HH:MM:SS" — assume Mountain Time
  // Determine the correct UTC offset for the given date (handles MST/MDT transitions)
  if (dateStr.includes(' ') && !dateStr.includes('T')) {
    const naive = new Date(dateStr.replace(' ', 'T'));
    // Use Intl to determine the Mountain Time offset for this specific date
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', timeZoneName: 'shortOffset' });
      const parts = fmt.formatToParts(naive);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      // tzPart.value is like "GMT-7", "GMT-6", "UTC-7", or "GMT+05:30"
      if (tzPart?.value) {
        const match = tzPart.value.match(/(?:GMT|UTC)([+-]\d{1,2})(?::(\d{2}))?/);
        if (match) {
          const offset = parseInt(match[1], 10);
          const minutes = match[2] ? parseInt(match[2], 10) : 0;
          const sign = offset <= 0 && minutes === 0 ? '-' : offset < 0 ? '-' : '+';
          const absH = String(Math.abs(offset)).padStart(2, '0');
          const absM = String(minutes).padStart(2, '0');
          return new Date(dateStr.replace(' ', 'T') + `${sign}${absH}:${absM}`);
        }
      }
    } catch { /* fallback below */ }
    return new Date(dateStr.replace(' ', 'T') + '-07:00');
  }

  // Date-only "YYYY-MM-DD" or other formats — let the browser handle it
  return new Date(dateStr);
}

/**
 * Format a server timestamp for display as a short time (HH:MM 24h).
 */
export function formatShortTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format a server timestamp for display as MM/DD/YYYY HH:MM:SS (24h).
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Format a server timestamp as MM/DD/YYYY only (no time).
 */
export function formatDate(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

/**
 * Format a server timestamp for display as date only (e.g., "Feb 26, 2026").
 */
export function formatDateLong(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a server timestamp as a relative date (e.g., "2 hours ago").
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  const d = parseTimestamp(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
