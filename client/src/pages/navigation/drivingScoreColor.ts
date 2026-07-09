/** Shared good/caution/bad color mapping for harsh-driving-event counts.
 *  Used by HudDrivingScore (live HUD chip) and NavPage's driving-score
 *  trend chart — previously two independent copies of the same thresholds. */
export function harshEventColor(totalEvents: number): string {
  return totalEvents >= 6 ? '#ef4444' : totalEvents >= 2 ? '#f59e0b' : '#22c55e';
}
