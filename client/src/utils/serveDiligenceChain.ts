// ============================================================
// RMPG Flex — Diligence chain assessment (backward-looking)
// ============================================================
// `serveIntakeDiligence.ts` answers "when should the NEXT attempt
// be?". This module answers the question that actually decides
// whether a case survives challenge: "given the attempts already
// made, how strong is the diligence record RIGHT NOW, and does it
// yet support posting / substituted service?"
//
// Why it matters, concretely:
//   • Utah R. Civ. P. 4(d) permits posting/substituted service only
//     after diligent attempts at personal service. PSO code PS/20.01
//     ("Posted on Door") already carries the hint "Requires 2+ prior
//     failed attempts (Utah Rule 4(d))" — but nothing in the UI ever
//     told the officer whether that bar had been cleared. They had to
//     count attempts by eye off the timeline.
//   • Courts do not just count attempts; they look for VARIED times
//     of day and at least one non-business-hours / weekend try. Three
//     knocks at 2pm on three Tuesdays is a weak record even though it
//     is "3 attempts".
//   • The Affidavit of Non-Service is generated from this same chain
//     (see servePdfGenerator.ts). Surfacing the gaps BEFORE the
//     affidavit is drafted is the whole point — afterwards it is too
//     late to go get the missing weekend attempt.
//
// Pure functions only: no React, no fetch, no Date.now() baked in
// (callers pass `now`), so the thresholds are unit-testable.
// ============================================================

import { parseTimestamp } from './dateUtils';
import { MOUNTAIN_TIME_ZONE } from './timeZoneMode';
import type { ServeAttempt } from '../types';

/** Time-of-day bands courts read as meaningfully different. */
export type TimeBand = 'morning' | 'afternoon' | 'evening';

export interface DiligenceAssessment {
  /** Non-terminal (i.e. unsuccessful) attempts on the record. */
  failedAttempts: number;
  /** Distinct morning/afternoon/evening bands covered. Max 3. */
  bandsCovered: TimeBand[];
  /** At least one attempt on a Saturday or Sunday (Mountain time). */
  hasWeekendAttempt: boolean;
  /** Distinct Mountain-time calendar days attempted. */
  distinctDays: number;
  /** Widest gap in days between consecutive attempts, or null if <2. */
  largestGapDays: number | null;
  /** Utah R. Civ. P. 4(d) floor: 2+ prior failed attempts. */
  meetsRule4dFloor: boolean;
  /** Ordered, human-readable list of what would strengthen the record. */
  gaps: string[];
  strength: 'none' | 'weak' | 'adequate' | 'strong';
}

/**
 * Results that END the chain — a served/posted/dead-address attempt is not
 * a "failed attempt" for diligence-counting purposes. Mirrors the terminal
 * set in serveIntakeDiligence.nextAttemptWindow so the two modules cannot
 * disagree about what counts as unsuccessful.
 *
 * NOTE `wrong_address`/`moved` are terminal for *scheduling* (skip-trace
 * first) but they are NOT credit toward diligence at the address on file —
 * an attempt at the wrong house proves nothing about the right one. They
 * are therefore excluded from the count rather than treated as progress.
 */
const NON_CREDITING_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'deceased', 'wrong_address', 'moved',
]);

/**
 * Mountain-time hour + weekday for a stored `attempt_at`.
 *
 * `attempt_at` is naive UTC (repo-wide storage contract). Reading
 * `.getHours()` off it would bucket a 19:00 MDT attempt — stored as
 * 01:00 UTC the NEXT day — as "morning", and would also shift its
 * weekday forward, silently breaking both the band-variety count and
 * the weekend check. Formatting through the Mountain zone is the only
 * correct read.
 */
