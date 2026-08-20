// ============================================================
// RMPG Flex — Map Density Mode
// The Map tab serves a dispatcher on a desktop (wants 55 toggles
// dense) and an officer on a Toughbook touchscreen (needs 44px
// targets, gloves, moving vehicle) from the SAME components.
// Density is therefore an explicit mode, not a `lg:` breakpoint:
// the desktop dock and the mobile bottom tray both read it, so
// they can never drift apart in sizing again.
// ============================================================

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { loadMapPref, saveMapPref } from '../../../utils/mapPreferences';

export type MapDensity = 'compact' | 'touch';

export interface MapDensityTokens {
  /** Vertical padding utility for a toggle row. */
  rowPaddingY: string;
  /** Minimum row height — 44px in touch mode is the glove/target floor. */
  rowMinHeight: string;
  /** Label font size. */
  labelSize: string;
  /** Leading icon edge length in px. */
  iconPx: number;
}

export const DENSITY_TOKENS: Record<MapDensity, MapDensityTokens> = {
  compact: { rowPaddingY: '0.375rem', rowMinHeight: '24px', labelSize: '11px', iconPx: 14 },
  touch:   { rowPaddingY: '0.625rem', rowMinHeight: '44px', labelSize: '13px', iconPx: 18 },
};

/** Raw key; mapPreferences prefixes it to `rmpg_map_density`. */
const DENSITY_PREF_KEY = 'density';

function isDensity(v: unknown): v is MapDensity {
  return v === 'compact' || v === 'touch';
}

function readOverride(): MapDensity | null {
  const stored = loadMapPref(DENSITY_PREF_KEY);
  return isDensity(stored) ? stored : null;
}

/** Coarse pointer means a touchscreen — Toughbook or phone. */
function pointerDefault(): MapDensity {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'compact';
  return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'compact';
}

interface MapDensityValue {
  density: MapDensity;
  tokens: MapDensityTokens;
  override: MapDensity | null;
  setOverride: (d: MapDensity | null) => void;
}

const MapDensityContext = createContext<MapDensityValue | null>(null);

export function MapDensityProvider({
  children,
  initialOverride,
}: {
  children: ReactNode;
  initialOverride?: MapDensity | null;
}) {
  const [override, setOverrideState] = useState<MapDensity | null>(
    () => initialOverride ?? readOverride(),
  );

  const setOverride = useCallback((d: MapDensity | null) => {
    setOverrideState(d);
    saveMapPref(DENSITY_PREF_KEY, d);
  }, []);

  const value = useMemo<MapDensityValue>(() => {
    const density = override ?? pointerDefault();
    return { density, tokens: DENSITY_TOKENS[density], override, setOverride };
  }, [override, setOverride]);

  return <MapDensityContext.Provider value={value}>{children}</MapDensityContext.Provider>;
}

/**
 * Falls back to compact outside a provider rather than throwing, so a dock
 * component rendered in an isolated test or a non-map surface still works.
 */
export function useMapDensity(): MapDensityValue {
  const ctx = useContext(MapDensityContext);
  if (ctx) return ctx;
  return {
    density: 'compact',
    tokens: DENSITY_TOKENS.compact,
    override: null,
    setOverride: () => {},
  };
}
