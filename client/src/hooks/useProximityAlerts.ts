// ============================================================
// useProximityAlerts — one home for Drive Mode proximity tones
//
// Consolidates the four Drive Mode alert triggers behind a single hook:
//   • P1/P2 active call within range
//   • high-crime cluster ahead
//   • crash-prone segment ahead
//   • destination approach (within N meters of route end)
//
// Each type can be individually muted, and a GLOBAL cooldown enforces at
// most one tone per N seconds so the cab doesn't turn into a slot machine.
// Returns the transient `navAlert` (for an on-screen banner) and plays a
// short tone via a self-contained Web Audio helper (no-op when unsupported).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

export type NavAlertType = 'priority-call' | 'high-crime' | 'crash-prone' | 'destination';

export interface NavAlert {
  type: NavAlertType;
  label: string;
  /** Epoch ms the alert fired. */
  at: number;
}

export interface ProximityInputs {
  /** True when a P1/P2 call is within the configured radius. */
  priorityCallNear?: boolean;
  priorityCallLabel?: string;
  /** True when a high-crime cluster is ahead. */
  highCrimeAhead?: boolean;
  highCrimeLabel?: string;
  /** True when a crash-prone segment is ahead. */
  crashProneAhead?: boolean;
  crashProneLabel?: string;
  /** True when within destination-approach range. */
  destinationApproaching?: boolean;
  destinationLabel?: string;
}

export interface ProximityEnableConfig {
  'priority-call'?: boolean;
  'high-crime'?: boolean;
  'crash-prone'?: boolean;
  destination?: boolean;
}

export interface UseProximityAlertsOptions {
  enabled?: boolean;
  perType?: ProximityEnableConfig;
  /** Minimum seconds between any two tones. Default 8s. */
  cooldownSeconds?: number;
  /** 0..1 tone volume. Default 0.6. */
  volume?: number;
}

export interface UseProximityAlertsResult {
  navAlert: NavAlert | null;
  /** Manually clear the on-screen alert banner. */
  clear: () => void;
}

// Distinct tone characters per type — frequency + duration (ms).
const TONE_SPEC: Record<NavAlertType, { freq: number; ms: number }> = {
  'priority-call': { freq: 880, ms: 380 },
  'high-crime': { freq: 660, ms: 260 },
  'crash-prone': { freq: 520, ms: 260 },
  destination: { freq: 760, ms: 200 },
};

let sharedCtx: AudioContext | null = null;

/** Self-contained tone player. Returns false (no-op) when audio is unavailable. */
export function playNavTone(type: NavAlertType, volume = 0.6): boolean {
  if (typeof window === 'undefined') return false;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return false;
  try {
    if (!sharedCtx) sharedCtx = new Ctor();
    const ctx = sharedCtx!;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const spec = TONE_SPEC[type];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const vol = Math.min(1, Math.max(0, volume));
    osc.type = 'sine';
    osc.frequency.value = spec.freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + spec.ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + spec.ms / 1000 + 0.02);
    return true;
  } catch {
    return false;
  }
}

export function useProximityAlerts(
  inputs: ProximityInputs,
  options: UseProximityAlertsOptions = {},
): UseProximityAlertsResult {
  const { enabled = true, perType, cooldownSeconds = 8, volume = 0.6 } = options;
  const [navAlert, setNavAlert] = useState<NavAlert | null>(null);
  // -Infinity, not 0: a never-fired alert must NOT count as "fired at epoch 0",
  // or the cooldown guard (now - last < window) wrongly suppresses the very first
  // tone whenever the clock is within `cooldown` of 0 (real near-boot edge; also
  // what made the unit test see 0 tones).
  const lastToneAtRef = useRef(Number.NEGATIVE_INFINITY);
  // Track per-type rising edges so a sustained condition fires once.
  const prevActiveRef = useRef<Record<NavAlertType, boolean>>({
    'priority-call': false,
    'high-crime': false,
    'crash-prone': false,
    destination: false,
  });

  const clear = useCallback(() => setNavAlert(null), []);

  const typeEnabled = useCallback(
    (t: NavAlertType): boolean => {
      if (!perType) return true;
      const v = perType[t];
      return v !== false; // default-on unless explicitly disabled
    },
    [perType],
  );

  useEffect(() => {
    if (!enabled) return;

    // Priority order: highest urgency first.
    const candidates: Array<{ type: NavAlertType; active: boolean; label: string }> = [
      {
        type: 'priority-call',
        active: !!inputs.priorityCallNear,
        label: inputs.priorityCallLabel || 'Priority call nearby',
      },
      {
        type: 'crash-prone',
        active: !!inputs.crashProneAhead,
        label: inputs.crashProneLabel || 'Crash-prone segment ahead',
      },
      {
        type: 'high-crime',
        active: !!inputs.highCrimeAhead,
        label: inputs.highCrimeLabel || 'High-crime area ahead',
      },
      {
        type: 'destination',
        active: !!inputs.destinationApproaching,
        label: inputs.destinationLabel || 'Approaching destination',
      },
    ];

    const prev = prevActiveRef.current;
    let fired = false;

    for (const c of candidates) {
      const rising = c.active && !prev[c.type];
      prev[c.type] = c.active;
      if (fired || !rising) continue;
      if (!typeEnabled(c.type)) continue;

      const now = Date.now();
      if (now - lastToneAtRef.current < cooldownSeconds * 1000) {
        // Within cooldown — show the banner but suppress the tone.
        setNavAlert({ type: c.type, label: c.label, at: now });
        fired = true;
        continue;
      }
      lastToneAtRef.current = now;
      playNavTone(c.type, volume);
      setNavAlert({ type: c.type, label: c.label, at: now });
      fired = true;
    }
  }, [
    enabled,
    cooldownSeconds,
    volume,
    typeEnabled,
    inputs.priorityCallNear,
    inputs.priorityCallLabel,
    inputs.highCrimeAhead,
    inputs.highCrimeLabel,
    inputs.crashProneAhead,
    inputs.crashProneLabel,
    inputs.destinationApproaching,
    inputs.destinationLabel,
  ]);

  return { navAlert, clear };
}

export default useProximityAlerts;