export function mountainParts(attemptAt: string): { hour: number; dow: number; ymd: string } {
  const d = parseTimestamp(attemptAt);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    // Intl emits "24" for midnight under hour12:false in some engines.
    hour: parseInt(parts.hour, 10) % 24,
    dow: DOW[parts.weekday] ?? 0,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function bandForHour(hour: number): TimeBand {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function assessDiligence(attempts: readonly ServeAttempt[]): DiligenceAssessment {
  const crediting = attempts.filter((a) => !NON_CREDITING_RESULTS.has(a.result) && a.attempt_at);

  const bandSet = new Set<TimeBand>();
  const daySet = new Set<string>();
  let hasWeekendAttempt = false;
  const dayMs: number[] = [];

  for (const a of crediting) {
    const { hour, dow, ymd } = mountainParts(a.attempt_at);
    bandSet.add(bandForHour(hour));
    daySet.add(ymd);
    if (dow === 0 || dow === 6) hasWeekendAttempt = true;
    dayMs.push(parseTimestamp(a.attempt_at).getTime());
  }

  dayMs.sort((x, y) => x - y);
  let largestGapDays: number | null = null;
  for (let i = 1; i < dayMs.length; i++) {
    const gap = Math.round((dayMs[i] - dayMs[i - 1]) / 86_400_000);
    largestGapDays = largestGapDays === null ? gap : Math.max(largestGapDays, gap);
  }

  const failedAttempts = crediting.length;
  // Order matters: 'morning' | 'afternoon' | 'evening' reads chronologically.
  const BAND_ORDER: TimeBand[] = ['morning', 'afternoon', 'evening'];
  const bandsCovered = BAND_ORDER.filter((b) => bandSet.has(b));
  const meetsRule4dFloor = failedAttempts >= 2;

  const gaps: string[] = [];
  if (failedAttempts === 0) {
    gaps.push('No documented attempts yet.');
  } else {
    if (failedAttempts < 2) gaps.push('Fewer than 2 attempts — Rule 4(d) floor not met.');
    if (bandsCovered.length < 2) {
      gaps.push('All attempts fall in one time-of-day band — vary morning / afternoon / evening.');
    }
    if (!hasWeekendAttempt) gaps.push('No weekend attempt on the record.');
    // Use distinctDays (calendar days) rather than largestGapDays (which rounds
    // to 0 for any two attempts fewer than 12h apart). A morning + evening pair
    // on the same calendar date represents meaningful time-of-day variation under
    // Utah R. Civ. P. 4(d) and should NOT be flagged as "same day" — only flag
    // when all attempts truly share a single calendar date.
    if (failedAttempts >= 2 && daySet.size === 1) {
      gaps.push('All attempts on the same day — courts expect reasonable intervals.');
    }
  }

  // Thresholds are RMPG policy layered on top of the Rule 4(d) floor, and are
  // intentionally stricter than the bare legal minimum: "adequate" is what the
  // statute requires, "strong" is what survives a motion to quash without an
  // argument. Tune here — every consumer reads `strength`, nothing re-derives it.
  let strength: DiligenceAssessment['strength'];
  if (failedAttempts === 0) strength = 'none';
  else if (!meetsRule4dFloor || bandsCovered.length < 2) strength = 'weak';
  else if (failedAttempts >= 3 && bandsCovered.length >= 2 && hasWeekendAttempt) strength = 'strong';
  else strength = 'adequate';

  return {
    failedAttempts,
    bandsCovered,
    hasWeekendAttempt,
    distinctDays: daySet.size,
    largestGapDays,
    meetsRule4dFloor,
    gaps,
    strength,
  };
}

/** Short label for the chip, e.g. "3 attempts · 2 bands · weekend". */
export function diligenceSummary(a: DiligenceAssessment): string {
  if (a.failedAttempts === 0) return 'No attempts';
  const bits = [`${a.failedAttempts} attempt${a.failedAttempts === 1 ? '' : 's'}`];
  bits.push(`${a.bandsCovered.length} band${a.bandsCovered.length === 1 ? '' : 's'}`);
  if (a.hasWeekendAttempt) bits.push('weekend');
  return bits.join(' · ');
}
