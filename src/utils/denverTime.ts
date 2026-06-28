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
