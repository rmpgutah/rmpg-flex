// ============================================================
// Trip replay — pure playback-position logic for the Movement Report
// drawer's "replay this trip" control. Given the already-fetched
// breadcrumb track and an elapsed-playback clock, figures out which
// point the scrubber/marker should currently be showing. No fetching,
// no DOM, no React — framework-free so it's trivially unit-testable.
// ============================================================

import { parseTimestamp } from '../../utils/dateUtils';

export interface ReplayPoint {
  lat: number;
  lng: number;
  time: string; // ISO
  speed: number | null;
  heading: number | null;
}

/** Given elapsed playback ms and a speed multiplier, find which point index
 *  the replay should currently be showing (points are chronological). */
export function replayIndexAt(points: ReplayPoint[], elapsedMs: number, speedMultiplier: number): number {
  if (points.length === 0) return 0;
  const startMs = parseTimestamp(points[0].time).getTime();
  const targetMs = startMs + elapsedMs * speedMultiplier;
  let idx = 0;
  for (let i = 0; i < points.length; i++) {
    if (parseTimestamp(points[i].time).getTime() <= targetMs) idx = i;
    else break;
  }
  return idx;
}

export function replayDurationMs(points: ReplayPoint[]): number {
  if (points.length < 2) return 0;
  return parseTimestamp(points[points.length - 1].time).getTime() - parseTimestamp(points[0].time).getTime();
}
