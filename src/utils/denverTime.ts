// ============================================================
// RMPG Flex — Denver wall-clock helpers
//
// Cloudflare Workers have no TZ environment, Date.getTimezoneOffset() returns
// 0, and SQLite's `datetime(..., 'localtime')` resolves to UTC. The ONLY
// DST-aware path is Intl.DateTimeFormat carrying IANA zone data. These
// helpers wrap that so every write path that needs a "what the operator's
// wall clock reads" string gets one consistent format.
// ============================================================

const DENVER_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Convert a Date to America/Denver wall-clock in `YYYY-MM-DDTHH:MM:SS` form
 * (no offset suffix — the value IS local, not UTC).
 *
 * - Uses IANA zone data, so DST flips are correct automatically.
 * - Output is sortable lexicographically within a single zone.
 * - No milliseconds; D1's TEXT timestamps don't use them either.
 */
export function toDenverWallClock(d: Date): string {
  const parts = DENVER_FORMATTER.formatToParts(d).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    },
    {},
  );
  // Intl's `hour: '2-digit'` returns "24" for midnight on some Node builds; map to "00".
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

export interface DualStamp {
  /** Canonical ISO-8601 UTC with milliseconds and `Z` suffix. Use for math. */
  utc: string;
  /** America/Denver wall-clock, no offset. Use for display. */
  local: string;
}

/**
 * Return both UTC and Denver wall-clock strings for the given moment (defaults
 * to "now"). Use this everywhere you'd otherwise call `new Date().toISOString()`
 * on a write path that humans will later read.
 */
export function nowDualStamp(d: Date = new Date()): DualStamp {
  return {
    utc: d.toISOString(),
    local: toDenverWallClock(d),
  };
}

/**
 * Current America/Denver UTC offset in whole hours (-6 MDT / -7 MST),
 * DST-aware via Intl. D1/SQLite has no timezone data of its own — several
 * report queries need to bucket UTC-stored `created_at` timestamps into
 * Denver-local hours/shifts/days (e.g. "which shift did this call fall in"),
 * and were doing so by running strftime('%H', created_at) directly, which
 * reads the UTC hour and silently mislabels every row by 6-7 hours.
 *
 * This returns a single offset for the CURRENT moment, suitable for
 * `datetime(created_at, '<offset> hours')` in a query — a query spanning a
 * DST transition will be off by 1 hour for rows on the far side of the flip,
 * which is a large improvement over the prior 6-7 hour UTC/MT conflation.
 */
export function denverOffsetHours(d: Date = new Date()): number {
  const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const local = toDenverWallClock(d);
  const localHour = parseInt(local.slice(11, 13), 10) + parseInt(local.slice(14, 16), 10) / 60;
  let diff = Math.round(localHour - utcHour);
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return diff;
}
