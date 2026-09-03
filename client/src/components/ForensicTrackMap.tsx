// ============================================================
// RMPG Flex — Forensic Track Map (Mapbox)
// ============================================================
// Real-street geo-context for the forensic player: the clip's GPS track as a
// route line, start/end markers, a playback-synced position marker, and the
// dashed predicted path ahead. Reuses the established mapboxLoader init pattern
// (see SightingsMap / DispatchMiniMap).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { buildDotMarker, isValidLngLat } from '../pages/map/utils/mapMarkers';
import { positionAtTime, type GpsPoint } from '../utils/dashcamForensics';
import { fetchMapboxMatchedPath } from '../utils/mapboxRouting';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';

const GOLD = '#d4a017';

// Mapbox Map Matching caps a request at 100 coordinates — downsample evenly
// rather than truncate so a long clip's matched line still spans its full
// duration (truncating would silently drop the back half of the drive).
const MAP_MATCH_MAX_POINTS = 100;
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export default function ForensicTrackMap({ gps, tSec, predicted, height = 200 }: {
  gps: GpsPoint[];
  tSec: number;
  predicted: Array<{ latitude: number; longitude: number }>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // posMarkerRef is the playback dot, refreshed every animation frame. The
  // start + end pins were previously created in a local closure with no ref —
  // they leaked across unmount cycles. markersRef tracks EVERY marker the
  // component owns so the cleanup loop can detach them all.
  const posMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const readyRef = useRef(false);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();

  // isValidLngLat rejects NaN/Infinity AND the exact (0,0) no-fix signature so
  // a ClearPath device's pre-fix frames never anchor the route line off-coast.
  const coords = gps.filter((p) => isValidLngLat(p.longitude, p.latitude));

  // Init once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled || !containerRef.current || mapRef.current) return;
        initMapbox(token);
        const center: [number, number] = coords.length ? [coords[0].longitude, coords[0].latitude] : [-111.891, 40.7608];
        const map = new mapboxgl.Map({ container: containerRef.current, style: MAPBOX_STYLE_DARK, center, zoom: 15, projection: 'mercator', attributionControl: false });
        mapRef.current = map;
        registerMapInstance(map);
        webglRecoveryCleanupRef.current = attach(map, 'ForensicTrackMap');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => {
          if (cancelled) return;
          onMapLoaded(map);
          const line = coords.map((p) => [p.longitude, p.latitude]);
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
          map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': GOLD, 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
          map.addSource('pred', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'pred', type: 'line', source: 'pred', paint: { 'line-color': GOLD, 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.85 } });
          if (line.length) {
            // mk() now both adds the marker AND retains its handle so cleanup
            // can call .remove() on every owned marker (was: returned handle
            // discarded → start + end markers leaked DOM nodes per unmount).
            const mk = (lngLat: [number, number], color: string): mapboxgl.Marker => {
              const el = buildDotMarker({ color, size: 10 });
              const m = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
              markersRef.current.push(m);
              return m;
            };
            mk(line[0] as [number, number], '#22c55e');
            mk(line[line.length - 1] as [number, number], '#ef4444');
            // White playback-position dot with a gold ring — a plain (non-directional)
            // marker, so the shared dot builder fits; keep the gold ring + glow.
            const pel = buildDotMarker({ color: 'var(--text-primary)', size: 14 });
            pel.style.border = `2px solid ${GOLD}`;
            pel.style.boxShadow = `0 0 8px ${GOLD}`;
            const posMarker = new mapboxgl.Marker({ element: pel }).setLngLat(line[0] as [number, number]).addTo(map);
            posMarkerRef.current = posMarker;
            markersRef.current.push(posMarker);
            const b = line.reduce((acc, c) => acc.extend(c as [number, number]), new mapboxgl.LngLatBounds(line[0] as [number, number], line[0] as [number, number]));
            map.fitBounds(b, { padding: 28, maxZoom: 17, duration: 0 });
          }
          readyRef.current = true;
          setLoaded(true);

          // Best-effort road-snap: raw GPS trails are noisy (device drift,
          // urban-canyon multipath), so the line drawn above can cut across
          // buildings/parking lots instead of following the street the
          // vehicle was actually on. Map Matching snaps it to the real road
          // network. Never blocks the initial render — the raw-coords line
          // is already on screen — and silently keeps the raw line if the
          // match fails (dashcam clips can start/end off-road, in which case
          // Mapbox legitimately has nothing to match).
          if (line.length >= 2) {
            const sample = downsample(coords, MAP_MATCH_MAX_POINTS)
              .map((p) => ({ lat: p.latitude, lng: p.longitude }));
            fetchMapboxMatchedPath(sample).then((matched) => {
              if (cancelled || matched.length < 2) return;
              const routeSrc = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;
              if (!routeSrc) return;
              routeSrc.setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: matched.map((p) => [p.lng, p.lat]) },
              });
            }).catch(() => { /* keep the raw-coords line */ });
          }
        });
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || getMapboxTokenErrorMessage());
      }
    })();
    return () => {
      cancelled = true;
      // Detach every owned marker — start, end, AND playback. Calling .remove
      // is idempotent and never throws even after map.remove(), so the order
      // is safe.
      markersRef.current.forEach((m) => { try { m.remove(); } catch { /* idempotent */ } });
      markersRef.current = [];
      posMarkerRef.current = null;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      readyRef.current = false;
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.length, rebuildNonce]);

  // Sync the playback marker + predicted path to the current time.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const pos = positionAtTime(gps, tSec);
    if (pos && isValidLngLat(pos.longitude, pos.latitude) && posMarkerRef.current) {
      posMarkerRef.current.setLngLat([pos.longitude, pos.latitude]);
    }
    const src = map.getSource('pred') as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      const head = pos ? [[pos.longitude, pos.latitude]] : [];
      const coordsP = [...head, ...predicted.map((p) => [p.longitude, p.latitude])];
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordsP } });
    }
  }, [tSec, predicted, gps]);

  return (
    <div className="relative w-full border border-border-default bg-surface-overlay" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-fg-muted text-[11px] gap-1"><Loader2 className="w-3 h-3 animate-spin" /> map…</div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center text-fg-muted text-[10px] px-2 text-center">{error}</div>}
    </div>
  );
}
