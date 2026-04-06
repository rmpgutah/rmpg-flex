// ============================================================
// RMPG Flex — Time Utility Functions
// ============================================================
// ALL timestamps are pinned to America/Denver (Mountain Time).
// This is MANDATORY for RMPG Flex — Rocky Mountain Protective Group
// operates exclusively in Salt Lake City, UT (Mountain Time zone).
//
// Uses Intl.DateTimeFormat to extract Mountain Time components
// directly, so output is correct regardless of the VPS OS timezone.
// ============================================================

const MOUNTAIN_TZ = 'America/Denver';
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Returns the current date/time as an ISO 8601 string pinned to Mountain Time.
 * Example (MST): "2026-03-17T22:43:00-07:00"
 * Example (MDT): "2026-06-15T14:30:00-06:00"
 *
 * Uses Intl.DateTimeFormat with America/Denver — immune to OS TZ setting.
 * All INSERT/UPDATE operations in the database should use this function.
 */
export function localNow(): string {
  const now = new Date();

  // Extract Mountain Time components via Intl
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';

  const yyyy = get('year');
  const mm   = get('month');
  const dd   = get('day');
  const hh   = get('hour') === '24' ? '00' : get('hour'); // midnight edge case
  const mi   = get('minute');
  const ss   = get('second');

  // Determine UTC offset for this exact moment in Mountain Time
  const tzFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    timeZoneName: 'shortOffset',
  });
  const tzParts = tzFmt.formatToParts(now);
  const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-7';
  // tzName is "GMT-7" (MST) or "GMT-6" (MDT)
  const match = tzName.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  let offset = '-07:00'; // default MST
  if (match) {
    const h = parseInt(match[1], 10);
    const sign = h < 0 ? '-' : '+';
    offset = `${sign}${pad(Math.abs(h))}:${pad(match[2] ? parseInt(match[2], 10) : 0)}`;
  }

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${offset}`;
}

/**
 * Returns today's date as "YYYY-MM-DD" in Mountain Time.
 */
export function localToday(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * SQLite expression for current local time.
 * Note: SQLite datetime('now','localtime') uses the process TZ (America/Denver
 * per the mandatory process.env.TZ setting in index.ts). Prefer localNow()
 * for INSERT/UPDATE operations where the timestamp is sent to clients.
 */
export const SQL_NOW = "datetime('now', 'localtime')";
