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
import { buildDotMarker, isValidLngLat } from '../pages/map/utils/mapMarkers';
import { sightingSource } from '../utils/alprSource';
import { hasSource, safeRemoveLayer, safeRemoveSource, getSourceSafe, upsertGeoJsonSource } from '../utils/mapboxSafeLayer';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';

// Above this many GPS-tagged sightings, individual DOM markers get dense
// enough to occlude each other on a small panel (this component defaults to
// 240px tall) — switch to native Mapbox GL clustering (same primitive as
// useMapClustering, but hand-rolled here since sightings need per-point
// color-by-source + a hit halo that the shared hook's generic priority/label
// schema doesn't model). Below the threshold, individual markers (with their
// existing hover/click/hit-ring behavior) are cheaper and give exact counts
// at a glance, so they stay the default for the common case.
const CLUSTER_THRESHOLD = 40;
const CLUSTER_SOURCE = 'rmpg-sightings-cluster';
const CLUSTER_CIRCLE = 'rmpg-sightings-cluster-circle';
const CLUSTER_COUNT = 'rmpg-sightings-cluster-count';
const CLUSTER_POINT = 'rmpg-sightings-cluster-point';

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
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();

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
          projection: 'mercator',
          attributionControl: false,
        });
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => { if (!cancelled) onMapLoaded(map); });
        mapRef.current = map;
        registerMapInstance(map);
        webglRecoveryCleanupRef.current = attach(map, 'SightingsMap');
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || getMapboxTokenErrorMessage());
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  const clustered = located.length > CLUSTER_THRESHOLD;

  // Diff-and-move: reuse existing markers, only create/remove for additions
  // and removals. Eliminates the DOM churn that made live ALPR feeds flicker.
  // Skipped once clustered — the cluster-layer effect below owns rendering
  // and this effect just clears any markers left over from before the feed
  // crossed CLUSTER_THRESHOLD.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!located.length || clustered) {
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
        halo: s.hit ? { color: 'var(--sev-critical)', width: 2, shadowSpread: 8 } : undefined,
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
  }, [located.map((s) => `${s.id}:${s.lat},${s.lng}:${s.hit ? 1 : 0}`).join(','), loaded, clustered]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cluster-layer rendering — mirrors useMapClustering's source/layer setup
  // but with sightings' own property schema (color-by-source, hit halo)
  // instead of the shared hook's priority/label model.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (!clustered) {
      [CLUSTER_POINT, CLUSTER_COUNT, CLUSTER_CIRCLE].forEach((id) => safeRemoveLayer(map, id));
      safeRemoveSource(map, CLUSTER_SOURCE);
      return;
    }

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: located.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, plate: s.plate, color: sightingSource(s.notes).color, hit: s.hit ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [s.lng!, s.lat!] },
      })),
    };

    if (!hasSource(map, CLUSTER_SOURCE)) {
      map.addSource(CLUSTER_SOURCE, {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45,
      });

      map.addLayer({
        id: CLUSTER_CIRCLE,
        type: 'circle',
        source: CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#d4a017', 10,
            '#f59e0b', 30,
            '#ef4444',
          ],
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#0a0a0a',
          'circle-stroke-width': 1.5,
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT,
        type: 'symbol',
        source: CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 10,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Unclustered sightings — colored by source, red-ringed on a hit
      // (same visual meaning as the DOM marker's halo below threshold).
      map.addLayer({
        id: CLUSTER_POINT,
        type: 'circle',
        source: CLUSTER_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 6,
          'circle-stroke-color': ['case', ['==', ['get', 'hit'], 1], '#ef4444', '#0a0a0a'],
          'circle-stroke-width': ['case', ['==', ['get', 'hit'], 1], 2.5, 1.5],
        },
      });
    } else {
      upsertGeoJsonSource(map, CLUSTER_SOURCE, geojson);
    }

    const onClusterClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE] });
      const clusterId = features[0]?.properties?.cluster_id;
      if (clusterId == null) return;
      const source = getSourceSafe<mapboxgl.GeoJSONSource>(map, CLUSTER_SOURCE);
      source?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return;
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: coords, zoom: zoom + 1 });
      });
    };
    const onPointClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_POINT] });
      const plate = features[0]?.properties?.plate;
      if (plate && onPick) onPick(String(plate));
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', CLUSTER_CIRCLE, onClusterClick);
    map.on('click', CLUSTER_POINT, onPointClick);
    [CLUSTER_CIRCLE, CLUSTER_POINT].forEach((id) => {
      map.on('mouseenter', id, onEnter);
      map.on('mouseleave', id, onLeave);
    });

    if (located.length) {
      const bounds = new mapboxgl.LngLatBounds();
      located.forEach((s) => bounds.extend([s.lng!, s.lat!]));
      try { map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 600 }); } catch { /* single point */ }
    }

    return () => {
      map.off('click', CLUSTER_CIRCLE, onClusterClick);
      map.off('click', CLUSTER_POINT, onPointClick);
      [CLUSTER_CIRCLE, CLUSTER_POINT].forEach((id) => {
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      });
    };
  }, [located.map((s) => `${s.id}:${s.lat},${s.lng}:${s.hit ? 1 : 0}`).join(','), loaded, clustered, onPick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return <div style={{ height }} className="flex items-center justify-center bg-surface-sunken border border-border-default text-[10px] text-fg-muted">{error}</div>;
  }

  return (
    <div style={{ position: 'relative', height }} className="border border-border-default">
      <div ref={containerRef} role="application" aria-label="Plate sightings map" style={{ width: '100%', height: '100%' }} />
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center bg-surface-sunken">
          <RefreshCw className="w-3.5 h-3.5 text-fg-muted animate-spin" />
        </div>
      )}
      {loaded && !located.length && (
        <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center pointer-events-none text-[10px] text-fg-muted">
          No GPS-tagged sightings yet
        </div>
      )}
    </div>
  );
}
