// ============================================================
// RMPG Flex — Process-service diligence scheduling
// ============================================================
// After an unsuccessful service attempt, the next attempt's
// timing matters legally AND operationally:
//
//   • Utah requires "due diligence" before substituted service
//     is permitted — courts look for VARIED times of day and
//     reasonable intervals (Rule 4(d), Utah R. Civ. P.).
//   • Operationally, returning at the same time of day after a
//     "no answer" is wasted mileage. Most people who weren't
//     home at 4pm Tuesday also won't be home at 4pm Wednesday.
//   • "Refused" needs a different strategy from "no_answer" —
//     refusal means we found the person, so we know they ARE
//     at that address. The question becomes when to catch them
//     less defended (early morning? With backup? A third party?).
//
// This module exposes one decision function the attempt modal
// calls right after the officer submits an attempt — the
// returned window is shown to the officer as a suggested next
// visit and pre-fills the queue's `time_window` field.
// ============================================================

// Mirrors the serve_attempts.result enum from migration 0030.
export type AttemptResult =
  | 'served'      // success — no next attempt
  | 'sub_served'  // substitute service — no next attempt
  | 'posted'      // posted-and-mailed — no next attempt
  | 'no_answer'   // nobody answered — try again
  | 'refused'     // person at door refused — try again
  | 'bad_address' // wrong place — re-skip-trace before retry
  | 'moved'       // resident moved — re-skip-trace before retry
  | 'deceased'    // recipient deceased — no next attempt
  | 'other';

// Human-readable window. Free-text by design so reviewers can read
// "Sat 6am-8am — try before they leave for weekend errands" and
// understand WHY, not just WHEN.
export interface AttemptWindow {
  /** Days from today to attempt next (1 = tomorrow, 0 = later today). */
  dayOffset: number;
  /** Short window label, e.g. "evening 7-9 PM" or "Sat morning". */
  window: string;
  /** One-line reasoning the officer + court reviewer can read. */
  reasoning: string;
  /** True when no further attempts are warranted (served / dead-end). */
  terminal: boolean;
}

// ────────────────────────────────────────────────────────────
// USER-CONTRIBUTED DOMAIN LOGIC
// ────────────────────────────────────────────────────────────
// Christopher — you have the real-world experience here. Below is
// the scaffolding; please fill in the body of `nextAttemptWindow`
// to reflect how RMPG actually schedules re-attempts.
//
// Inputs available:
//   result       — what just happened on this attempt
//   attemptNumber — 1 for first attempt, 2 for second, etc.
//                  After attempt_count >= max_attempts (default 3),
//                  the queue auto-fails — but you can return a
//                  diligence-style "final post-and-mail" window
//                  for attempt 3 if that's your practice.
//   attemptedAtHour — 0..23, hour-of-day of the attempt that just
//                    happened (in local Mountain Time).
//   attemptedAtDow  — 0..6, day-of-week of the attempt that just
//                    happened (0 = Sun, 6 = Sat).
//
// Trade-offs to weigh:
//
//   Aggressive (next morning): catches early-bird folks, burns
//   mileage if they're working from home.
//
//   Conservative (3-5 days out): cheaper, gives time for skip-trace
//   improvements between attempts, but loses calendar time on rush
//   jobs.
//
//   Time-of-day rotation: legally strongest pattern (morning →
//   evening → weekend midday). Some courts explicitly cite this
//   in opinions on whether substituted service was justified.
//
//   Special-case results:
//     'refused'     — they're there, but hostile. Different time?
//                     Or document the refusal and post?
//     'bad_address' — pause re-attempts entirely until skip-trace
//                     returns a new address (return terminal=true
//                     with a reasoning that flags the need).
//     'moved'       — same as bad_address from a scheduling angle.
//     'deceased'    — terminal; return reasoning that triggers a
//                     return-of-service-noting-deceased document.
//
// 8-12 lines is plenty. Aim for something a court reviewer reading
// the affidavit would nod at, not an optimal algorithm.
// ────────────────────────────────────────────────────────────

export function nextAttemptWindow(
  result: AttemptResult,
  attemptNumber: number,
  attemptedAtHour: number,
  attemptedAtDow: number,
): AttemptWindow {
  // Terminal results — no further door-attempt makes sense.
  if (result === 'served' || result === 'sub_served' || result === 'posted' || result === 'deceased') {
    return { dayOffset: 0, window: '', reasoning: 'No further attempts needed.', terminal: true };
  }
  if (result === 'bad_address' || result === 'moved') {
    return {
      dayOffset: 0,
      window: '',
      reasoning: 'Skip-trace required before next attempt — current address invalid.',
      terminal: true,
    };
  }

  // ── 'refused' — RMPG policy: refusal at the door identifies the
  //    recipient sufficiently. Next action is posting on the door and
  //    mailing a copy (per Utah R. Civ. P. 4(d)(1)(B)), not another
  //    door-knock. We surface this as a "next attempt" with a 2-day
  //    cushion so the affidavit notes a clear interval between the
  //    identification and the posting visit.
  if (result === 'refused') {
    return {
      dayOffset: 2,
      window: 'midday — post on door & mail',
      reasoning: 'Recipient identified at door. Next attempt: post & mail per Utah R. Civ. P. 4(d).',
      terminal: false,
    };
  }

  // ── Attempt #3 (about to hit max_attempts) — escalate to a "known
  //    people-are-home" slot. Sunday 1-4 PM is RMPG's empirical sweet
  //    spot. If the previous attempt was late in the week and Sunday
  //    is more than 3 days out, fall back to Saturday midday.
  if (attemptNumber >= 3) {
    const daysUntilSun = (7 - attemptedAtDow) % 7 || 7; // 0 → 7 to never re-use same day
    if (daysUntilSun <= 3) {
      return {
        dayOffset: daysUntilSun,
        window: 'Sunday 1-4 PM',
        reasoning: 'Final attempt — Sunday afternoon is highest-yield window before posting/sub-service.',
        terminal: false,
      };
    }
    const daysUntilSat = (6 - attemptedAtDow + 7) % 7 || 7;
    return {
      dayOffset: daysUntilSat,
      window: 'Saturday midday',
      reasoning: 'Final attempt — Saturday midday catches weekend-home recipients.',
      terminal: false,
    };
  }

  // ── 'no_answer' / 'other', attempts 1-2 — 2-3 days out with
  //    rotating time-of-day. AM no-answer → next attempt PM, and
  //    vice versa. At attempt #2, prefer landing on Saturday so the
  //    affidavit shows a weekend attempt in the diligence chain.
  let nextWindow: string;
  if (attemptedAtHour < 12)      nextWindow = 'afternoon 5-7 PM';
  else if (attemptedAtHour < 17) nextWindow = 'morning 8-10 AM';
  else                            nextWindow = 'morning 8-10 AM';  // evening visit → morning next

  let dayOffset = 2;
  if (attemptNumber === 2) {
    const daysUntilSat = (6 - attemptedAtDow + 7) % 7 || 7;
    if (daysUntilSat <= 4) {
      dayOffset = daysUntilSat;
      nextWindow = 'Saturday midday';
    } else {
      dayOffset = 3;
    }
  }

  return {
    dayOffset,
    window: nextWindow,
    reasoning: `Diligence rotation — attempt #${attemptNumber + 1} at different time-of-day. RMPG pattern: 2-3 day spacing, ensure Saturday in cycle.`,
    terminal: false,
  };
}
