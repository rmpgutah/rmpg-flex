// ============================================================
// RMPG Flex — Serve Intake diligence planner
// ============================================================
// Turns the diligence doctrine (vary time-of-day, include a weekend,
// front-load against the deadline) into a concrete dated attempt plan
// at intake time. Pure functions of (nowIso, deadline) — no Date.now()
// inside — so a plan is reproducible for any audit of why an attempt
// was recommended on a given day.
//
// Consumers (commitIntake):
//   • RECOMMENDED ATTEMPT PLAN section of the INTAKE briefing note
//   • serve_queue.parsed_data._intake.attempt_plan (machine-readable)
//   • /upload response → success-card plan table
// ============================================================

import type { ServePriority } from './serveIntakeExtract';
import type { TimeBand } from './serveScheduleParse';
import type { AddressClass } from './serveAddressClass';
import { selectWindows, usesBusinessTiming, defaultAuthorityForClass, type WindowAuthority } from './serveAttemptWindows';
import { log } from './logger';

export interface AttemptWindow {
  attempt: number;            // 1-based
  date: string;               // YYYY-MM-DD (America/Denver)
  weekday: string;            // FULL name — 'Monday', not 'Mon' (D5)
  window: string;             // '17:00-20:30'
  focus: string;              // why this window
  authority: WindowAuthority; // why this band was chosen
  constrained?: boolean;      // true when a location note shaped this window
}

// Options passed in from commitIntake once entity type + location note are known.
export interface PlanOptions {
  /** @deprecated for TIMING. Retained because callers still pass it and
   *  it still drives who may accept service. Per operator decision D-2 it
   *  MUST NOT select attempt windows — addressClass does that. */
  isBusiness?: boolean;
  addressClass?: AddressClass;
  /** D-2 (R4): business timing requires a CONFIRMED business LOCATION.
   *  Absent/false → residential windows and all-week days, whatever
   *  `addressClass` says. Defaults to false so a forgetful caller
   *  degrades in the safe direction. */
  addressClassConfirmed?: boolean;
  clientBands?: TimeBand[];
  allowedDays?: number[] | null;
  startNotBefore?: string | null;
  locationNote?: {
    days_available?: number[] | null;
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Mon–Fri (0=Sun)

function localParts(d: Date, tz: string): { date: string; weekday: string; dowNum: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  // 'long' — D5: the report reads "MONDAY", not "MON".
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  const dowNum = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(weekday);
  return { date, weekday, dowNum };
}

// Whole days from now until end-of-day on the deadline (date-only ISO).
export function daysUntilDeadline(nowIso: string, deadline: string | null): number | null {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const end = Date.parse(`${deadline}T23:59:59`);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - Date.parse(nowIso)) / DAY_MS);
}

// Next day offset from `now` that falls on an allowed day of week.
// minOffset ensures we don't collide with a previous attempt.
function nextAllowedDay(now: Date, minOffset: number, allowed: Set<number>, tz: string): number {
  let offset = minOffset;
  for (let guard = 0; guard < 14; guard++, offset++) {
    const d = new Date(now.getTime() + offset * DAY_MS);
    if (allowed.has(localParts(d, tz).dowNum)) return offset;
  }
  return minOffset;
}

