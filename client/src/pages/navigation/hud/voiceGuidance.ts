// ============================================================
// RMPG Flex — Turn-by-Turn Voice Guidance Cadence
// Pure distance-threshold decision logic for when to speak the
// current maneuver. Speaking itself is delegated to the existing
// dispatch-narrative TTS pipeline (announceManeuver in
// client/src/utils/voiceAlerts.ts), which already owns voice
// selection, the global voice-alerts toggle, and queuing — this
// module intentionally does NOT reimplement any of that.
// ============================================================

export interface Maneuver {
  instruction: string; // e.g. "Turn right on Main Street"
  distanceMetersRemaining: number;
}

// 1mi, 0.5mi, 0.25mi, "now" (~100ft)
const ANNOUNCE_THRESHOLDS_M = [1609, 805, 402, 30];

/**
 * Given the current maneuver and which thresholds have already been
 * announced for it, decide whether to announce now and at which
 * threshold (so the caller can mark it announced and avoid repeating).
 * Returns the SMALLEST un-announced threshold that's been crossed, so a
 * caller polling infrequently (or catching up after a gap) still speaks
 * only once per threshold rather than replaying every crossed one.
 */
export function nextAnnouncement(
  maneuver: Maneuver,
  alreadyAnnounced: Set<number>,
): { thresholdM: number; text: string } | null {
  for (const t of ANNOUNCE_THRESHOLDS_M) {
    if (maneuver.distanceMetersRemaining <= t && !alreadyAnnounced.has(t)) {
      const distancePhrase =
        t === 30 ? 'now' :
        t === 402 ? 'in a quarter mile' :
        t === 805 ? 'in half a mile' :
        'in one mile';
      return { thresholdM: t, text: `${maneuver.instruction} ${distancePhrase}` };
    }
  }
  return null;
}
