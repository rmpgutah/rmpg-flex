// ═══════════════════════════════════════════════════════════════
// Tasks — due-date countdown helper.
// ───────────────────────────────────────────────────────────────
// `task_assignments.due_date` is stored as an ISO date string
// (`YYYY-MM-DD`, no time component). The page shipped with the raw
// string rendered verbatim, so an operator scanning the table had
// no way to tell at a glance which tasks were overdue, due today,
// or weeks out. This pure helper converts a due-date string +
// reference timestamp into a structured countdown that the page
// can colour-code (red overdue, amber today, brand-gold upcoming,
// dim later) without recomputing day math at every row.
//
// Pure module — no React, no Date.now() inside the function (caller
// passes `now`) so it stays deterministic and unit-testable. Mountain
// Time (America/Denver) is the operating jurisdiction; we compare
// local-calendar days rather than UTC offsets so a Monday task with
// `due_date='2026-06-22'` is "today" for an operator in Denver even
// when the server clock is past midnight UTC.
// ═══════════════════════════════════════════════════════════════

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' | 'unknown';

export interface DueCountdown {
  /** Human label — "OVERDUE 3d", "Due today", "Due tomorrow",
   *  "Due in 5d", "Due 2026-06-30". Includes the literal "—" sentinel
   *  when the due date is missing or unparseable. */
  label: string;
  /** Calendar-day delta from `now` to `dueDate`, in local days. Negative
   *  means overdue. Null when the input could not be parsed. */
  daysDelta: number | null;
  /** Coarse-grained semantic bucket the page colour-codes against. */
  tone: DueTone;
}

const MT_TZ = 'America/Denver';

/** Format a Date as a `YYYY-MM-DD` string in the supplied IANA timezone.
 *  Intl.DateTimeFormat is the only built-in that does timezone math
 *  without a library; we extract the components manually so the format
 *  matches the SQL string the server emits. */
function localCalendarDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Parse `YYYY-MM-DD` to a UTC midnight Date. Used for arithmetic only —
 *  the calendar date itself is already timezone-resolved by the caller. */
function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build a countdown describing how far a task's due date is from `now`.
 *  Pass `now = new Date()` in production; tests can inject a fixed
 *  timestamp. */
export function describeDueDate(
  dueDate: string | null | undefined,
  now: Date = new Date(),
  tz: string = MT_TZ,
): DueCountdown {
  if (!dueDate || typeof dueDate !== 'string' || !dueDate.trim()) {
    return { label: '—', daysDelta: null, tone: 'unknown' };
  }
  // Accept both `YYYY-MM-DD` and a full ISO timestamp (the API normally
  // returns the date-only form, but a future migration to a TIMESTAMP
  // column would slip through if we were strict).
  const due = parseYmd(dueDate.slice(0, 10));
  if (!due) return { label: dueDate, daysDelta: null, tone: 'unknown' };

  const todayYmd = localCalendarDate(now, tz);
  const today = parseYmd(todayYmd);
  if (!today) return { label: dueDate, daysDelta: null, tone: 'unknown' };

  const msPerDay = 86400000;
  const daysDelta = Math.round((due.getTime() - today.getTime()) / msPerDay);

  if (daysDelta < 0) {
    const overdueBy = Math.abs(daysDelta);
    return {
      label: `OVERDUE ${overdueBy}d`,
      daysDelta,
      tone: 'overdue',
    };
  }
  if (daysDelta === 0) return { label: 'Due today', daysDelta, tone: 'today' };
  if (daysDelta === 1) return { label: 'Due tomorrow', daysDelta, tone: 'tomorrow' };
  if (daysDelta <= 7) return { label: `Due in ${daysDelta}d`, daysDelta, tone: 'soon' };
  return { label: `Due ${dueDate.slice(0, 10)}`, daysDelta, tone: 'later' };
}

/** Map the countdown tone onto a Tailwind text-color class. Kept in this
 *  module so callers don't open-code the same switch in every consumer. */
export function dueToneTextClass(tone: DueTone): string {
  switch (tone) {
    case 'overdue':  return 'text-red-400';
    case 'today':    return 'text-amber-300';
    case 'tomorrow': return 'text-amber-200';
    case 'soon':     return 'text-brand-400';
    case 'later':    return 'text-rmpg-400';
    case 'unknown':
    default:         return 'text-rmpg-500';
  }
}
