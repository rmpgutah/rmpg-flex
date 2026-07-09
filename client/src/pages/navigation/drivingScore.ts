export interface HarshCounts {
  harsh_accel_count: number;
  harsh_brake_count: number;
  harsh_corner_count: number;
}

/** 100 minus a per-event penalty, floored at 0. Matches HudInstruments.tsx's
 *  HudDrivingScore color thresholds: 0-1 events = good, 2-5 = caution, 6+ = bad. */
export function tripDrivingScore(counts: HarshCounts): number {
  const total = counts.harsh_accel_count + counts.harsh_brake_count + counts.harsh_corner_count;
  return Math.max(0, 100 - total * 8);
}
