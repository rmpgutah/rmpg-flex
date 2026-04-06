// ============================================================
// RMPG Flex — Time Utility Functions
// ============================================================
// Centralized timestamp generation to ensure consistent local-time
// storage across the entire system. All timestamps in the DB should
// be in the server's local timezone (set via TZ env var at startup).
//
// Timestamps are stored in ISO 8601 format with timezone offset so
// that client-side JavaScript interprets them correctly:
//   "2025-01-15T14:30:00-07:00"
// ============================================================

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Returns the current date/time as an ISO 8601 string with timezone offset.
 * Example: "2025-01-15T14:30:00-07:00"
 *
 * This format ensures `new Date(localNow())` on the client correctly
 * interprets the timezone, preventing the 6-hour offset bug that occurs
 * when timezone-naive strings are treated as UTC.
 */
export function localNow(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  // Calculate timezone offset: getTimezoneOffset() returns minutes WEST of UTC
  // (e.g., MST = 420, MDT = 360), so we negate for ISO format
  const offsetMin = d.getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const tzH = pad(Math.floor(absOffset / 60));
  const tzM = pad(absOffset % 60);

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${tzH}:${tzM}`;
}

/**
 * Returns today's date as "YYYY-MM-DD" in local timezone.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * SQLite expression for current local time.
 * Use this in raw SQL DEFAULT expressions.
 * Note: This produces timezone-naive strings in the DB; prefer localNow()
 * for INSERT/UPDATE operations where the timestamp is sent to clients.
 */
export const SQL_NOW = "datetime('now', 'localtime')";

/**
 * Returns the current local hour (0-23) in America/Denver timezone.
 * Use this instead of `new Date().getHours()` for timezone-safe shift detection.
 */
export function localHour(): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(new Date()), 10);
}

/**
 * Returns the current local day of week (0=Sunday, 6=Saturday) in America/Denver timezone.
 * Use this instead of `new Date().getDay()` for timezone-safe day matching.
 */
export function localDayOfWeek(): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
  });
  const day = fmt.format(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[day] ?? new Date().getDay();
}
