// ============================================================
// RMPG Flex — Dashboard Mini-Map
// ============================================================
// Read-only situational-awareness widget for the Dashboard: shows every
// unit with a GPS fix and every active call as markers on a small Mapbox
// GL panel, auto-fit to bounds. Unlike MapboxMiniMap.tsx (Dispatch's
// single-selected-call + assigned-units panel used for routing), this
// widget has no selection/routing concept — it's a fleet-wide snapshot,
// so it's a separate, much simpler component rather than an extension of
// MapboxMiniMap's single-call model.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import mapboxgl from 'mapbox-gl';
import { Maximize2, Loader2 } from 'lucide-react';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { injectMapboxStyles } from '../utils/mapboxLoader';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { apiFetch } from '../hooks/useApi';
import { buildUnitMarkerEl, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml } from '../pages/map/utils/mapMarkers';
import { isValidLngLat } from '../pages/map/utils/mapMarkers';
import type { MapUnit, ActiveCall } from '../pages/map/utils/mapConstants';
import IconButton from './IconButton';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608];
const DEFAULT_ZOOM = 11;
const TOKEN_TIMEOUT_MS = 8_000;

export default function DashboardMiniMap() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState<MapUnit[]>([]);
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();

  // Data fetch — same endpoints the full Map page uses.
  useEffect(() => {
    let cancelled = false;
    apiFetch<MapUnit[]>('/dispatch/units').then((rows) => { if (!cancelled) setUnits(rows); }).catch(() => {});
    apiFetch<ActiveCall[]>('/dispatch/queue').then((rows) => { if (!cancelled) setCalls(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Map init.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    injectMapboxStyles();

    (async () => {
      try {
        const tokenPromise = getMapboxToken();
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS));
        const token = await Promise.race([tokenPromise, timeoutPromise]);
        if (!token || cancelled || !containerRef.current) {
          if (!cancelled) setError('Mapbox token not configured');
          return;
        }

        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          projection: 'mercator',
          interactive: true,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        // 'load' can be missed if it fires before/racing this handler attaching
        // in some embedded/sandboxed contexts (observed: canvas renders fine but
        // 'load' never dispatches, leaving the loading overlay stuck forever).
        // 'idle' (no pending map operations) is a more reliable "ready" signal
        // and fires at least once after the first render regardless.
        const markReady = () => { if (!cancelled) { onMapLoaded(map); setLoaded(true); } };
        map.on('load', markReady);
        map.on('idle', markReady);
        map.on('error', (e: mapboxgl.ErrorEvent) => { if (!cancelled) setError(e.error?.message || 'Map error'); });
        mapRef.current = map;
        webglRecoveryCleanupRef.current = attach(map, 'DashboardMiniMap');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load map');
      }
    })();

    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // Marker sync + fit-bounds whenever units/calls/load-state change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;

    units.filter(u => isValidLngLat(u.longitude, u.latitude)).forEach(u => {
      const marker = new mapboxgl.Marker({ element: buildUnitMarkerEl(u) })
        .setLngLat([u.longitude!, u.latitude!])
        .setPopup(new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(buildUnitPopupHtml(u)))
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([u.longitude!, u.latitude!]);
      hasPoints = true;
    });

    calls.filter(c => isValidLngLat(c.longitude, c.latitude)).forEach(c => {
      const marker = new mapboxgl.Marker({ element: buildCallMarkerEl(c) })
        .setLngLat([c.longitude!, c.latitude!])
        .setPopup(new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(buildCallPopupHtml(c, false, Date.now())))
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([c.longitude!, c.latitude!]);
      hasPoints = true;
    });

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 500 });
    }
  }, [units, calls, loaded]);

  return (
    <div className="relative panel-beveled overflow-hidden" style={{ height: 260 }}>
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-2 py-1.5 bg-surface-raised/90 border-b border-border-default backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-rmpg-200">Live Situational Map</span>
        <IconButton
          aria-label="Open full map"
          onClick={() => navigate('/map')}
          className="p-1 text-rmpg-400 hover:text-brand-400"
        >
          <Maximize2 className="w-3 h-3" />
        </IconButton>
      </div>
      <div ref={containerRef} className="w-full h-full" />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-base/80">
          <Loader2 className="w-5 h-5 text-rmpg-400 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-base/90 px-4 text-center">
          <span className="text-[10px] text-rmpg-400">{error}</span>
        </div>
      )}
    </div>
  );
}
