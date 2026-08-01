// Driver performance scoring — PURE. No D1, no I/O, no clock.
//
// Kept isolated because this is the logic most likely to be read by someone
// who is not a developer: a supervisor in a review, or opposing counsel in
// discovery. It must be legible and testable on its own.
//
// Spec: docs/superpowers/specs/2026-08-01-driver-performance-design.md

/**
 * Bump on ANY weighting or formula change. Snapshots store the version they
 * were computed under so retuning never silently restates history.
 *
 * TODO(owner): rename to 'v1' once weights below are reviewed.
 */
export const SCORE_VERSION = 'v1-placeholder-weights';

/** Below this, no score is produced. A blank is honest; a zero is a claim. */
export const MIN_EXPOSURE_MILES = 250;

/** Weighted events per 100 miles that maps to a score of 0. */
const REFERENCE_RATE_AT_ZERO = 20;

/** Below this share of recorded (vs inferred) attribution, flag as inferred. */
const RECORDED_CONFIDENCE_THRESHOLD = 0.5;

export interface EventCounts {
  forwardCollision: number;
  laneDeparture: number;
  closeFollowing: number;
  harshBrake: number;
  harshAccel: number;
  speeding: number;
}

export type ScoreBand = 'excellent' | 'good' | 'needs_attention' | 'at_risk';

export interface ScoreInput {
  milesDriven: number;
  events: EventCounts;
  /** 0..1 — share of this window's events with recorded (not inferred) attribution. */
  recordedPct: number;
}

export type ScoreResult =
  | { status: 'insufficient_data'; milesDriven: number }
  | {
      status: 'scored';
      score: number;
      band: ScoreBand;
      weightedRatePer100Miles: number;
      milesDriven: number;
      confidence: 'recorded' | 'inferred';
      scoreVersion: string;
    };

/**
 * ⚠️ PLACEHOLDER WEIGHTS — REQUIRES OWNER REVIEW.
 *
 * These encode how much worse one risky behavior is than another. That is a
 * policy judgment about Rocky Mountain Protective Group's risk tolerance, not
 * a technical default. The values below are ordered sensibly but are NOT
 * authoritative. Review them, then update SCORE_VERSION to 'v1' and delete
 * the `it.fails('has owner-reviewed weights')` gate in the test file.
 */
const WEIGHTS: Record<keyof EventCounts, number> = {
  forwardCollision: 10, // imminent-collision warning — highest real-crash proximity
  harshBrake: 6,        // often the reaction to following too closely
  closeFollowing: 4,    // sustained risk posture rather than a single moment
  laneDeparture: 4,     // attention/fatigue signal
  speeding: 3,
  harshAccel: 2,        // wear and fuel more than crash risk
};

export function severityWeight(event: keyof EventCounts): number {
  return WEIGHTS[event];
}

/**
 * True while the severity weights are still placeholders.
 *
 * The route uses this to refuse to serve scores: a number derived from
 * unreviewed weights must not reach a supervisor, because it would look
 * exactly like a reviewed one. Fails loudly where someone will notice,
 * rather than in a CI suite nobody reads.
 */
export function weightsPendingReview(): boolean {
  return SCORE_VERSION.includes('placeholder');
}

function bandFor(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'needs_attention';
  return 'at_risk';
}

/**
 * Score is anchored to a FIXED reference rate, not to the current roster.
 * An officer's score must never move because a colleague drove badly —
 * that would make a snapshot unreproducible and the ranking incoherent.
 *
 * This function never returns a rank. Ranking happens in the route, over
 * scored officers only, so an `insufficient_data` officer can never land at
 * the bottom of a leaderboard.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const { milesDriven, events, recordedPct } = input;

  if (!Number.isFinite(milesDriven) || milesDriven < MIN_EXPOSURE_MILES) {
    return { status: 'insufficient_data', milesDriven: Math.max(0, milesDriven || 0) };
  }

  const weightedEvents = (Object.keys(WEIGHTS) as (keyof EventCounts)[])
    .reduce((sum, k) => sum + WEIGHTS[k] * (events[k] || 0), 0);

  const weightedRatePer100Miles = weightedEvents / (milesDriven / 100);

  const raw = 100 * (1 - weightedRatePer100Miles / REFERENCE_RATE_AT_ZERO);
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;

  return {
    status: 'scored',
    score,
    band: bandFor(score),
    weightedRatePer100Miles,
    milesDriven,
    confidence: recordedPct >= RECORDED_CONFIDENCE_THRESHOLD ? 'recorded' : 'inferred',
    scoreVersion: SCORE_VERSION,
  };
}
