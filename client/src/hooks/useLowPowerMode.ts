// ============================================================
// useLowPowerMode — reduced-motion / battery-saver resolution for Drive Mode
//
// Combines the OS `prefers-reduced-motion` media query with a persisted
// (or passed-in) lowPower preference. When low-power resolves true the page
// should snap camera moves (easeDurationMs → 0) and pause pulse animations.
//
// SSR-safe: matchMedia is feature-detected; absent it defaults to
// motion-enabled. The persisted flag lives under 'rmpg-nav-lowpower'.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'rmpg-nav-lowpower';

export interface UseLowPowerModeOptions {
  /**
   * Explicit override from a higher-level prefs object (e.g. NavPrefs.lowPower).
   * When provided it wins over the persisted flag; when undefined the hook
   * reads/writes its own persisted flag.
   */
  preference?: boolean;
  /** Camera ease duration when motion IS allowed (ms). Default 600. */
  normalEaseMs?: number;
}

export interface UseLowPowerModeResult {
  lowPower: boolean;
  /** 0 when low-power (snap), else `normalEaseMs`. */
  easeDurationMs: number;
  /** Inverse of lowPower — convenience for pulse/animation gating. */
  animationsEnabled: boolean;
  /** Toggle the persisted flag (no-op effect when `preference` is controlled). */
  setLowPower: (v: boolean) => void;
}

function readPersisted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useLowPowerMode(
  options: UseLowPowerModeOptions = {},
): UseLowPowerModeResult {
  const { preference, normalEaseMs = 600 } = options;
  const controlled = typeof preference === 'boolean';

  const [persisted, setPersisted] = useState<boolean>(() => readPersisted());
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());

  // React to OS reduced-motion changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const onChange = () => setReduced(mql.matches);
    setReduced(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Legacy Safari.
    if (typeof (mql as any).addListener === 'function') {
      (mql as any).addListener(onChange);
      return () => (mql as any).removeListener(onChange);
    }
    return;
  }, []);

  const setLowPower = useCallback((v: boolean) => {
    setPersisted(v);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const prefFlag = controlled ? (preference as boolean) : persisted;
  const lowPower = reduced || prefFlag;

  return {
    lowPower,
    easeDurationMs: lowPower ? 0 : normalEaseMs,
    animationsEnabled: !lowPower,
    setLowPower,
  };
}

export default useLowPowerMode;
