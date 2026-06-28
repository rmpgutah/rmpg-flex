// ============================================================
// RMPG Flex — Map Provider Abstraction Layer
// ============================================================
// Mapbox GL JS is the mandatory map engine. MapLibre GL serves
// as a free fallback when no Mapbox access token is configured.
// Google Maps has been fully removed from the system.
//
// Provider priority:
//   1. Mapbox GL JS — if Mapbox access token is configured
//   2. MapLibre GL — free fallback, no API key required
// ============================================================

import { getMapboxToken, hasMapboxToken } from './mapboxApiKey';

// ── Types ─────────────────────────────────────────────────

export type MapEngine = 'mapbox' | 'maplibre';

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
 *   2. MapLibre GL (always available — free, no key)
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
    // 1. Try Mapbox (with timeout to prevent infinite hang)
    try {
      const mapboxToken = await Promise.race([
        getMapboxToken(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (mapboxToken) {
        resolvedEngine = 'mapbox';
        return 'mapbox' as MapEngine;
      }
    } catch {
      // Mapbox not available — try next
    }

    // 2. Fall back to MapLibre (always available)
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

  return engines;
}

/**
 * Check if a specific engine is available.
 */
export function isEngineAvailable(engine: MapEngine): boolean {
  switch (engine) {
    case 'mapbox':
      return hasMapboxToken();
    case 'maplibre':
      return true;
    default:
      return false;
  }
}

// ── Engine Labels ─────────────────────────────────────────

export const MAP_ENGINE_LABELS: Record<MapEngine, string> = {
  mapbox: 'Mapbox GL',
  maplibre: 'MapLibre GL',
};

export const MAP_ENGINE_DESCRIPTIONS: Record<MapEngine, string> = {
  mapbox: 'High-performance vector tiles with 3D terrain, globe view, and offline support',
  maplibre: 'Open-source vector tiles — free, no API key required',
};
