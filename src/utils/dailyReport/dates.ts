// ============================================================
// RMPG Flex — Daily Blotter: Denver ↔ UTC day math
// ============================================================
// A blotter "for 2026-07-18" must cover 00:00:00–23:59:59
// America/Denver, but D1 stores UTC via datetime('now'). Using
// date(created_at) would misfile every event after 18:00 Mountain
// into the next day and drift an hour across DST.
//
// Everything here is pure — no clock reads (callers inject nowMs) —
// so DST transitions are directly testable.
// ============================================================

const TZ = 'America/Denver';

/** Offset (ms) to ADD to a UTC instant to get Denver wall-clock time. */
function tzOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // hour12:false yields '24' at midnight in some ICU builds; normalize.
  const asIfUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * UTC instant for Denver-local midnight starting `dateStr`.
 *
 * Two passes: the first offset is guessed from the naive instant, the
 * second is re-read at the corrected instant. That second pass is what
 * makes DST-transition days correct — the offset that applies at the
 * naive timestamp is not always the offset that applies at the real one.
 */
function denverMidnightUtcMs(y: number, m: number, d: number): number {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = naive - tzOffsetMs(naive);
  utc = naive - tzOffsetMs(utc);
  return utc;
}

/** D1 stores 'YYYY-MM-DD HH:MM:SS' (UTC). Bounds must match that shape
 *  exactly so string comparison against created_at is valid. */
function toD1Utc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function parseYmd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  return [y, m, d];
}

/** Half-open [startUtc, endUtc) covering one Denver calendar day. */
export function denverDayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = parseYmd(dateStr);
  return {
    startUtc: toD1Utc(denverMidnightUtcMs(y, m, d)),
    endUtc: toD1Utc(denverMidnightUtcMs(y, m, d + 1)),
  };
}

/** The Denver calendar day containing the given UTC instant. */
export function denverToday(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The `n` Denver days immediately before `dateStr`, newest first. */
export function previousDenverDays(dateStr: string, n: number): string[] {
  if (n <= 0) return [];
  const [y, m, d] = parseYmd(dateStr);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    // Midday avoids any DST edge when stepping by whole days.
    const ms = Date.UTC(y, m - 1, d - i, 12, 0, 0);
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}