export function planAttemptWindows(
  nowIso: string,
  deadline: string | null,
  tz = 'America/Denver',
  options: PlanOptions = {},
): AttemptWindow[] {
  const now = new Date(nowIso);
  const days = daysUntilDeadline(nowIso, deadline);
  const { locationNote } = options;

  const specs = selectWindows({
    addressClass: options.addressClass ?? 'unknown',
    addressClassConfirmed: options.addressClassConfirmed,
    clientBands: options.clientBands ?? [],
    locationNote: locationNote ?? null,
  });

  // Allowed days: client constraint > location note > address-class default.
  // D-2 (R4): the weekday-only narrowing is business TIMING, so it needs the
  // same confirmation gate selectWindows() applies.
  let allowedDows: Set<number>;
  let daysFromNote = false;
  if (options.allowedDays && options.allowedDays.length) {
    allowedDows = new Set(options.allowedDays);
  } else if (locationNote?.days_available?.length) {
    allowedDows = new Set(locationNote.days_available);
    daysFromNote = true;
  } else if (usesBusinessTiming(options.addressClass ?? 'unknown', options.addressClassConfirmed)) {
    allowedDows = WEEKDAYS;
  } else {
    allowedDows = new Set([0, 1, 2, 3, 4, 5, 6]);
  }

  // R7: `constrained` used to be true from the MERE PRESENCE of a location
  // note, and the briefing then asserted "attempt windows have been adjusted
  // to comply with these constraints" — untrue whenever client bands (which
  // OUTRANK the site note) or the class defaults supplied the windows. It is
  // now true only when the note actually shaped the emitted plan: either the
  // window came from the note, or the note supplied the allowed days.
  const constrained = daysFromNote || specs.some((s) => s.authority === 'site note');

  // Earliest permitted offset honours the client's start-date bar.
  // FINDING 3 FIX: the old version scanned offset 0..59 looking for the
  // first local date >= startNotBefore, and if none of those 60 days
  // qualified (a startNotBefore more than ~59 days out) it fell through
  // with minOffset left at its 0 default — SILENTLY DROPPING the client's
  // start-date bar, which is the unsafe direction (an officer could be
  // scheduled to attempt before the client authorized any attempt at all).
  // Estimate the offset from a UTC midnight diff, then walk forward from
  // that estimate until the LOCAL date satisfies the bar. The walk is
  // monotonic in offset (dates only increase), so it always terminates —
  // the constraint can never silently vanish regardless of how far out
  // startNotBefore is.
  // FINDING 3a FIX: the regex only checks SHAPE (\d{4}-\d{2}-\d{2}), not
  // calendar validity — a string like '9999-99-99' matches the regex but
  // Date.parse() returns NaN for it, which would make `o` NaN and the
  // first localParts(new Date(NaN), tz) call THROW a RangeError (Intl
  // rejects an invalid Date), crashing the whole planner on a commit path.
  // Guard explicitly: an unparseable bar is treated as absent (matches the
  // old code's silent-drop behavior for THIS specific failure mode — a
  // malformed value, as opposed to a valid-but-far-out one, which Finding 3
  // already fixed) but is logged so it's visible instead of silent.
  let minOffset = 0;
  if (options.startNotBefore && /^\d{4}-\d{2}-\d{2}$/.test(options.startNotBefore)) {
    const targetUtcMs = Date.parse(`${options.startNotBefore}T00:00:00Z`);
    if (Number.isNaN(targetUtcMs)) {
      log.warn('planAttemptWindows: unparseable attempt_start_not_before ignored', {
        attempt_start_not_before: options.startNotBefore,
      });
    } else {
      let o = Math.max(0, Math.floor((targetUtcMs - now.getTime()) / DAY_MS) - 2);
      while (localParts(new Date(now.getTime() + o * DAY_MS), tz).date < options.startNotBefore) o++;
      minOffset = o;
    }
  }

  const result: AttemptWindow[] = [];
  const used = new Set<string>();   // `${date}|${window}` — D1 guard
  let lastOffset = minOffset - 1;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    let offset = nextAllowedDay(now, Math.max(minOffset, lastOffset + 1), allowedDows, tz);

    // D1 FIX: clamping to the deadline used to pin every remaining slot to
    // the SAME day, so attempts 2 and 3 printed on one date. Clamp, then
    // walk forward to the earliest date whose (date, band) pair is still
    // free — distinct bands on one day are a valid tight-deadline plan;
    // duplicate (date, band) pairs are not.
    if (days !== null && offset > days) offset = Math.max(minOffset, days);

    // FINDING 2 FIX: the key MUST be recomputed from the current offset on
    // every iteration, including right after a deadline clamp. The old
    // version could clamp `offset` back down inside the guard loop and
    // `break` without recomputing `key`, re-adding the SAME stale
    // already-used key to `used` and pushing a duplicate (date, window)
    // pair — reachable via duplicate clientBands entries under a tight
    // deadline. If no free pair exists within the deadline, skip this spec
    // rather than emit a duplicate.
    let date = localParts(new Date(now.getTime() + offset * DAY_MS), tz).date;
    let key = `${date}|${spec.window}`;
    let guard = 0;
    while (used.has(key) && guard < 30) {
      guard++;
      if (days !== null && offset >= days) break;   // can't advance past the deadline
      offset++;
      if (days !== null && offset > days) offset = days;
      date = localParts(new Date(now.getTime() + offset * DAY_MS), tz).date;
      key = `${date}|${spec.window}`;
    }

    lastOffset = offset;
    if (used.has(key)) continue;   // no free (date, window) pair — skip, don't duplicate
    used.add(key);

    const weekday = localParts(new Date(now.getTime() + offset * DAY_MS), tz).weekday;
    result.push({
      attempt: result.length + 1,
      date,
      weekday,
      window: spec.window,
      focus: spec.focus,
      authority: spec.authority,
      constrained,
    });
  }

  return result;
}

