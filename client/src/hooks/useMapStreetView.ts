// ============================================================
// RMPG Flex — useMapStreetView Hook
// ============================================================
// Provides street-level imagery via Mapbox's satellite imagery
// with a high-zoom "street peek" popup. While Mapbox doesn't
// have a direct Street View equivalent, this hook combines a
// Mapbox satellite static image with heading-aware display for
// quick location reconnaissance — the primary dispatcher use-
// case for Google Street View.
//
// When activated, clicking a map location shows a high-zoom
// satellite popup of the area.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxStaticImageUrl } from '../services/mapboxApiService';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface UseMapStreetViewResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  /** Manually open street-level view at a specific location */
  openAt: (lng: number, lat: number) => void;
  /** Close the current street-level popup */
  close: () => void;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapStreetView(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapStreetViewResult {
  const [enabled, setEnabled] = useState(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const showPopup = useCallback(async (lng: number, lat: number) => {
    if (!map) return;

    popupRef.current?.remove();

    // Build a loading popup
    const loadingHtml = `
      <div style="background:#141414;padding:8px;border:1px solid #222;border-radius:2px;color:#d4a017;font-size:10px;font-family:ui-monospace,monospace;text-align:center;width:320px;">
        Loading satellite view…
      </div>`;

    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'mapbox-popup-dark',
      maxWidth: '360px',
    })
      .setLngLat([lng, lat])
      .setHTML(loadingHtml)
      .addTo(map);

    popupRef.current = popup;

    try {
      const url = await mapboxStaticImageUrl({
        lng, lat,
        zoom: 18,
        width: 640,
        height: 400,
        style: 'mapbox/satellite-v9',
        retina: true,
        markers: [{ lng, lat, color: 'd4a017', label: '' }],
      });

      const html = `
        <div style="background:#141414;border:1px solid #222;border-radius:2px;overflow:hidden;">
          <div style="position:relative;">
            <img src="${url}" alt="Satellite view" style="width:320px;height:200px;object-fit:cover;display:block;" />
            <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,#0a0a0aCC);padding:6px 8px;">
              <div style="color:#d4a017;font-size:9px;font-family:ui-monospace,monospace;">
                ${lat.toFixed(6)}, ${lng.toFixed(6)}
              </div>
            </div>
          </div>
          <div style="padding:6px 8px;font-size:9px;color:#888;font-family:ui-monospace,monospace;">
            SATELLITE PEEK — Zoom 18 · Click map for another location
          </div>
        </div>`;

      if (popupRef.current === popup) {
        popup.setHTML(html);
      }
      devLog('[StreetView] Satellite popup opened at', lng, lat);
    } catch (err) {
      if (popupRef.current === popup) {
        popup.setHTML(`
          <div style="background:#141414;padding:8px;border:1px solid #222;border-radius:2px;color:#ef4444;font-size:10px;font-family:ui-monospace,monospace;text-align:center;width:320px;">
            Failed to load satellite image
          </div>`);
      }
    }
  }, [map]);

  // Click handler when enabled
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = 'pointer';

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      showPopup(e.lngLat.lng, e.lngLat.lat);
    };

    map.on('click', onClick);

    return () => {
      canvas.style.cursor = '';
      map.off('click', onClick);
    };
  }, [map, mapLoaded, enabled, showPopup]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  const openAt = useCallback((lng: number, lat: number) => {
    showPopup(lng, lat);
  }, [showPopup]);

  const close = useCallback(() => {
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  return { enabled, toggle, setEnabled, openAt, close };
}
