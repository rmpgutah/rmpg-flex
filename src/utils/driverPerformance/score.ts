// Driver performance scoring — PURE. No D1, no I/O, no clock.
//
// Kept isolated because this is the logic most likely to be read by someone
// who is not a developer: a supervisor in a review, or opposing counsel in
// discovery. It must be legible and testable on its own.
//
// Spec: docs/superpowers/specs/2026-08-01-driver-performance-design.md

import type { SpeedEventCounts } from './speedEvents';

export type { SpeedEventCounts };

/**
 * Bump on ANY weighting or formula change. Snapshots store the version they
 * were computed under so retuning never silently restates history.
 *
 * 'v1-speed': events are derived from directly-observed MDT GPS speed
 * (src/utils/driverPerformance/speedEvents.ts). The previous ClearPath
 * dashcam-event source was dropped — its credentials were absent, so it had
 * been feeding an empty numerator while miles kept accruing.
 */
export const SCORE_VERSION = 'v1-speed';

/** Below this, no score is produced. A blank is honest; a zero is a claim. */
export const MIN_EXPOSURE_MILES = 250;

/** Weighted events per 100 miles that maps to a score of 0. */
const REFERENCE_RATE_AT_ZERO = 20;

/** Below this share of recorded (vs inferred) attribution, flag as inferred. */
const RECORDED_CONFIDENCE_THRESHOLD = 0.5;

export type ScoreBand = 'excellent' | 'good' | 'needs_attention' | 'at_risk';

/** Why no score was produced. Never collapse these — they mean different things. */
export type InsufficientReason = 'below_exposure_floor' | 'no_breadcrumb_samples';

export interface ScoreInput {
  milesDriven: number;
  events: SpeedEventCounts;
  /** 0..1 — share of this window's events with recorded (not inferred) attribution. */
  recordedPct: number;
  /**
   * GPS breadcrumb samples observed for this officer-window.
   *
   * ⚠️ REQUIRED, and deliberately not optional. Miles come from `unit_trips`
   * and breadcrumbs come from the MDT feed; those are independent pipelines.
   * Miles with ZERO breadcrumbs means the feed was DEAD, not that the officer
   * drove flawlessly — and a dead feed produces zero events, which scores 100.
   * That is exactly how the retired ClearPath source would have handed every
   * officer a perfect record. Making this a required field means no call site
   * can reintroduce that failure by forgetting it.
   */
  breadcrumbSamples: number;
}

export type ScoreResult =
  | { status: 'insufficient_data'; reason: InsufficientReason; milesDriven: number }
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
 * Severity weights, in force as of SCORE_VERSION 'v1-speed'.
 *
 * These encode how much worse one speed tier is than another — a policy
 * judgment about Rocky Mountain Protective Group's risk tolerance. Changing
 * any value REQUIRES bumping SCORE_VERSION, or historical snapshots become
 * silently incomparable to new ones.
 */
const WEIGHTS: Record<keyof SpeedEventCounts, number> = {
  speedHigh: 3,      // 70+ mph — sustained, above most posted limits
  speedVeryHigh: 8,  // 80+ mph
  speedExtreme: 20,  // 90+ mph — crash energy rises with the square of speed
};

export function severityWeight(event: keyof SpeedEventCounts): number {
  return WEIGHTS[event];
}

function bandFor(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'needs_attention';
  return 'at_risk';
}

/**
 * Safely coerce event counts to non-negative integers.
 * Negative, NaN, Infinity, and undefined counts become 0.
 * This prevents upstream bugs (e.g., delta underflow) from fabricating perfect scores.
 */
function sanitizeEventCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 0;
  const n = count || 0;
  return n < 0 ? 0 : n;
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
  const { milesDriven, events, recordedPct, breadcrumbSamples } = input;

  if (!Number.isFinite(milesDriven) || milesDriven < MIN_EXPOSURE_MILES) {
    return {
      status: 'insufficient_data',
      reason: 'below_exposure_floor',
      milesDriven: Math.max(0, milesDriven || 0),
    };
  }

  // Dead-feed guard. Above the exposure floor with no observations at all is
  // not clean driving — it is an unmonitored officer. Refusing to score is the
  // only honest answer, and it is loud: the row shows up in the unscored block
  // rather than at the top of the leaderboard.
  if (!Number.isFinite(breadcrumbSamples) || breadcrumbSamples <= 0) {
    return { status: 'insufficient_data', reason: 'no_breadcrumb_samples', milesDriven };
  }

  const weightedEvents = (Object.keys(WEIGHTS) as (keyof SpeedEventCounts)[])
    .reduce((sum, k) => sum + WEIGHTS[k] * sanitizeEventCount(events[k]), 0);

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