// Deadline-proximity escalation: ≤3 days → urgent, ≤7 days → rush.
// Only ever raises — a client-requested 'urgent' on a far deadline stays.
const PRIORITY_RANK: Record<ServePriority, number> = { routine: 0, normal: 1, rush: 2, urgent: 3 };

export function escalatePriorityForDeadline(
  priority: ServePriority,
  nowIso: string,
  deadline: string | null,
): ServePriority {
  const days = daysUntilDeadline(nowIso, deadline);
  if (days === null) return priority;
  const floor: ServePriority = days <= 3 ? 'urgent' : days <= 7 ? 'rush' : priority;
  return PRIORITY_RANK[floor] > PRIORITY_RANK[priority] ? floor : priority;
}

// ── Geographic clustering ──────────────────────────────────────
// Stable cluster id for grouping nearby attempts on the same officer's day.
// 3-decimal lat/lng truncation = ~110 m cell — same building shares; different
// ZIPs do not. Falls back to ZIP5 when lat/lng is missing.
// IMPORTANT: uses Math.trunc(x * 1000) / 1000, NOT toFixed(3), because
// toFixed rounds, which would split adjacent buildings between two cells.
// Format: `g-{lat3}-{lng3}`. For US coordinates (always negative lng) the
// template dash + negative sign render as `--` in the output, giving a
// stable two-character delimiter.
export function clusterByProximity(
  lat: number | null,
  lng: number | null,
  zip: string | null,
): string | null {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const lat3 = (Math.trunc(lat * 1000) / 1000).toFixed(3);
    const lng3 = (Math.trunc(lng * 1000) / 1000).toFixed(3);
    return `g-${lat3}-${lng3}`;
  }
  if (zip && /^\d{5}/.test(zip)) {
    return `z-${zip.slice(0, 5)}`;
  }
  return null;
}

// ── Court-deadline urgency tier ──────────────────────────────────
// Pure derivation called at intake commit AND by the daily rebalance cron.
//   critical : deadline ≤ 2 days away, already past, OR
//              days_remaining ≤ attempts_remaining (no buffer for 24h diligence gap)
//   tight    : 3–5 days away
//   standard : > 5 days, or no deadline
//
// Source of truth is (priority, deadline) — tier is a CACHE the calendar reads
// to color/sort without per-query recomputation. Stays in sync via the cron.
export type UrgencyTier = 'critical' | 'tight' | 'standard';

export function applyUrgencyTier(
  deadline: string | null,
  attemptCount: number,
  maxAttempts: number,
  nowIso: string,
): UrgencyTier {
  const days = daysUntilDeadline(nowIso, deadline);
  if (days === null) return 'standard';
  if (days < 0 || days <= 2) return 'critical';
  const remaining = Math.max(0, maxAttempts - attemptCount);
  // No buffer: days remaining ≤ attempts still required (need ~24h between attempts).
  if (remaining > 0 && days <= remaining) return 'critical';
  if (days <= 5) return 'tight';
  return 'standard';
}

// ── Auto-replan after a failed attempt ───────────────────────────
// Returns the NEXT AttemptWindow to schedule when an officer logs a failed
// attempt (no_answer | refused | bad_address | moved). The new window:
//   1. Starts ≥ 24 h after the failed attempt (no same-day retry)
//   2. Uses a different time-of-day band than the failed attempt
//      (UNLESS deadline ≤ 4 days away — under tight pressure date proximity
//       wins; the earliest slot is returned even if its band matches the fail)
//   3. Respects deadline pressure — pulls closer when days_remaining is tight
//   4. Respects business hours / location-note constraints via planAttemptWindows()
//   5. Returns null if max_attempts is exhausted (caller marks status=failed)
//
// Implementation strategy: replan the FULL plan from `attempt_count + 1`'s
// start time, then return the first window. This re-uses every existing
// scheduling rule (weekend inclusion, business-hours, location-note) without
// duplicating logic.
export interface FailedAttemptCtx {
  attempt_at: string;          // ISO timestamp of the failed attempt
  result: string;              // 'no_answer' | 'refused' | 'bad_address' | 'moved'
  window: string | null;       // e.g. '17:00–20:30' — the band that failed
}

