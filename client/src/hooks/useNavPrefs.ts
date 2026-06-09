// ============================================================
// useNavPrefs — single source of truth for Drive Mode preferences
//
// Owns ALL persisted Drive Mode prefs in ONE versioned JSON blob under
// localStorage 'rmpg-nav-prefs'. Self-contained: every type, default,
// merge rule, and the debounced writer live in this file.
//
// Hardening:
//   • SSR-safe (window/localStorage guarded — returns defaults under SSR)
//   • try/catch JSON.parse → falls back to DEFAULTS on corrupt blob
//   • unknown keys in the stored blob are ignored
//   • missing keys are filled from DEFAULTS (forward-compatible migrations)
//   • writes are debounced 150ms (rapid setPref bursts collapse to one write)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

const LS_KEY = 'rmpg-nav-prefs';
const PREFS_VERSION = 1;
const WRITE_DEBOUNCE_MS = 150;

export type NavUnits = 'imperial' | 'metric';
export type NavClock = '12h' | '24h';
export type NavTheme = 'day' | 'night' | 'auto';
export type NavMapOrientation = 'north-up' | 'heading-up';

export interface NavLayerPrefs {
  crime: boolean;
  crash: boolean;
  trail: boolean;
  inset: boolean;
}

export interface NavPrefs {
  units: NavUnits;
  clock: NavClock;
  theme: NavTheme;
  mapOrientation: NavMapOrientation;
  /** 0..1 master alert/voice volume. */
  volume: number;
  /** 0..1 screen brightness scrim. */
  brightness: number;
  layers: NavLayerPrefs;
  alertsOn: boolean;
}

export const DEFAULT_NAV_PREFS: NavPrefs = {
  units: 'imperial',
  clock: '12h',
  theme: 'auto',
  mapOrientation: 'heading-up',
  volume: 0.8,
  brightness: 1,
  layers: { crime: true, crash: true, trail: true, inset: false },
  alertsOn: true,
};

interface StoredBlob {
  v: number;
  prefs: Partial<NavPrefs>;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const clamp01 = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/**
 * Merge an arbitrary (possibly partial / corrupt) prefs object onto DEFAULTS.
 * Unknown keys are dropped; missing keys are filled; values are type-checked.
 */
function coercePrefs(raw: unknown): NavPrefs {
  if (!isObj(raw)) return { ...DEFAULT_NAV_PREFS, layers: { ...DEFAULT_NAV_PREFS.layers } };
  const d = DEFAULT_NAV_PREFS;
  const layersRaw = isObj(raw.layers) ? raw.layers : {};
  return {
    units: raw.units === 'metric' || raw.units === 'imperial' ? raw.units : d.units,
    clock: raw.clock === '12h' || raw.clock === '24h' ? raw.clock : d.clock,
    theme:
      raw.theme === 'day' || raw.theme === 'night' || raw.theme === 'auto'
        ? raw.theme
        : d.theme,
    mapOrientation:
      raw.mapOrientation === 'north-up' || raw.mapOrientation === 'heading-up'
        ? raw.mapOrientation
        : d.mapOrientation,
    volume: clamp01(raw.volume, d.volume),
    brightness: clamp01(raw.brightness, d.brightness),
    layers: {
      crime: typeof layersRaw.crime === 'boolean' ? layersRaw.crime : d.layers.crime,
      crash: typeof layersRaw.crash === 'boolean' ? layersRaw.crash : d.layers.crash,
      trail: typeof layersRaw.trail === 'boolean' ? layersRaw.trail : d.layers.trail,
      inset: typeof layersRaw.inset === 'boolean' ? layersRaw.inset : d.layers.inset,
    },
    alertsOn: typeof raw.alertsOn === 'boolean' ? raw.alertsOn : d.alertsOn,
  };
}

function loadPrefs(): NavPrefs {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_NAV_PREFS, layers: { ...DEFAULT_NAV_PREFS.layers } };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw == null) return { ...DEFAULT_NAV_PREFS, layers: { ...DEFAULT_NAV_PREFS.layers } };
    const parsed = JSON.parse(raw) as Partial<StoredBlob>;
    // Accept both the versioned blob and a bare prefs object (forward-compat).
    const prefsRaw = isObj(parsed) && 'prefs' in parsed ? parsed.prefs : parsed;
    return coercePrefs(prefsRaw);
  } catch {
    return { ...DEFAULT_NAV_PREFS, layers: { ...DEFAULT_NAV_PREFS.layers } };
  }
}

export type NavPrefKey = keyof NavPrefs;

export interface UseNavPrefsResult {
  0: NavPrefs;
  1: <K extends NavPrefKey>(key: K, value: NavPrefs[K]) => void;
  2: () => void;
}

/**
 * @returns `[prefs, setPref, resetPrefs]`
 */
export function useNavPrefs(): [
  NavPrefs,
  <K extends NavPrefKey>(key: K, value: NavPrefs[K]) => void,
  () => void,
] {
  const [prefs, setPrefs] = useState<NavPrefs>(() => loadPrefs());
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<NavPrefs>(prefs);

  const scheduleWrite = useCallback((next: NavPrefs) => {
    pendingRef.current = next;
    if (typeof window === 'undefined') return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      try {
        const blob: StoredBlob = { v: PREFS_VERSION, prefs: pendingRef.current };
        window.localStorage.setItem(LS_KEY, JSON.stringify(blob));
      } catch {
        /* quota / private mode — ignore */
      }
    }, WRITE_DEBOUNCE_MS);
  }, []);

  const setPref = useCallback(
    <K extends NavPrefKey>(key: K, value: NavPrefs[K]) => {
      setPrefs((prev) => {
        const next: NavPrefs = { ...prev, [key]: value };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const resetPrefs = useCallback(() => {
    const fresh: NavPrefs = { ...DEFAULT_NAV_PREFS, layers: { ...DEFAULT_NAV_PREFS.layers } };
    setPrefs(fresh);
    scheduleWrite(fresh);
  }, [scheduleWrite]);

  // Flush any pending debounced write on unmount so a fast navigate-away
  // (the common Drive Mode exit) doesn't drop the last change.
  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
        if (typeof window !== 'undefined') {
          try {
            const blob: StoredBlob = { v: PREFS_VERSION, prefs: pendingRef.current };
            window.localStorage.setItem(LS_KEY, JSON.stringify(blob));
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, []);

  return [prefs, setPref, resetPrefs];
}

export default useNavPrefs;
