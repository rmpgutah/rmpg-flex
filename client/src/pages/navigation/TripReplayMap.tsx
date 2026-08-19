// ============================================================
// Trip replay map — a small, passive Mapbox visual for the Movement
// Report drawer's "replay this trip" control. Draws the full breadcrumb
// polyline (traveled in gold, remaining dimmed) and a marker at the
// current replay position. No pan/zoom/rotate, no camera follow — the
// camera fits the whole trip once on load and never moves again; all
// scrubbing stays on the existing range slider in TripReplay.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  initMapbox, mapboxgl, MAPBOX_STYLE_DARK,
} from '../../utils/mapboxLoader';
import { getMapboxAccessToken } from '../../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import type { ReplayPoint } from './tripReplay';
import { useWebglMapRecovery } from '../../hooks/useWebglMapRecovery';

const TRAVELED_SOURCE_ID = 'trip-replay-traveled-src';
const TRAVELED_LAYER_ID = 'trip-replay-traveled-line';
const REMAINING_SOURCE_ID = 'trip-replay-remaining-src';
const REMAINING_LAYER_ID = 'trip-replay-remaining-line';
const MARKER_SOURCE_ID = 'trip-replay-marker-src';
const MARKER_HALO_LAYER_ID = 'trip-replay-marker-halo';
const MARKER_LAYER_ID = 'trip-replay-marker-dot';

function emptyLineFeature(): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}

function emptyPointFeature(): GeoJSON.Feature<GeoJSON.Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } };
}

interface TripReplayMapProps {
  points: ReplayPoint[];
  replayIdx: number;
}

export default function TripReplayMap({ points, replayIdx }: TripReplayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // ── Init (once) ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        if (!token || !containerRef.current) {
          setFailed(true);
          return;
        }
        initMapbox(token);

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE_DARK,
          center: [points[0]?.lng ?? 0, points[0]?.lat ?? 0],
          zoom: 13,
          projection: 'mercator',
          attributionControl: false,
          interactive: false,
          pitch: 0,
          bearing: 0,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });

        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));

        map.on('load', () => {
          if (cancelled) {
            map.remove();
            return;
          }
          onMapLoaded(map);
          map.addSource(REMAINING_SOURCE_ID, { type: 'geojson', data: emptyLineFeature() });
          map.addLayer({
            id: REMAINING_LAYER_ID,
            type: 'line',
            source: REMAINING_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#4b5563', 'line-width': 2, 'line-opacity': 0.8 },
          });
          map.addSource(TRAVELED_SOURCE_ID, { type: 'geojson', data: emptyLineFeature() });
          map.addLayer({
            id: TRAVELED_LAYER_ID,
            type: 'line',
            source: TRAVELED_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.9 },
          });
          map.addSource(MARKER_SOURCE_ID, { type: 'geojson', data: emptyPointFeature() });
          map.addLayer({
            id: MARKER_HALO_LAYER_ID,
            type: 'circle',
            source: MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 10,
              'circle-color': '#d4a017',
              'circle-opacity': 0.2,
              'circle-stroke-color': '#d4a017',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.4,
            },
          });
          map.addLayer({
            id: MARKER_LAYER_ID,
            type: 'circle',
            source: MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 5,
              'circle-color': '#d4a017',
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });

          mapRef.current = map;
          webglRecoveryCleanupRef.current = attach(map, 'TripReplayMap');
          setMapReady(true);
        });

        map.on('error', (e) => {
          console.warn('[TripReplayMap] mapbox error:', e?.error?.message || e);
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[TripReplayMap] init failed:', err);
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // ── Refit camera whenever the points set changes (new trip selected) ──
  useEffect(() => {
    if (!mapReady || !mapRef.current || points.length < 2) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    try {
      mapRef.current.fitBounds(bounds, { padding: 16, duration: 0 });
    } catch { /* ignore — degenerate bounds (all-identical points) */ }
  }, [mapReady, points]);

  // ── Update traveled/remaining/marker on replayIdx change ───
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const traveledSrc = map.getSource(TRAVELED_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const remainingSrc = map.getSource(REMAINING_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const markerSrc = map.getSource(MARKER_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!traveledSrc || !remainingSrc || !markerSrc) return;

    const idx = Math.max(0, Math.min(replayIdx, points.length - 1));
    const traveled = points.slice(0, idx + 1);
    const remaining = points.slice(idx);
    const current = points[idx];

    traveledSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: traveled.map((p) => [p.lng, p.lat]) },
    });
    remainingSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: remaining.map((p) => [p.lng, p.lat]) },
    });
    if (current) {
      markerSrc.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [current.lng, current.lat] },
      });
    }
  }, [mapReady, points, replayIdx]);

  if (failed) return null;

  return (
    <div
      className="relative border border-rmpg-800 overflow-hidden"
      style={{ height: 140, borderRadius: 2, background: 'var(--surface-sunken)' }}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
