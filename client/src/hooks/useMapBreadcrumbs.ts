// ============================================================
// RMPG Flex — useMapBreadcrumbs Hook
// ============================================================
// Renders GPS breadcrumb trails for units on the Mapbox map.
// Replaces Google Maps Polyline-based unit trail history.
// Each unit gets a fading trail showing its movement path
// over the last N minutes, color-coded by unit status.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { devLog, devWarn } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number | null;
  heading?: number | null;
}

export interface UnitTrail {
  unitId: string;
  callSign: string;
  color: string;
  points: BreadcrumbPoint[];
}

export interface UseMapBreadcrumbsResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  trails: UnitTrail[];
  /** Manually refresh trail data from the server */
  refresh: () => void;
  /** Duration of trail history in minutes */
  durationMinutes: number;
  setDurationMinutes: (m: number) => void;
}

// ── Constants ─────────────────────────────────────────────

const TRAIL_SOURCE_PREFIX = 'rmpg-trail-';
const TRAIL_LAYER_PREFIX = 'rmpg-trail-line-';
const TRAIL_DOTS_PREFIX = 'rmpg-trail-dots-';
const DEFAULT_DURATION_MINUTES = 30;
const REFRESH_INTERVAL_MS = 60_000;

// ── Hook ──────────────────────────────────────────────────

export function useMapBreadcrumbs(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  unitIds: string[],
  unitColors: Record<string, string>,
): UseMapBreadcrumbsResult {
  const [enabled, setEnabled] = useState(false);
  const [trails, setTrails] = useState<UnitTrail[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const activeSourcesRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTrails = useCallback(async () => {
    if (!enabled || unitIds.length === 0) return;

    try {
      // The live endpoint is GET /dispatch/gps/trails?hours=N[&unit_id=] — it
      // has no `since`/plural `unit_ids` params (that contract never existed
      // server-side, see src/routes/dispatch/gps.ts), takes an hours window
      // (1-24) instead of an ISO timestamp, and returns points keyed
      // lat/lng/time rather than latitude/longitude/timestamp. Fetch once per
      // unit and remap the shape rather than inventing a new server route.
      const hours = Math.min(24, Math.max(1, Math.ceil(durationMinutes / 60)));
      const perUnit = await Promise.all(
        unitIds.map(uid =>
          apiFetch<Array<{
            unit_id: number;
            call_sign: string;
            points: Array<{ lat: number; lng: number; time: string; speed: number | null; heading: number | null }>;
          }>>(`/dispatch/gps/trails?hours=${hours}&unit_id=${encodeURIComponent(uid)}`).catch(() => []),
        ),
      );

      const newTrails: UnitTrail[] = perUnit.flat().filter(Boolean).map(t => ({
        unitId: String(t.unit_id),
        callSign: t.call_sign,
        color: unitColors[String(t.unit_id)] || '#d4a017',
        points: (t.points || []).map(p => ({
          latitude: p.lat,
          longitude: p.lng,
          timestamp: p.time,
          speed: p.speed,
          heading: p.heading,
        })),
      }));

      setTrails(newTrails);
    } catch (err) {
      devWarn('[Breadcrumbs] Failed to fetch trails', err);
    }
  }, [enabled, unitIds, unitColors, durationMinutes]);

  // Fetch on enable or interval
  useEffect(() => {
    if (!enabled) return;
    fetchTrails();
    refreshTimerRef.current = setInterval(fetchTrails, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [enabled, fetchTrails]);

  // Render trails on the map
  useEffect(() => {
    if (!map || !mapLoaded) return;

    // Clean up old trail layers
    activeSourcesRef.current.forEach(srcId => {
      const lineId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_LAYER_PREFIX);
      const dotsId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(dotsId)) map.removeLayer(dotsId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    });
    activeSourcesRef.current.clear();

    if (!enabled || trails.length === 0) return;

    for (const trail of trails) {
      if (trail.points.length < 2) continue;

      const srcId = `${TRAIL_SOURCE_PREFIX}${trail.unitId}`;
      const lineId = `${TRAIL_LAYER_PREFIX}${trail.unitId}`;
      const dotsId = `${TRAIL_DOTS_PREFIX}${trail.unitId}`;

      const coords = trail.points.map(p => [p.longitude, p.latitude] as [number, number]);

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { callSign: trail.callSign },
            geometry: { type: 'LineString', coordinates: coords },
          },
          ...trail.points.map((p, i) => ({
            type: 'Feature' as const,
            properties: {
              index: i,
              opacity: 0.3 + (i / trail.points.length) * 0.7, // fade older points
            },
            geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
          })),
        ],
      };

      map.addSource(srcId, { type: 'geojson', data: geojson });

      // Trail line with gradient opacity (newer segments more opaque)
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': trail.color,
          'line-width': 2,
          'line-opacity': 0.5,
          'line-dasharray': [2, 1],
        },
      });

      // Trail dots at each GPS fix
      map.addLayer({
        id: dotsId,
        type: 'circle',
        source: srcId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': trail.color,
          'circle-radius': 3,
          'circle-opacity': ['get', 'opacity'],
        },
      });

      activeSourcesRef.current.add(srcId);
    }

    devLog('[Breadcrumbs] Rendered', trails.length, 'unit trails');

    return () => {
      activeSourcesRef.current.forEach(srcId => {
        const lineId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_LAYER_PREFIX);
        const dotsId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getLayer(dotsId)) map.removeLayer(dotsId);
        if (map.getSource(srcId)) map.removeSource(srcId);
      });
      activeSourcesRef.current.clear();
    };
  }, [map, mapLoaded, enabled, trails]);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  const refresh = useCallback(() => { fetchTrails(); }, [fetchTrails]);

  return { enabled, toggle, setEnabled, trails, refresh, durationMinutes, setDurationMinutes };
}
