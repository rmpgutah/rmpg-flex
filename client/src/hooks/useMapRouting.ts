// ============================================================
// RMPG Flex — useMapRouting Hook
// Provides Mapbox Directions routing between a unit and
// a dispatch call location. Renders a polyline on the map with
// ETA and distance, auto-updates when unit GPS changes.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { addMapboxTrail, removeMapboxTrail } from '../utils/mapboxLoader';
import { getCachedMapboxToken } from '../utils/mapboxApiKey';

// ─── Types ──────────────────────────────────────────────────

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
}

interface UseMapRoutingOptions {
  /** Mapbox map instance — must be set before calling showRoute */
  map: mapboxgl.Map | null;
}

// ─── Haversine (quick distance check to avoid unnecessary re-queries) ───

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000; // Earth radius in meters
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

const ROUTE_TRAIL_ID = 'map-routing-trail';

/** Format seconds into a human-readable ETA */
function formatEta(seconds: number): string {
  if (seconds < 60) return '<1 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/** Format meters into a human-readable distance */
function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters)} ft` : `${miles.toFixed(1)} mi`;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Internal refs — survive re-renders without triggering them
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
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ): Promise<RouteInfo | null> => {
      if (!map) return null;

      const token = getCachedMapboxToken();
      if (!token) return null;

      setRouteLoading(true);

      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${token}&geometries=geojson&overview=full`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Directions failed: ${res.status}`);
        const data = await res.json();
        const route = data.routes?.[0];
        if (!route) return null;

        // Draw the route polyline on the map
        if (route.geometry?.coordinates) {
          addMapboxTrail(map, ROUTE_TRAIL_ID, route.geometry.coordinates, '#888888', 4);
        }

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: formatEta(route.duration || 0),
          distance: formatDistance(route.distance || 0),
          durationSec: route.duration || 0,
          distanceMeters: route.distance || 0,
        };

        lastOriginRef.current = origin;
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

  // ── Public API ────────────────────────────────────────────

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
    if (map) {
      removeMapboxTrail(map, ROUTE_TRAIL_ID);
    }
    setActiveRoute(null);
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, [map]);

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

      // Re-query
      queryRoute({ lat: newLat, lng: newLng }, destRef.current);
    },
    [queryRoute],
  );

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (map) {
        removeMapboxTrail(map, ROUTE_TRAIL_ID);
      }
    };
  }, [map]);

  return {
    activeRoute,
    routeLoading,
    showRoute,
    clearRoute,
    updateOrigin,
  };
}
