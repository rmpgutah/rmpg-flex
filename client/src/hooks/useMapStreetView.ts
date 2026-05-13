// ============================================================
// RMPG Flex — useMapStreetView Hook
// ============================================================
// Provides street-level imagery via Mapbox's satellite imagery
// with a high-zoom "street peek" popup. Uses the server-side
// binary proxy (/api/mapbox/static/image) so the access token
// is never exposed to the browser and CSP is satisfied.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxReverseGeocode } from '../services/mapboxApiService';
import { escapeHtml } from '../utils/sanitize';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface UseMapStreetViewResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  openAt: (lng: number, lat: number) => void;
  close: () => void;
}

// ── Zoom presets ──────────────────────────────────────────

const ZOOM_TABS = [
  { label: 'Street', zoom: 18 },
  { label: 'Block', zoom: 16 },
  { label: 'Area', zoom: 14 },
] as const;

// ── Build the binary image src via server proxy ───────────

function buildImageSrc(
  lng: number, lat: number, zoom: number,
  width: number, height: number,
  style: string, retina: boolean,
  markers?: Array<{ lng: number; lat: number; color?: string; label?: string }>
): string {
  const params = new URLSearchParams({
    lng: String(lng),
    lat: String(lat),
    zoom: String(zoom),
    width: String(width),
    height: String(height),
    style,
  });
  if (retina) params.set('retina', 'true');
  if (markers?.length) {
    params.set('markers', markers.map(m =>
      `${m.lng},${m.lat},${m.color ?? 'd4a017'},${m.label ?? ''}`
    ).join(';'));
  }
  return `/api/mapbox/static/image?${params}`;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapStreetView(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapStreetViewResult {
  const [enabled, setEnabled] = useState(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const showPopup = useCallback(async (lng: number, lat: number) => {
    if (!map) return;

    popupRef.current?.remove();

    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'mapbox-popup-dark sat-peek-popup',
      maxWidth: '380px',
    })
      .setLngLat([lng, lat])
      .setHTML(`
        <div style="background:#141414;padding:12px;border:1px solid #222;border-radius:2px;color:#d4a017;font-size:10px;font-family:ui-monospace,monospace;text-align:center;width:340px;">
          Loading satellite view…
        </div>`)
      .addTo(map);

    popupRef.current = popup;

    // Reverse-geocode for address
    let address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      const results = await mapboxReverseGeocode(lng, lat, { limit: 1 });
      if (results[0]?.full_address) address = results[0].full_address;
    } catch { /* keep coords */ }

    const safeAddress = escapeHtml(address);
    const activeZoom = ZOOM_TABS[0].zoom;
    const markers = [{ lng, lat, color: 'd4a017', label: '' }];

    const satSrc = buildImageSrc(lng, lat, activeZoom, 640, 400, 'mapbox/satellite-v9', true, markers);

    const html = `
      <div style="background:#141414;border:1px solid #222;border-radius:2px;overflow:hidden;width:340px;">
        <div style="padding:4px 8px;font-size:9px;color:#888;font-family:ui-monospace,monospace;border-bottom:1px solid #222;display:flex;gap:4px;align-items:center;">
          <span style="color:#d4a017;font-weight:600;">SAT PEEK</span>
        </div>
        <div style="position:relative;">
          <img src="${satSrc}" alt="Satellite view"
            style="width:340px;height:213px;object-fit:cover;display:block;background:#0a0a0a;"
            onerror="this.parentElement.innerHTML='<div style=\\'padding:40px;color:#ef4444;text-align:center;font-size:10px;font-family:ui-monospace,monospace;\\'>Image failed to load</div>'" />
          <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,#0a0a0aCC);padding:6px 8px;">
            <div style="color:#d4a017;font-size:9px;font-family:ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${safeAddress}
            </div>
          </div>
        </div>
        <div style="padding:4px 8px;font-size:8px;color:#555;font-family:ui-monospace,monospace;">
          Click map for another location
        </div>
      </div>`;

    if (popupRef.current === popup) {
      popup.setHTML(html);
    }
    devLog('[StreetView] Satellite popup opened at', lng, lat);
  }, [map]);

  // Click handler when enabled
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

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
