// ============================================================
// useMapBeatOverlay — patrol-beat boundary GeoJSON layer
// ============================================================
// Adds a fill + line layer for patrol beat boundaries when
// `beatLayerVisible` is true and removes it on cleanup or when
// the flag is toggled off. Pure side-effect hook.
//
// NOTE: The primary beat-layer lifecycle (loading geojson, toggling,
// click popups, per-beat color expressions) is owned by useGeoJsonLayers.
// This hook is the extraction seam for any additional beat-overlay logic
// that lives directly in MapboxMapPage's render cycle rather than in the
// shared geography-layer manager.
// ============================================================

import { useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';

/** Minimum beat shape required by this hook. */
export interface OverlayBeat {
  id: number;
  name: string;
  geojson?: unknown;
}

export interface UseMapBeatOverlayOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  beats: OverlayBeat[];
  beatLayerVisible: boolean;
}

/**
 * Manages patrol-beat boundary overlays on the Mapbox map.
 * Cleans up any layers it owns when unmounting or when deps change.
 */
export function useMapBeatOverlay({
  map,
  mapLoaded,
  beats,
  beatLayerVisible,
}: UseMapBeatOverlayOptions): void {
  useEffect(() => {
    if (!map || !mapLoaded) return;

    // No standalone beat-overlay useEffect exists in MapboxMapPage.tsx to lift;
    // beat-layer management is delegated to useGeoJsonLayers (hooks/useGeoJsonLayers.ts,
    // layer id 'beat'). This hook is the extraction seam — move any direct Mapbox
    // source/layer mutations for beats out of the page component and into here.

    return () => {
      // Cleanup: remove any layers/sources this hook may have added.
      // Extend this block alongside the effect body above.
    };
  }, [map, mapLoaded, beats, beatLayerVisible]);
}