export interface ReplanQueueCtx {
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;       // count BEFORE the failed attempt was recorded
  // recipient_lat/lng are accepted for future proximity-based officer matching
  // (PR 2/3 dashboard panel + full-page scheduler). NOT used by this replan.
  recipient_lat: number | null;
  recipient_lng: number | null;
  /** @deprecated for TIMING — see PlanOptions.isBusiness (D-2). */
  isBusiness?: boolean;
  addressClass?: AddressClass;
  /** D-2 (R4): business timing requires a confirmed business LOCATION. */
  addressClassConfirmed?: boolean;
  // R6: the client's dictated hours/days/start bar are persisted flat in
  // serve_queue.parsed_data and MUST be re-applied on every re-plan. Before
  // this fix the replan path passed none of them, so EVERY attempt after the
  // first ignored the client's authorized hours — on the path that generates
  // most attempts.
  clientBands?: TimeBand[];
  allowedDays?: number[] | null;
  startNotBefore?: string | null;
  locationNote?: PlanOptions['locationNote'];
}

function failedBandKind(window: string | null): 'morning' | 'midday' | 'afternoon' | 'evening' | null {
  if (!window) return null;
  const startToken = window.split(/[-–—]/)[0] ?? '';
  const startH = parseInt(startToken.split(':')[0] ?? '', 10);
  if (Number.isNaN(startH)) return null;
  if (startH < 11) return 'morning';
  if (startH < 14) return 'midday';
  if (startH < 17) return 'afternoon';
  return 'evening';
}

export function replanAfterFailedAttempt(
  failed: FailedAttemptCtx,
  queue: ReplanQueueCtx,
  tz = 'America/Denver',
): AttemptWindow | null {
  if (queue.attempt_count + 1 > queue.max_attempts) return null;

  const failedKind = failedBandKind(failed.window);
  const failLocal = localParts(new Date(Date.parse(failed.attempt_at)), tz);
  const sameDayOk = failedKind === 'morning' || failedKind === 'midday' || failedKind === 'afternoon';

  if (sameDayOk) {
    if (queue.clientBands?.length) {
      const failStart = parseInt((failed.window || '00:00').split(/[-–—]/)[0] ?? '0', 10);
      const later = queue.clientBands.find((b) => parseInt(b.start, 10) > failStart) ?? queue.clientBands[0];
      return {
        attempt: queue.attempt_count + 1,
        date: failLocal.date,
        weekday: failLocal.weekday,
        window: `${later.start}-${later.end}`,
        focus: 'client-specified attempt band — do not attempt outside these hours',
        authority: 'client-specified',
      };
    }
    const window = failedKind === 'morning' ? '12:00-17:00' : '18:00-21:00';
    return {
      attempt: queue.attempt_count + 1,
      date: failLocal.date,
      weekday: failLocal.weekday,
      window,
      focus: 'diligence rotation — later band the same day after a failed attempt',
      authority: usesBusinessTiming(queue.addressClass ?? 'unknown', queue.addressClassConfirmed)
        ? defaultAuthorityForClass(queue.addressClass ?? 'unknown')
        : 'residential default',
    };
  }

  const replanStart = new Date(Date.parse(failed.attempt_at) + DAY_MS).toISOString();

  const plan = planAttemptWindows(replanStart, queue.deadline, tz, {
    isBusiness: queue.isBusiness ?? false,
    addressClass: queue.addressClass,
    addressClassConfirmed: queue.addressClassConfirmed,
    clientBands: queue.clientBands ?? [],
    allowedDays: queue.allowedDays ?? null,
    startNotBefore: queue.startNotBefore ?? null,
    locationNote: queue.locationNote ?? null,
  });
  if (!plan.length) return null;

  const days = daysUntilDeadline(replanStart, queue.deadline);
  const isDeadlineTight = days !== null && days <= 4;

  if (failedKind && !isDeadlineTight) {
    const differentBand = plan.find((w) => failedBandKind(w.window) !== failedKind);
    if (differentBand) return { ...differentBand, attempt: queue.attempt_count + 1 };
  }
  return { ...plan[0], attempt: queue.attempt_count + 1 };
}
