// ============================================================
// RMPG Flex — useMapProvider Hook
// ============================================================
// React hook that detects and initializes the appropriate map
// engine based on configured tokens. Provides a unified interface
// for the MapPage and other map consumers.
//
// Priority: Mapbox GL → MapLibre GL
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { detectMapEngine, resetMapEngine, getAvailableEngines, type MapEngine } from '../../../utils/mapProvider';
import { devLog } from '../../../utils/devLog';

export interface UseMapProviderResult {
  /** Currently active map engine */
  engine: MapEngine | null;
  /** Whether engine detection is in progress */
  detecting: boolean;
  /** All engines with valid tokens */
  availableEngines: MapEngine[];
  /** Switch to a different engine */
  switchEngine: (engine: MapEngine) => void;
  /** Force re-detection of available engines */
  refresh: () => void;
  /** Error during detection */
  error: string | null;
}

export function useMapProvider(): UseMapProviderResult {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [availableEngines, setAvailableEngines] = useState<MapEngine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    setDetecting(true);
    setError(null);

    try {
      const [detected, available] = await Promise.all([
        detectMapEngine(),
        getAvailableEngines(),
      ]);

      devLog('[MapProvider] Detected engine:', detected, '| Available:', available);
      setEngine(detected);
      setAvailableEngines(available);
    } catch (err: any) {
      devLog('[MapProvider] Detection failed:', err);
      setError(err?.message || 'Failed to detect map engine');
      // Always fall back to maplibre
      setEngine('maplibre');
      setAvailableEngines(['maplibre']);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    detect();
  }, [detect]);

  const switchEngine = useCallback((newEngine: MapEngine) => {
    devLog('[MapProvider] Switching to engine:', newEngine);
    setEngine(newEngine);
  }, []);

  const refresh = useCallback(() => {
    resetMapEngine();
    detect();
  }, [detect]);

  return {
    engine,
    detecting,
    availableEngines,
    switchEngine,
    refresh,
    error,
  };
}
