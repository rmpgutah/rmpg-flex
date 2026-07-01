// ============================================================
// RMPG Flex — Map Provider Abstraction Layer
// ============================================================
// Mapbox GL JS is the mandatory and only map engine.
// Google Maps and MapLibre GL have been fully removed.
// ============================================================

import { getMapboxToken, hasMapboxToken } from './mapboxApiKey';

// ── Types ─────────────────────────────────────────────────

export type MapEngine = 'mapbox';

export interface MapProviderConfig {
  preferredEngine?: MapEngine | null;
  strict?: boolean;
}

export interface MapProviderStatus {
  engine: MapEngine;
  ready: boolean;
  error?: string;
  hasToken: boolean;
  availableEngines: MapEngine[];
}

// ── Provider Detection ────────────────────────────────────

/**
 * Detect the best available map engine (always returns mapbox).
 */
export async function detectMapEngine(_config?: MapProviderConfig): Promise<MapEngine> {
  return 'mapbox';
}

/**
 * Get the currently resolved engine.
 */
export function getResolvedEngine(): MapEngine | null {
  return 'mapbox';
}

/**
 * Force re-detection of the map engine.
 */
export function resetMapEngine(): void {}

/**
 * Get all available map engines.
 */
export async function getAvailableEngines(): Promise<MapEngine[]> {
  return ['mapbox'];
}

/**
 * Check if a specific engine is available.
 */
export function isEngineAvailable(engine: MapEngine): boolean {
  return engine === 'mapbox' && hasMapboxToken();
}

// ── Engine Labels ─────────────────────────────────────────

export const MAP_ENGINE_LABELS: Record<MapEngine, string> = {
  mapbox: 'Mapbox GL',
};

export const MAP_ENGINE_DESCRIPTIONS: Record<MapEngine, string> = {
  mapbox: 'High-performance vector tiles with 3D terrain, globe view, and offline support',
};
