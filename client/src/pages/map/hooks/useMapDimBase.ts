// ============================================================
// RMPG Flex — useMapDimBase
// Drops a semi-transparent black tile layer ABOVE the base
// tiles but BELOW operational overlays (heatmap, markers,
// polygons). When the heatmap is on, this makes the heat peaks
// pop against a darker backdrop without muting our own marker
// colors or labels.
//
// Uses a DOM overlay element inserted into the map canvas
// container with pointer-events: none so it doesn't block
// interactions.
// ============================================================

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

interface UseMapDimBaseParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  /** Whether to render the dim overlay */
  enabled: boolean;
  /** Dim strength 0-1; 0.35 = roughly a 35%-opaque black veil */
  opacity?: number;
}

export function useMapDimBase({ mapInstanceRef, enabled, opacity = 0.35 }: UseMapDimBaseParams) {
  const dimElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing dim element
    if (dimElRef.current) {
      dimElRef.current.remove();
      dimElRef.current = null;
    }

    if (!enabled) return;

    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, ${Math.max(0, Math.min(1, opacity))});
      pointer-events: none;
    `;
    map.getCanvasContainer().appendChild(el);
    dimElRef.current = el;

    return () => {
      if (dimElRef.current) {
        dimElRef.current.remove();
        dimElRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opacity]);
}
