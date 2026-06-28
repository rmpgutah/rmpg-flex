// ============================================================
// RMPG Flex — Sightings Map
// A lightweight Mapbox panel plotting recent plate sightings (field camera +
// ClearPath dashcam) as GPS pins, colored by source, ringed red on a hit.
// Reuses the established mapboxLoader init pattern (see DispatchMiniMap).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { buildDotMarker, isValidLngLat } from '../utils/mapMarkers';
import { sightingSource } from '../utils/alprSource';

export interface MapSighting {
  id: number;
  plate: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  created_at: string;
  hit?: boolean;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City

export default function SightingsMap({ sightings, height = 240, onPick }: {
  sightings: MapSighting[];
  height?: number;
  onPick?: (plate: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Markers indexed by sighting id so we can in-place move them on every
  // refresh instead of removing-then-recreating all of them (the prior
  // pattern caused visible jitter on live ALPR feeds and pushed the WebGL
  // context cap when the sightings list grew).
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // isValidLngLat rejects NaN/Infinity AND the exact (0,0) ClearPath no-fix
  // signature so a pre-GPS-lock sighting never anchors a dot off the African coast.
  const located = sightings.filter((s) => isValidLngLat(s.lng, s.lat));

  // Load token + init map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled || !containerRef.current || mapRef.current) { setLoaded(true); return; }
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE_DARK,
          center: located.length ? [located[0].lng!, located[0].lat!] : DEFAULT_CENTER,
          zoom: 11,
          attributionControl: false,
        });
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        mapRef.current = map;
        registerMapInstance(map);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || getMapboxTokenErrorMessage());
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diff-and-move: reuse existing markers, only create/remove for additions
  // and removals. Eliminates the DOM churn that made live ALPR feeds flicker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!located.length) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    const seen = new Set<number>();
    for (const s of located) {
      seen.add(s.id);
      const lngLat: [number, number] = [s.lng!, s.lat!];
      bounds.extend(lngLat);
      const existing = markersRef.current.get(s.id);
      if (existing) {
        // Coords can update if the sighting was re-geocoded between polls.
        existing.setLngLat(lngLat);
        continue;
      }
      const src = sightingSource(s.notes);
      // halo is now in the shared builder (was inline DOM mutation) — keeps
      // the hit ring + glow but goes through one styling seam.
      const el = buildDotMarker({
        color: src.color,
        size: 11,
        halo: s.hit ? { color: '#ef4444', width: 2, shadowSpread: 8 } : undefined,
      });
      el.style.cursor = 'pointer';
      el.title = `${s.plate} · ${src.label}`;
      if (onPick) el.addEventListener('click', () => onPick(s.plate));
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
      markersRef.current.set(s.id, marker);
    }
    // Drop markers whose sighting is no longer in the feed.
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { try { m.remove(); } catch { /* idempotent */ } markersRef.current.delete(id); }
    }

    if (located.length === 1) map.flyTo({ center: [located[0].lng!, located[0].lat!], zoom: 14, duration: 600 });
    else { try { map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 600 }); } catch { /* single point */ } }
  }, [located.map((s) => `${s.id}:${s.lat},${s.lng}:${s.hit ? 1 : 0}`).join(','), loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return <div style={{ height }} className="flex items-center justify-center bg-surface-sunken border border-border-default text-[10px] text-[#888888]">{error}</div>;
  }

  return (
    <div style={{ position: 'relative', height }} className="border border-border-default">
      <div ref={containerRef} role="application" aria-label="Plate sightings map" style={{ width: '100%', height: '100%' }} />
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center bg-surface-sunken">
          <RefreshCw className="w-3.5 h-3.5 text-rmpg-600 animate-spin" />
        </div>
      )}
      {loaded && !located.length && (
        <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center pointer-events-none text-[10px] text-rmpg-500">
          No GPS-tagged sightings yet
        </div>
      )}
    </div>
  );
}
