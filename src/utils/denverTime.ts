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

// ── Shared SQL fragment builders ─────────────────────────────
// Four route files (reports.ts, admin.ts, dispatch/aggregates.ts,
// dispatch/units.ts) independently reimplemented the same denverOffsetHours()
// → SQL-fragment pattern (some as local `denverDateExpr`/`denverNowDateExpr`
// helpers, some inlined ad hoc). Each copy carried its own copy of the
// "single current-moment offset, not per-row DST-aware" tradeoff note — a
// real risk, since a future DST-safety fix applied to one copy and forgotten
// in the others would silently leave the app internally inconsistent about
// what "today" means depending on which report you're looking at. These are
// now the single source of truth; callers should use these instead of
// reimplementing the string-building.
//
// All three still share denverOffsetHours' known limitation: one offset
// computed for the CURRENT moment, applied uniformly to every row in the
// query. A query spanning a DST transition (e.g. "last 30 days" run in
// mid-March/November) will misbucket rows on the far side of the transition
// by up to 1 hour — a large improvement over the prior 6-7 hour raw-UTC bug,
// but not per-row DST-exact. Making it per-row exact would require bucketing
// in application code (via toDenverWallClock per row) instead of in SQL;
// that's a larger change than this consolidation and is intentionally out of
// scope here.

/** `DATE(<column>, '<offset> hours')` — shifts a UTC-stored column into its Denver calendar date. */
export function denverDateExpr(column: string, d: Date = new Date()): string {
  return `DATE(${column}, '${denverOffsetHours(d)} hours')`;
}

/** `DATE('now', [modifier,] '<offset> hours')` — Denver "today" (optionally offset further by a SQLite date modifier). */
export function denverNowDateExpr(modifier?: string, d: Date = new Date()): string {
  const offset = `${denverOffsetHours(d)} hours`;
  return modifier ? `DATE('now', '${modifier}', '${offset}')` : `DATE('now', '${offset}')`;
}

/**
 * Convert a "YYYY-MM-DD" calendar date + "HH:MM:SS" Denver wall-clock time
 * into its UTC epoch milliseconds, DST-aware (tries MST/-07:00 then
 * MDT/-06:00 and verifies via an Intl round-trip, so DST transition dates
 * don't need hardcoding — same technique as serveAttemptScheduler.ts's
 * localDenverToEpoch). Use this instead of `new Date(dateStr + 'T23:59:59')`
 * for any "end of day" / "start of day" comparison against a Denver-local
 * due date — the naive form is parsed as UTC by JS, which silently makes
 * "end of day" actually mean ~17:00-18:00 Denver time (a real bug found in
 * caseTaskNudges.ts's classifyTaskDue during the 2026-07-22 UTC/DST audit).
 */
export function denverDateStringToEpochMs(dateStr: string, hhmmss = '23:59:59'): number {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const hhmm = hhmmss.slice(0, 5);
  for (const off of ['-07:00', '-06:00']) {
    const d = new Date(`${dateStr}T${hhmmss}${off}`);
    if (isNaN(d.getTime())) continue;
    const formatted = fmt.format(d).replace(' ', 'T');
    if (formatted.slice(0, 16) === `${dateStr}T${hhmm}`) return d.getTime();
  }
  return new Date(`${dateStr}T${hhmmss}-07:00`).getTime();
}

/** `CAST(strftime('<fmt>', <column>, '<offset> hours') AS INTEGER)` — a UTC-stored column's Denver wall-clock field (e.g. '%H' hour, '%w' day-of-week), as SQL. */
export function denverStrftimeExpr(format: string, column: string, d: Date = new Date()): string {
  return `CAST(strftime('${format}', ${column}, '${denverOffsetHours(d)} hours') AS INTEGER)`;
}

/** `CAST(strftime('%H', <column>, '<offset> hours') AS INTEGER)` — a UTC-stored column's Denver wall-clock hour, as SQL. */
export function denverHourExpr(column: string, d: Date = new Date()): string {
  return denverStrftimeExpr('%H', column, d);
}

// ============================================================
// Timestamp normalization for operator/import-supplied values
// ============================================================

