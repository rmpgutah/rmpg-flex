// ============================================================
// RMPG Flex — useMapRouting Hook
// Provides Mapbox Directions routing between a unit and
// a dispatch call location. Renders a polyline on the map with
// ETA and distance, auto-updates when unit GPS changes.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';

// ─── Types ──────────────────────────────────────────────────

/** One turn-by-turn maneuver along the driving route. */
export interface RouteStep {
  /** Human-readable instruction, e.g. "Turn left onto S Main St". */
  instruction: string;
  /** Distance covered by this step, in meters. */
  distanceMeters: number;
  /** Formatted distance, e.g. "0.3 mi" or "400 ft". */
  distanceText: string;
  /** Mapbox maneuver type: depart | turn | merge | arrive | … */
  maneuverType: string;
  /** Mapbox maneuver modifier: left | right | straight | … (optional). */
  modifier?: string;
}

export interface RouteInfo {
  /** Origin unit call sign */
  unitCallSign: string;
  /** Destination call number */
  callNumber: string;
  /** Driving ETA text (e.g. "8 min") */
  eta: string;
  /** Driving distance text (e.g. "3.2 mi") */
  distance: string;
  /** Raw duration in seconds */
  durationSec: number;
  /** Raw distance in meters */
  distanceMeters: number;
  /** Point-by-point turn-by-turn directions (unit → call). */
  steps: RouteStep[];
}

interface UseMapRoutingOptions {
  /** Mapbox Map instance — must be set before calling showRoute */
  map: mapboxgl.Map | null;
}

// ─── Haversine (quick distance check to avoid unnecessary re-queries) ───

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

// ─── Constants ──────────────────────────────────────────────

/** Minimum time between re-routing queries (ms) */
const REROUTE_THROTTLE_MS = 30_000;

/** Minimum movement before re-routing (meters) */
const REROUTE_DISTANCE_THRESHOLD = 100;

/** Route polyline color */
const ROUTE_COLOR = '#888888';

/** Route source/layer IDs on the map */
const ROUTE_SOURCE_ID = 'rmpg-route-source';
const ROUTE_LAYER_ID = 'rmpg-route-layer';

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

  // ── Query the Mapbox Directions API ─────────────────────
  const queryRoute = useCallback(
    async (
      originLatLng: { lat: number; lng: number },
      destinationLatLng: { lat: number; lng: number },
    ): Promise<RouteInfo | null> => {
      if (!map) return null;

      setRouteLoading(true);

      try {
        const token = await getMapboxAccessToken();
        if (!token) return null;

        const coords = `${originLatLng.lng},${originLatLng.lat};${destinationLatLng.lng},${destinationLatLng.lat}`;
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${token}&geometries=geojson&overview=full&steps=true`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);

        const data = await res.json();
        const route = data.routes?.[0];
        if (!route) throw new Error('No route found');

        const duration = route.duration; // seconds
        const distance = route.distance; // meters
        const geometry = route.geometry; // GeoJSON geometry

        // Render route on map
        clearRouteFromMap();

        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry },
        });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          paint: {
            'line-color': ROUTE_COLOR,
            'line-width': 4,
            'line-opacity': 0.8,
          },
        });

        const distanceMi = (distance * 0.000621371).toFixed(1);
        const etaMin = Math.round(duration / 60);

        // Turn-by-turn maneuvers (steps=true). Mapbox nests them under
        // legs[].steps[].maneuver; flatten the first leg (unit → call is a
        // single leg) into a display-ready list.
        const fmtStepDist = (m: number) =>
          m >= 1609 ? `${(m * 0.000621371).toFixed(1)} mi` : `${Math.round(m * 3.28084)} ft`;
        const steps: RouteStep[] = ((route.legs?.[0]?.steps ?? []) as any[]).map((s) => {
          const man = s.maneuver || {};
          const meters = typeof s.distance === 'number' ? s.distance : 0;
          return {
            instruction: man.instruction || s.name || 'Continue',
            distanceMeters: Math.round(meters),
            distanceText: fmtStepDist(meters),
            maneuverType: man.type || '',
            modifier: man.modifier,
          };
        });

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: etaMin < 1 ? '< 1 min' : `${etaMin} min`,
          distance: `${distanceMi} mi`,
          durationSec: Math.round(duration),
          distanceMeters: Math.round(distance),
          steps,
        };

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
    [map],
  );

  // ── Clear route from map ─────────────────────────────────
  const clearRouteFromMap = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
      if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    } catch { /* ignore cleanup errors */ }
  }, [map]);

  // ── Public API ───────────────────────────────────────────

  /** Show a route between a unit position and a call location */
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

  /** Clear the active route */
  const clearRoute = useCallback(() => {
    clearRouteFromMap();
    setActiveRoute(null);
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, [clearRouteFromMap]);

  /**
   * Update the route origin when unit GPS changes.
   * Throttled: re-queries only if 30s have elapsed AND unit
   * has moved > 100m since last query.
   */
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

  // ── Cleanup on unmount ───────────────────────────────────

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
