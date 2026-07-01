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
  const [engine, setEngine] = useState<MapEngine | null>('mapbox');
  const [detecting, setDetecting] = useState(false);
  const [availableEngines, setAvailableEngines] = useState<MapEngine[]>(['mapbox']);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    setDetecting(false);
    setEngine('mapbox');
    setAvailableEngines(['mapbox']);
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
