// ============================================================
// RMPG Flex — useMapDimBase
// Drops a semi-transparent black tile layer ABOVE the Google
// base tiles but BELOW operational overlays (heatmap, markers,
// polygons). When the heatmap is on, this makes the heat peaks
// pop against a darker backdrop without muting our own marker
// colors or labels — the heatmap layer sits above it in the
// render order because Google pushes LayerType.Visualization
// above overlayMapTypes.
//
// Pure client-side, no data fetch, no extra Maps quota. The
// tile returned is a 1×1 transparent-black PNG; Google's tile
// engine stretches it to fill every tile at every zoom.
// ============================================================

import { useEffect, useRef } from 'react';

interface UseMapDimBaseParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  /** Whether to render the dim overlay */
  enabled: boolean;
  /** Dim strength 0-1; 0.35 = roughly a 35%-opaque black veil */
  opacity?: number;
}

/** Single reusable 1×1 transparent-black PNG as a data URL. */
const BLACK_PIXEL_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function useMapDimBase({ mapInstanceRef, enabled, opacity = 0.35 }: UseMapDimBaseParams) {
  // Track the currently-installed layer so we can remove it cleanly.
  const layerRef = useRef<google.maps.ImageMapType | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove any prior layer before (re)adding — covers toggle off AND
    // opacity changes, which require a fresh layer instance.
    if (layerRef.current) {
      const overlays = map.overlayMapTypes;
      for (let i = overlays.getLength() - 1; i >= 0; i--) {
        if (overlays.getAt(i) === layerRef.current) {
          overlays.removeAt(i);
          break;
        }
      }
      layerRef.current = null;
    }

    if (!enabled) return;

    const layer = new google.maps.ImageMapType({
      getTileUrl: () => BLACK_PIXEL_DATA_URL,
      tileSize: new google.maps.Size(256, 256),
      opacity: Math.max(0, Math.min(1, opacity)),
      name: 'dim-base',
    });
    layerRef.current = layer;

    // Insert at position 0 so it sits BELOW any already-installed overlays
    // (e.g. CartoDB offline tile cache) in z-order.
    map.overlayMapTypes.insertAt(0, layer);

    return () => {
      if (!layerRef.current) return;
      const overlays = map.overlayMapTypes;
      for (let i = overlays.getLength() - 1; i >= 0; i--) {
        if (overlays.getAt(i) === layerRef.current) {
          overlays.removeAt(i);
          break;
        }
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opacity]);
}
