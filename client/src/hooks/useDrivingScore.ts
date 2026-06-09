// ============================================================
// useDrivingScore — session driving-events summary from g-force samples
//
// Consumes live longitudinal/lateral g-force samples (e.g. derived from
// accelerometer or speed deltas elsewhere) and rolls up a session summary:
// peak forces, hard-brake / hard-accel event counts, and a 0–100 smoothness
// score. Pure derived state with an event-debounce so one hard stop counts
// as one event, not a burst.
//
// Conventions: longG > 0 = acceleration, longG < 0 = braking (g units).
// ============================================================

import { useCallback, useRef, useState } from 'react';

export interface GForceSample {
  /** Longitudinal g (forward +, braking -). */
  longG: number;
  /** Lateral g (cornering, sign-agnostic for peak tracking). */
  latG?: number;
  /** Optional sample time (epoch ms); defaults to Date.now(). */
  t?: number;
}

export interface DrivingScore {
  peakLongG: number;
  peakLatG: number;
  hardBrakes: number;
  hardAccels: number;
  /** 0–100, higher = smoother. */
  score: number;
}

export interface UseDrivingScoreOptions {
  /** |longG| at/above this (braking) counts a hard-brake event. Default 0.4g. */
  hardBrakeG?: number;
  /** longG at/above this (accel) counts a hard-accel event. Default 0.35g. */
  hardAccelG?: number;
  /** Min ms between counted events of the same kind (debounce). Default 1500ms. */
  eventDebounceMs?: number;
}

export interface UseDrivingScoreResult extends DrivingScore {
  /** Feed one g-force sample. */
  addSample: (s: GForceSample) => void;
  reset: () => void;
}

const ZERO: DrivingScore = {
  peakLongG: 0,
  peakLatG: 0,
  hardBrakes: 0,
  hardAccels: 0,
  score: 100,
};

function computeScore(d: Omit<DrivingScore, 'score'>): number {
  // Each event chips away; peaks add a smaller continuous penalty.
  const eventPenalty = (d.hardBrakes + d.hardAccels) * 6;
  const peakPenalty = Math.max(0, d.peakLongG - 0.3) * 20 + Math.max(0, d.peakLatG - 0.3) * 20;
  return Math.max(0, Math.min(100, Math.round(100 - eventPenalty - peakPenalty)));
}

export function useDrivingScore(
  options: UseDrivingScoreOptions = {},
): UseDrivingScoreResult {
  const {
    hardBrakeG = 0.4,
    hardAccelG = 0.35,
    eventDebounceMs = 1500,
  } = options;

  const [summary, setSummary] = useState<DrivingScore>(ZERO);
  const lastBrakeAtRef = useRef(-Infinity);
  const lastAccelAtRef = useRef(-Infinity);

  const addSample = useCallback(
    (s: GForceSample) => {
      if (!s || typeof s.longG !== 'number' || !Number.isFinite(s.longG)) return;
      const t = typeof s.t === 'number' && Number.isFinite(s.t) ? s.t : Date.now();
      const latAbs = typeof s.latG === 'number' && Number.isFinite(s.latG) ? Math.abs(s.latG) : 0;
      const longAbs = Math.abs(s.longG);

      let countBrake = false;
      let countAccel = false;

      if (s.longG <= -hardBrakeG && t - lastBrakeAtRef.current >= eventDebounceMs) {
        lastBrakeAtRef.current = t;
        countBrake = true;
      }
      if (s.longG >= hardAccelG && t - lastAccelAtRef.current >= eventDebounceMs) {
        lastAccelAtRef.current = t;
        countAccel = true;
      }

      setSummary((prev) => {
        const base = {
          peakLongG: Math.max(prev.peakLongG, longAbs),
          peakLatG: Math.max(prev.peakLatG, latAbs),
          hardBrakes: prev.hardBrakes + (countBrake ? 1 : 0),
          hardAccels: prev.hardAccels + (countAccel ? 1 : 0),
        };
        return { ...base, score: computeScore(base) };
      });
    },
    [hardBrakeG, hardAccelG, eventDebounceMs],
  );

  const reset = useCallback(() => {
    lastBrakeAtRef.current = -Infinity;
    lastAccelAtRef.current = -Infinity;
    setSummary(ZERO);
  }, []);

  return { ...summary, addSample, reset };
}

export default useDrivingScore;
