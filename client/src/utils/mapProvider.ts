// ============================================================
// RMPG Flex — Map Provider Abstraction Layer
// ============================================================
// Unified interface for map engines (Mapbox GL JS primary,
// Google Maps fallback). All map consumers should reference
// this abstraction so the underlying engine can be swapped
// at runtime based on configuration and token availability.
//
// Provider priority:
//   1. Mapbox GL JS — if Mapbox access token is configured
//   2. Google Maps — if Google Maps API key is configured
//   3. MapLibre GL — free fallback, no API key required
// ============================================================

import { getMapboxToken, hasMapboxToken } from './mapboxApiKey';
import { getGoogleMapsApiKey } from './googleMapsApiKey';

// ── Types ─────────────────────────────────────────────────

export type MapEngine = 'mapbox' | 'google' | 'maplibre';

export interface MapProviderConfig {
  /** Preferred engine. If null, auto-detect based on token availability. */
  preferredEngine?: MapEngine | null;
  /** Skip fallback detection — use only the preferred engine. */
  strict?: boolean;
}

export interface MapProviderStatus {
  /** Active engine being used */
  engine: MapEngine;
  /** Whether the engine is fully loaded and ready */
  ready: boolean;
  /** Error message if initialization failed */
  error?: string;
  /** Whether a token/key is configured for the active engine */
  hasToken: boolean;
  /** All available engines (ones with valid tokens) */
  availableEngines: MapEngine[];
}

// ── Provider Detection ────────────────────────────────────

let resolvedEngine: MapEngine | null = null;
let detectionPromise: Promise<MapEngine> | null = null;

/**
 * Detect the best available map engine based on configured tokens.
 * Caches the result for subsequent calls.
 *
 * Priority:
 *   1. Mapbox GL JS (if mapbox_api_key configured in Admin → Integrations)
 *   2. Google Maps (if Google Maps API key configured)
 *   3. MapLibre GL (always available — free, no key)
 */
export async function detectMapEngine(config?: MapProviderConfig): Promise<MapEngine> {
  // Honor explicit preference
  if (config?.preferredEngine) {
    resolvedEngine = config.preferredEngine;
    return resolvedEngine;
  }

  // Return cached result
  if (resolvedEngine) return resolvedEngine;

  // Avoid duplicate detection
  if (detectionPromise) return detectionPromise;

  detectionPromise = (async () => {
    // 1. Try Mapbox
    try {
      const mapboxToken = await getMapboxToken();
      if (mapboxToken) {
        resolvedEngine = 'mapbox';
        return 'mapbox' as MapEngine;
      }
    } catch {
      // Mapbox not available — try next
    }

    // 2. Try Google Maps
    try {
      const gmapsKey = await getGoogleMapsApiKey();
      if (gmapsKey) {
        resolvedEngine = 'google';
        return 'google' as MapEngine;
      }
    } catch {
      // Google Maps not available — try next
    }

    // 3. Fall back to MapLibre (always available)
    resolvedEngine = 'maplibre';
    return 'maplibre' as MapEngine;
  })().finally(() => {
    detectionPromise = null;
  });

  return detectionPromise;
}

/**
 * Get the currently resolved engine (returns null if detection hasn't run).
 */
export function getResolvedEngine(): MapEngine | null {
  return resolvedEngine;
}

/**
 * Force re-detection of the map engine (e.g., after admin changes a key).
 */
export function resetMapEngine(): void {
  resolvedEngine = null;
  detectionPromise = null;
}

/**
 * Get all available map engines based on current token state.
 */
export async function getAvailableEngines(): Promise<MapEngine[]> {
  const engines: MapEngine[] = ['maplibre']; // Always available

  try {
    const mapboxToken = await getMapboxToken();
    if (mapboxToken) engines.unshift('mapbox');
  } catch { /* skip */ }

  try {
    const gmapsKey = await getGoogleMapsApiKey();
    if (gmapsKey) {
      // Insert after mapbox but before maplibre
      const idx = engines.indexOf('maplibre');
      engines.splice(idx, 0, 'google');
    }
  } catch { /* skip */ }

  return engines;
}

/**
 * Check if a specific engine is available.
 */
export function isEngineAvailable(engine: MapEngine): boolean {
  switch (engine) {
    case 'mapbox':
      return hasMapboxToken();
    case 'google':
      // Can't synchronously check — need the key fetch. This is a best-effort check.
      return typeof google !== 'undefined' && !!google?.maps;
    case 'maplibre':
      return true;
    default:
      return false;
  }
}

// ── Engine Labels ─────────────────────────────────────────

export const MAP_ENGINE_LABELS: Record<MapEngine, string> = {
  mapbox: 'Mapbox GL',
  google: 'Google Maps',
  maplibre: 'MapLibre GL',
};

export const MAP_ENGINE_DESCRIPTIONS: Record<MapEngine, string> = {
  mapbox: 'High-performance vector tiles with 3D terrain, globe view, and offline support',
  google: 'Comprehensive mapping with Street View, traffic, and Places autocomplete',
  maplibre: 'Open-source vector tiles — free, no API key required',
};
