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
import { buildDotMarker } from '../utils/mapMarkers';
import { positionAtTime, type GpsPoint } from '../utils/dashcamForensics';

const GOLD = '#d4a017';

export default function ForensicTrackMap({ gps, tSec, predicted, height = 200 }: {
  gps: GpsPoint[];
  tSec: number;
  predicted: Array<{ latitude: number; longitude: number }>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const posMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const readyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coords = gps.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  // Init once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled || !containerRef.current || mapRef.current) return;
        initMapbox(token);
        const center: [number, number] = coords.length ? [coords[0].longitude, coords[0].latitude] : [-111.891, 40.7608];
        const map = new mapboxgl.Map({ container: containerRef.current, style: MAPBOX_STYLE_DARK, center, zoom: 15, attributionControl: false });
        mapRef.current = map;
        registerMapInstance(map);
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => {
          if (cancelled) return;
          const line = coords.map((p) => [p.longitude, p.latitude]);
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
          map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': GOLD, 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
          map.addSource('pred', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'pred', type: 'line', source: 'pred', paint: { 'line-color': GOLD, 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.85 } });
          if (line.length) {
            const mk = (lngLat: [number, number], color: string) => { const el = buildDotMarker({ color, size: 10 }); return new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map); };
            mk(line[0] as [number, number], '#22c55e');
            mk(line[line.length - 1] as [number, number], '#ef4444');
            // White playback-position dot with a gold ring — a plain (non-directional)
            // marker, so the shared dot builder fits; keep the gold ring + glow.
            const pel = buildDotMarker({ color: '#ffffff', size: 14 });
            pel.style.border = `2px solid ${GOLD}`;
            pel.style.boxShadow = `0 0 8px ${GOLD}`;
            posMarkerRef.current = new mapboxgl.Marker({ element: pel }).setLngLat(line[0] as [number, number]).addTo(map);
            const b = line.reduce((acc, c) => acc.extend(c as [number, number]), new mapboxgl.LngLatBounds(line[0] as [number, number], line[0] as [number, number]));
            map.fitBounds(b, { padding: 28, maxZoom: 17, duration: 0 });
          }
          readyRef.current = true;
          setLoaded(true);
        });
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || getMapboxTokenErrorMessage());
      }
    })();
    return () => {
      cancelled = true;
      if (posMarkerRef.current) { posMarkerRef.current.remove(); posMarkerRef.current = null; }
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.length]);

  // Sync the playback marker + predicted path to the current time.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const pos = positionAtTime(gps, tSec);
    if (pos && posMarkerRef.current) posMarkerRef.current.setLngLat([pos.longitude, pos.latitude]);
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
        <div className="absolute inset-0 flex items-center justify-center text-rmpg-500 text-[11px] gap-1"><Loader2 className="w-3 h-3 animate-spin" /> map…</div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center text-rmpg-500 text-[10px] px-2 text-center">{error}</div>}
    </div>
  );
}
