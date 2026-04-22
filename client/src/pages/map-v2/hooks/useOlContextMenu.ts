import { useEffect, useRef, useState } from 'react';
import type OlMap from 'ol/Map';
import { toLonLat } from 'ol/proj';

export interface ContextMenuState {
  /** Pixel position in the viewport */
  x: number;
  y: number;
  /** Map coordinate (lat/lng) at the click */
  lat: number;
  lng: number;
}

/**
 * Right-click context menu state for /map-v2.
 *
 * Listens to the map viewport's `contextmenu` event, suppresses the
 * native browser menu, captures the click pixel + map coordinate,
 * and exposes both via state. The menu UI is a separate component
 * that consumes this state and renders the actions.
 *
 * Click-anywhere-else (mousedown elsewhere) closes the menu — handled
 * by the consuming component since it owns the visible chrome.
 */
export function useOlContextMenu(map: OlMap | null): {
  menu: ContextMenuState | null;
  close: () => void;
} {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const mapRef = useRef<OlMap | null>(map);
  mapRef.current = map;

  useEffect(() => {
    if (!map) return;
    const target = map.getViewport();
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const coord = map.getCoordinateFromPixel([px, py]);
      if (!coord) return;
      const [lng, lat] = toLonLat(coord);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setMenu({ x: e.clientX, y: e.clientY, lat, lng });
    };
    target.addEventListener('contextmenu', onContext);
    return () => target.removeEventListener('contextmenu', onContext);
  }, [map]);

  return { menu, close: () => setMenu(null) };
}
