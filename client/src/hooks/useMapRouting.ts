// ============================================================
// RMPG Flex — useMapRouting Hook
// Provides Mapbox Directions routing between a unit and
// a dispatch call location. Renders a styled route polyline on
// the map with turn-by-turn instructions, traffic-aware ETA,
// arrival time, and auto-updates when unit GPS changes.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { getDirections } from '../utils/mapboxServices';
import type { DirectionStep } from '../utils/mapboxServices';

// ─── Types ──────────────────────────────────────────────────

export interface RouteStep {
  instruction: string;
  modifier?: string;
  type: string;
  distance: string;
  duration: number;
  streetName: string;
}

export interface RouteInfo {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  arrivalTime: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
  durationTypical?: number;
  trafficDelay: string;
  steps: RouteStep[];
  geometry: GeoJSON.LineString;
  midpoint: [number, number];
}

interface UseMapRoutingOptions {
  map: mapboxgl.Map | null;
}

// ─── Helpers ────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  const mi = meters * 0.000621371;
  if (mi < 0.1) return `${(meters * 3.28084).toFixed(0)} ft`;
  return `${mi.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatArrivalTime(seconds: number): string {
  const t = new Date(Date.now() + seconds * 1000);
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatTrafficDelay(actualSec: number, typicalSec: number | undefined): string {
  if (typicalSec == null || typicalSec <= 0) return '';
  const diff = actualSec - typicalSec;
  if (Math.abs(diff) < 30) return 'On time';
  const min = Math.round(Math.abs(diff) / 60);
  return diff > 0 ? `+${min} min delay` : `${min} min faster`;
}

function formatStepDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 500) return `${Math.round(feet)} ft`;
  return `${(meters * 0.000621371).toFixed(1)} mi`;
}

// ─── Constants ──────────────────────────────────────────────

const REROUTE_THROTTLE_MS = 30_000;
const REROUTE_DISTANCE_THRESHOLD = 100;

// Route visual layer IDs
const ROUTE_SOURCE_ID = 'rmpg-route-source';
const ROUTE_LAYER_ID = 'rmpg-route-layer';
const ARROW_LAYER_ID = 'rmpg-route-arrow-layer';
const ETA_SOURCE_ID = 'rmpg-route-eta-source';
const ETA_LAYER_ID = 'rmpg-route-eta-layer';

// ─── Hook ───────────────────────────────────────────────────

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const lastOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTimeRef = useRef<number>(0);
  const destRef = useRef<{ lat: number; lng: number } | null>(null);
  const metaRef = useRef<{ unitCallSign: string; callNumber: string }>({
    unitCallSign: '',
    callNumber: '',
  });

  // ── Render route layers on map ──────────────────────────
  const renderRoute = useCallback((
    geometry: GeoJSON.LineString,
    midpoint: [number, number],
    etaText: string,
    distanceText: string,
  ) => {
    if (!map) return;
    clearRouteFromMap();

    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry },
    });

    // Gold route line
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d4a017',
        'line-width': 4,
        'line-opacity': 0.85,
      },
    });

    // Dashed black arrow overlay for visual depth
    map.addLayer({
      id: ARROW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0a0a0a',
        'line-width': 6,
        'line-opacity': 0.35,
        'line-dasharray': [1, 3],
      },
    });

    // ETA label at midpoint
    map.addSource(ETA_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { eta: etaText, distance: distanceText },
          geometry: { type: 'Point', coordinates: midpoint },
        }],
      },
    });

    map.addLayer({
      id: ETA_LAYER_ID,
      type: 'symbol',
      source: ETA_SOURCE_ID,
      layout: {
        'text-field': ['concat', ['get', 'eta'], '  ', ['get', 'distance']],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-offset': [0, -1.5],
      },
      paint: {
        'text-color': '#d4a017',
        'text-halo-color': '#0a0a0a',
        'text-halo-width': 2.5,
      },
    });

    // Fit map to show full route with padding
    const bounds = new mapboxgl.LngLatBounds();
    (geometry.coordinates as [number, number][]).forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: { top: 80, bottom: 120, left: 80, right: 320 }, maxZoom: 15 });
  }, [map]);

  // ── Clear route from map ─────────────────────────────────
  const clearRouteFromMap = useCallback(() => {
    if (!map) return;
    try {
      [ROUTE_LAYER_ID, ARROW_LAYER_ID, ETA_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [ROUTE_SOURCE_ID, ETA_SOURCE_ID].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });
    } catch (e) { console.warn('[useMapRouting] Cleanup error:', e); }
  }, [map]);

  // ── Query the server-proxied Mapbox Directions API ─────
  const queryRoute = useCallback(
    async (
      originLatLng: { lat: number; lng: number },
      destinationLatLng: { lat: number; lng: number },
    ): Promise<RouteInfo | null> => {
      if (!map) return null;

      setRouteLoading(true);

      try {
        const data = await getDirections(
          [[originLatLng.lng, originLatLng.lat], [destinationLatLng.lng, destinationLatLng.lat]],
          'driving-traffic',
          false,
        );

        const route = data.routes?.[0];
        if (!route) throw new Error('No route found');

        const duration = route.duration;
        const distance = route.distance;
        const geometry = route.geometry;
        const legs = route.legs?.[0];

        // Calculate midpoint for ETA label
        const coords = geometry.coordinates as [number, number][];
        const midIdx = Math.floor(coords.length / 2);
        const midpoint = coords[midIdx];

        // Parse turn-by-turn steps
        const steps: RouteStep[] = (legs?.steps || []).map((s: DirectionStep) => ({
          instruction: s.maneuver?.instruction || s.name || 'Continue',
          modifier: s.maneuver?.modifier,
          type: s.maneuver?.type || 'straight',
          distance: formatStepDistance(s.distance),
          duration: s.duration,
          streetName: s.name || '',
        }));

        // Format outputs
        const etaText = formatDuration(duration);
        const arrivalTime = formatArrivalTime(duration);
        const distanceText = formatDistance(distance);
        const trafficDelay = formatTrafficDelay(duration, route.duration_typical);

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: etaText,
          arrivalTime,
          distance: distanceText,
          durationSec: Math.round(duration),
          distanceMeters: Math.round(distance),
          durationTypical: route.duration_typical ? Math.round(route.duration_typical) : undefined,
          trafficDelay,
          steps,
          geometry,
          midpoint,
        };

        // Render enhanced route on map
        renderRoute(geometry, midpoint, etaText, distanceText);

        lastOriginRef.current = originLatLng;
        lastQueryTimeRef.current = Date.now();

        setActiveRoute(info);
        return info;
      } catch (err) {
        console.warn('[useMapRouting] Directions query failed:', err);
        return null;
      } finally {
        setRouteLoading(false);
      }
    },
    [map, renderRoute],
  );

  // ── Public API ───────────────────────────────────────────

  const showRoute = useCallback(
    async (
      unitCallSign: string,
      callNumber: string,
      unitLat: number,
      unitLng: number,
      callLat: number,
      callLng: number,
    ) => {
      metaRef.current = { unitCallSign, callNumber };
      destRef.current = { lat: callLat, lng: callLng };
      return queryRoute(
        { lat: unitLat, lng: unitLng },
        { lat: callLat, lng: callLng },
      );
    },
    [queryRoute],
  );

  const clearRoute = useCallback(() => {
    clearRouteFromMap();
    setActiveRoute(null);
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, [clearRouteFromMap]);

  const updateOrigin = useCallback(
    (newLat: number, newLng: number) => {
      if (!destRef.current || !lastOriginRef.current) return;

      const elapsed = Date.now() - lastQueryTimeRef.current;
      if (elapsed < REROUTE_THROTTLE_MS) return;

      const moved = haversineMeters(
        lastOriginRef.current.lat,
        lastOriginRef.current.lng,
        newLat,
        newLng,
      );
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;

      queryRoute({ lat: newLat, lng: newLng }, destRef.current);
    },
    [queryRoute],
  );

  useEffect(() => {
    return () => {
      clearRouteFromMap();
    };
  }, [clearRouteFromMap]);

  return {
    activeRoute,
    routeLoading,
    showRoute,
    clearRoute,
    updateOrigin,
  };
}