/** Canonical D1 storage form: UTC, `YYYY-MM-DD HH:MM:SS`, matching `datetime('now')`. */
function toSqlUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\..*$/, '');
}

/**
 * Normalize any operator- or import-supplied timestamp to canonical UTC
 * `YYYY-MM-DD HH:MM:SS` for storage.
 *
 * WHY THIS EXISTS — live audit 2026-07-31. `fleet_fuel_log.fuel_date` held
 * FOUR incompatible formats in one column because all three write paths stored
 * the caller's string verbatim:
 *
 *   87 rows  `2026-06-25T14:14:50`                  ISO, no offset
 *   22 rows  `2026-07-28T20:33:39.000000-06:00`     ISO, with offset
 *    3 rows  `2026-07-29 02:33:03`                  naive, space-separated
 *    1 row   `2026-07-17`                           date only
 *
 * SQLite reads an offset-less string as UTC. The naive values are Denver
 * wall-clock (evidenced: rows entered promptly sat 6.06h / 6.11h ahead of
 * their UTC `created_at`, i.e. exactly the MDT offset), so every one of them
 * was being read 6-7 hours early — the same conflation `denverOffsetHours`
 * documents. Concretely, `date('2026-07-17T19:28:00-06:00')` yields
 * **2026-07-18**, so evening fills land in the next day's bucket.
 *
 * Rules, in order:
 *  - explicit offset or `Z` present -> the instant is unambiguous; convert to UTC
 *  - offset-less date+time          -> DENVER wall-clock (DST-aware via
 *                                      `denverDateStringToEpochMs`)
 *  - date only                      -> Denver midnight that day
 *  - unparseable / empty            -> null (caller decides; never guess)
 *
 * Returns null rather than throwing so a bad import row can be skipped or
 * defaulted without failing the whole batch.
 */
export function normalizeToUtcTimestamp(input: unknown): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 1. Carries its own zone (…Z, …+HH:MM, …-HH:MM). Note the offset test must
  //    look only AFTER the time part — a bare date `2026-07-17` also contains
  //    '-' characters and would false-positive on a naive substring search.
  const hasZone = /[Zz]$/.test(raw) || /\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*[+-]\d{2}:?\d{2}$/.test(raw);
  if (hasZone) {
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? null : toSqlUtc(ms);
  }

  // 2. Offset-less date + time. THE SEPARATOR IDENTIFIES THE PRODUCER, and the
  //    two producers mean different zones — conflating them corrupts data:
  //
  //      'YYYY-MM-DD HH:MM:SS' (space) <- SQLite datetime('now')  => already UTC
  //      'YYYY-MM-DDTHH:MM:SS' (T)     <- toDenverWallClock()     => Denver local
  //
  //    Proven on live data by the three double-logged fills, where the same
  //    fill exists once with an explicit -06:00 offset and once space-separated:
  //      id 114 20:33:39-06:00 -> 02:33:39Z   vs  id 115 '2026-07-29 02:33:03'
  //      id 113 14:42:00-06:00 -> 20:42:00Z   vs  id 116 '2026-07-21 20:42:31'
  //      id  94 19:28:00-06:00 -> 01:28:00Z   vs  id 117 '2026-07-18 01:28:47'
  //    All three align only if the space form is read as UTC. Treating it as
  //    Denver would have shifted those rows a further +6h into the future.
  const spaceForm = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/);
  if (spaceForm) {
    const hhmmss = spaceForm[2].length === 5 ? `${spaceForm[2]}:00` : spaceForm[2];
    const ms = Date.parse(`${spaceForm[1]}T${hhmmss}Z`);
    return Number.isNaN(ms) ? null : toSqlUtc(ms);
  }

  const dt = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/);
  if (dt) {
    const hhmmss = dt[2].length === 5 ? `${dt[2]}:00` : dt[2];
    const ms = denverDateStringToEpochMs(dt[1], hhmmss);
    return Number.isNaN(ms) ? null : toSqlUtc(ms);
  }

  // 3. Date only -> Denver midnight.
  const dOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dOnly) {
    const ms = denverDateStringToEpochMs(dOnly[1], '00:00:00');
    return Number.isNaN(ms) ? null : toSqlUtc(ms);
  }

  return null;
}
