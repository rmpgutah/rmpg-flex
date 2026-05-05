// ============================================================
// useDriveMode — auto-engaging in-vehicle UX mode
//
// Watches GPS speed from useGpsTracking and toggles a "drive mode"
// flag when the officer is sustained-moving at vehicle speeds.
// Components that subscribe morph their UI for hands-free use:
//   • larger touch targets
//   • shorter hold-to-open gestures
//   • mic auto-loop after dialogue replies
//   • TTS-first feedback (text becomes a fallback surface)
//
// Engagement is intentionally suggestive, not destructive — every
// drive-mode UI change is reversible by tapping the chip, and no
// background actions auto-fire (no calls dispatched, no Code 3 sent,
// no panic, no pursuit). The mode only changes how INPUT and OUTPUT
// surfaces are rendered.
//
// Detection thresholds:
//   ENGAGE: speed > 13 m/s (~30 mph) sustained ≥ 5 seconds
//   DISENGAGE: speed < 4 m/s (~9 mph) sustained ≥ 30 seconds
// Manual override (driver tapped chip) wins over auto-detection.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { useGpsTracking } from './useGpsTracking';

const ENGAGE_SPEED_MS = 13;       // ~30 mph
const ENGAGE_SUSTAIN_MS = 5_000;
const DISENGAGE_SPEED_MS = 4;     // ~9 mph
const DISENGAGE_SUSTAIN_MS = 30_000;

const LS_MANUAL_OVERRIDE = 'rmpg-drive-mode-override';

type ManualOverride = 'on' | 'off' | null;

export interface UseDriveModeResult {
  /** True when drive-mode UX is engaged (auto OR manual). */
  active: boolean;
  /** Current GPS speed in m/s (null if unavailable). */
  speedMs: number | null;
  /** Current GPS speed in mph (rounded; null if unavailable). */
  speedMph: number | null;
  /** Whether engagement was driven by a manual tap (vs auto-detection). */
  manuallyOverridden: boolean;
  /** Manually engage drive mode (e.g. before pulling out of the lot). */
  forceOn: () => void;
  /** Manually disengage drive mode (e.g. parking, foot patrol). */
  forceOff: () => void;
  /** Clear manual override and let auto-detection drive again. */
  clearOverride: () => void;
}

function loadOverride(): ManualOverride {
  try {
    const v = localStorage.getItem(LS_MANUAL_OVERRIDE);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function saveOverride(v: ManualOverride): void {
  try {
    if (v === null) localStorage.removeItem(LS_MANUAL_OVERRIDE);
    else localStorage.setItem(LS_MANUAL_OVERRIDE, v);
  } catch { /* ignore */ }
}

export function useDriveMode(): UseDriveModeResult {
  const gps = useGpsTracking();
  const [autoActive, setAutoActive] = useState(false);
  const [override, setOverride] = useState<ManualOverride>(() => loadOverride());

  // Sustained-state timers
  const aboveSinceRef = useRef<number | null>(null);
  const belowSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const speed = gps.speed;
    const now = Date.now();

    // Speed unavailable — don't change state
    if (speed == null) {
      aboveSinceRef.current = null;
      belowSinceRef.current = null;
      return;
    }

    if (speed >= ENGAGE_SPEED_MS) {
      // Above engage threshold — start (or continue) the engage timer
      if (aboveSinceRef.current == null) aboveSinceRef.current = now;
      belowSinceRef.current = null;
      if (!autoActive && now - aboveSinceRef.current >= ENGAGE_SUSTAIN_MS) {
        setAutoActive(true);
      }
    } else if (speed <= DISENGAGE_SPEED_MS) {
      // Below disengage threshold — start (or continue) the disengage timer
      if (belowSinceRef.current == null) belowSinceRef.current = now;
      aboveSinceRef.current = null;
      if (autoActive && now - belowSinceRef.current >= DISENGAGE_SUSTAIN_MS) {
        setAutoActive(false);
      }
    } else {
      // In the dead zone (4–13 m/s, ~9–30 mph) — neither timer advances.
      // Preserves drive mode through stop signs / city traffic dips.
      aboveSinceRef.current = null;
      belowSinceRef.current = null;
    }
  }, [gps.speed, autoActive]);

  const forceOn = useCallback(() => {
    setOverride('on');
    saveOverride('on');
  }, []);

  const forceOff = useCallback(() => {
    setOverride('off');
    saveOverride('off');
  }, []);

  const clearOverride = useCallback(() => {
    setOverride(null);
    saveOverride(null);
  }, []);

  const active = override === 'on' ? true : override === 'off' ? false : autoActive;
  const speedMs = gps.speed ?? null;
  const speedMph = speedMs != null ? Math.round(speedMs * 2.23694) : null;

  return {
    active,
    speedMs,
    speedMph,
    manuallyOverridden: override !== null,
    forceOn,
    forceOff,
    clearOverride,
  };
}
