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
import { safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatDateTime } from '../utils/dateUtils';

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

const MPS_TO_MPH = 2.23694;

const TRAIL_SOURCE_PREFIX = 'rmpg-trail-';
const TRAIL_LINE_PREFIX = 'rmpg-trail-line-';
const TRAIL_DOTS_PREFIX = 'rmpg-trail-dots-';
const DEFAULT_DURATION_MINUTES = 30;
const REFRESH_INTERVAL_MS = 60_000;

/** Map m/s speed to a color band — matches the Google Maps breadcrumb palette. */
function speedToColor(speedMps: number | null | undefined): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0.2) return '#666666';
  const mph = speedMps * MPS_TO_MPH;
  if (mph < 3)  return '#999999';
  if (mph < 10) return '#22c55e';
  if (mph < 25) return '#22c55e';
  if (mph < 35) return '#84cc16';
  if (mph < 45) return '#eab308';
  if (mph < 55) return '#f97316';
  if (mph < 75) return '#ef4444';
  return '#dc2626';
}

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
        color: unitColors[String(t.unit_id)] || '#c3ccd6',
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
      const lineId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_LINE_PREFIX);
      const dotsId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX);
      safeRemoveLayer(map, lineId);
      safeRemoveLayer(map, dotsId);
      safeRemoveSource(map, srcId);
    });
    activeSourcesRef.current.clear();

    if (!enabled || trails.length === 0) return;

    for (const trail of trails) {
      if (trail.points.length < 2) continue;

      const srcId = `${TRAIL_SOURCE_PREFIX}${trail.unitId}`;
      const lineId = `${TRAIL_LINE_PREFIX}${trail.unitId}`;
      const dotsId = `${TRAIL_DOTS_PREFIX}${trail.unitId}`;

      const len = trail.points.length;

      // Build per-segment LineStrings so each gets its own speed-based color
      const segments: GeoJSON.Feature[] = [];
      for (let i = 0; i < len - 1; i++) {
        const p = trail.points[i];
        const next = trail.points[i + 1];
        const mph = p.speed != null ? p.speed * MPS_TO_MPH : 0;
        segments.push({
          type: 'Feature',
          properties: {
            speedMph: mph,
            color: speedToColor(p.speed),
            opacity: 0.4 + (i / len) * 0.6,
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [p.longitude, p.latitude],
              [next.longitude, next.latitude],
            ],
          },
        });
      }

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          ...segments,
          ...trail.points.map((p, i) => ({
            type: 'Feature' as const,
            properties: {
              index: i,
              opacity: 0.4 + (i / len) * 0.6,
              color: speedToColor(p.speed),
              callSign: trail.callSign,
              timestamp: p.timestamp,
              speed: p.speed,
              speedMph: p.speed != null ? Math.round(p.speed * MPS_TO_MPH) : null,
              heading: p.heading,
            },
            geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
          })),
        ],
      };

      map.addSource(srcId, { type: 'geojson', data: geojson });

      // Speed-colored trail segments
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'step', ['get', 'speedMph'],
            1.5,   // stationary
            3, 2,  // walking
            25, 2.5,
            45, 3,
            55, 3.5,
            75, 4,
          ],
          'line-opacity': ['get', 'opacity'],
        },
      });

      // Speed-colored dots at each GPS fix
      map.addLayer({
        id: dotsId,
        type: 'circle',
        source: srcId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': [
            'step', ['coalesce', ['get', 'speedMph'], 0],
            3,     // stationary
            3, 3.5,
            25, 4,
            55, 4.5,
          ],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 0.5,
          'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.4],
        },
      });

      activeSourcesRef.current.add(srcId);
    }

    devLog('[Breadcrumbs] Rendered', trails.length, 'unit trails');

    return () => {
      activeSourcesRef.current.forEach(srcId => {
        const lineId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_LINE_PREFIX);
        const dotsId = srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX);
        safeRemoveLayer(map, lineId);
        safeRemoveLayer(map, dotsId);
        safeRemoveSource(map, srcId);
      });
      activeSourcesRef.current.clear();
    };
  }, [map, mapLoaded, enabled, trails]);

  // Click-to-detail for breadcrumb dots. Registered once (not per-trail —
  // each trail gets its own dynamically-named dots layer, recreated on
  // every fetch/toggle cycle, so a single delegated map-level listener that
  // queries whichever dot layers currently exist avoids re-binding /
  // duplicate-listener accumulation across re-renders).
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const dotLayers = Array.from(activeSourcesRef.current)
        .map(srcId => srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX))
        .filter(id => map.getLayer(id));
      if (!dotLayers.length) return;
      const features = map.queryRenderedFeatures(e.point, { layers: dotLayers });
      const f = features[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 6, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(buildDetailPopupHtml(`${p.callSign || 'Unit'} — GPS Fix`, [
          ['Time', p.timestamp ? formatDateTime(p.timestamp) : null],
          ['Speed', p.speed != null ? `${Math.round(Number(p.speed) * MPS_TO_MPH)} mph` : null],
          ['Heading', p.heading != null ? `${Math.round(p.heading)}°` : null],
        ]))
        .addTo(map);
    };

    const onMove = (e: mapboxgl.MapMouseEvent) => {
      const dotLayers = Array.from(activeSourcesRef.current)
        .map(srcId => srcId.replace(TRAIL_SOURCE_PREFIX, TRAIL_DOTS_PREFIX))
        .filter(id => map.getLayer(id));
      map.getCanvas().style.cursor = dotLayers.length && map.queryRenderedFeatures(e.point, { layers: dotLayers }).length
        ? 'pointer' : '';
    };

    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); popupRef.current?.remove(); };
  }, [map, mapLoaded]);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  const refresh = useCallback(() => { fetchTrails(); }, [fetchTrails]);

  return { enabled, toggle, setEnabled, trails, refresh, durationMinutes, setDurationMinutes };
}
