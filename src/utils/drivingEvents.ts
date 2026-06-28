// ============================================================
// RMPG Flex — Driving-event normalization (pure helpers)
// ============================================================
// The Dashcam AI Console (client/src/pages/DashcamAiPage.tsx) speaks a
// normalized `DrivingEvent` shape with a fixed event-type + severity enum.
// ClearPath dashcam events arrive as free-text labels ("Automatic, Frontal
// Collision Warning", "Lane Departure", …); these pure helpers map them into
// the console's enum so the existing UI lights up. Unit-tested.
// ============================================================

export type DrivingEventType =
  | 'hard_brake' | 'hard_accel' | 'hard_turn' | 'fcw' | 'ldw' | 'tailgate'
  | 'drowsy' | 'distracted' | 'speeding' | 'impact' | 'sos'
  | 'ignition_on' | 'ignition_off' | 'custom';

export type DrivingSeverity = 'info' | 'warning' | 'alert' | 'critical';

/** Classify a raw provider event label into the console's (type, severity).
 *  Order matters — most-specific / highest-severity checks first. */
export function classifyDrivingEvent(raw: string | null | undefined): { type: DrivingEventType; severity: DrivingSeverity } {
  const s = (raw || '').toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => s.includes(k));

  if (has('impact', 'crash', 'collision detected', 'accident')) return { type: 'impact', severity: 'critical' };
  if (has('sos', 'panic', 'emergency')) return { type: 'sos', severity: 'critical' };
  if (has('frontal collision', 'forward collision', 'fcw', 'collision warning')) return { type: 'fcw', severity: 'alert' };
  if (has('distract', 'phone', 'cell')) return { type: 'distracted', severity: 'alert' };
  if (has('drowsy', 'fatigue', 'yawn', 'eyes closed')) return { type: 'drowsy', severity: 'alert' };
  if (has('lane depart', 'lane drift', 'ldw')) return { type: 'ldw', severity: 'warning' };
  if (has('close follow', 'tailgat', 'following distance', 'headway')) return { type: 'tailgate', severity: 'warning' };
  if (has('hard brake', 'harsh brake', 'sudden brake')) return { type: 'hard_brake', severity: 'warning' };
  if (has('hard accel', 'harsh accel', 'rapid accel')) return { type: 'hard_accel', severity: 'warning' };
  if (has('hard turn', 'harsh corner', 'sharp turn')) return { type: 'hard_turn', severity: 'warning' };
  if (has('speed', 'overspeed')) return { type: 'speeding', severity: 'warning' };
  if (has('ignition on', 'power on', 'engine start')) return { type: 'ignition_on', severity: 'info' };
  if (has('ignition off', 'power off', 'engine stop')) return { type: 'ignition_off', severity: 'info' };
  return { type: 'custom', severity: 'info' };
}

/** Health status of a fleet device from its last-seen timestamp.
 *  healthy < staleMs ≤ stale < downMs ≤ down. */
export function fleetStatusFor(lastSeenMs: number | null, nowMs: number, staleMs = 10 * 60_000, downMs = 60 * 60_000): 'healthy' | 'stale' | 'down' {
  if (lastSeenMs == null || !Number.isFinite(lastSeenMs)) return 'down';
  const age = nowMs - lastSeenMs;
  if (age <= staleMs) return 'healthy';
  if (age <= downMs) return 'stale';
  return 'down';
}
