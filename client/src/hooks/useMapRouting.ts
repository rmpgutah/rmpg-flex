// ============================================================
// RMPG Flex — useMapRouting Hook
// Provides Google Maps Directions routing between a unit and
// a dispatch call location. Renders a polyline on the map with
// ETA and distance, auto-updates when unit GPS changes.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';

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
  /** Google Maps instance — must be set before calling showRoute */
  map: google.maps.Map | null;
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

/** Route polyline color (matches unit blue) */
const ROUTE_COLOR = '#888888';

// ─── Hook ───────────────────────────────────────────────────

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Internal refs — survive re-renders without triggering them
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const serviceRef = useRef<google.maps.DirectionsService | null>(null);
  const lastOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTimeRef = useRef<number>(0);
  const destRef = useRef<{ lat: number; lng: number } | null>(null);
  const metaRef = useRef<{ unitCallSign: string; callNumber: string }>({
    unitCallSign: '',
    callNumber: '',
  });

  // ── Lazily create DirectionsService & Renderer ──────────

  const ensureService = useCallback(() => {
    if (!serviceRef.current) {
      serviceRef.current = new google.maps.DirectionsService();
    }
    return serviceRef.current;
  }, []);

  const ensureRenderer = useCallback(() => {
    if (!rendererRef.current) {
      rendererRef.current = new google.maps.DirectionsRenderer({
        suppressMarkers: true, // we already render our own markers
        preserveViewport: true, // don't auto-zoom when route drawn
        polylineOptions: {
          strokeColor: ROUTE_COLOR,
          strokeWeight: 4,
          strokeOpacity: 0.8,
        },
      });
    }
    return rendererRef.current;
  }, []);

  // ── Query the Directions API ─────────────────────────────

  const queryRoute = useCallback(
    async (
      origin: google.maps.LatLngLiteral,
      destination: google.maps.LatLngLiteral,
    ): Promise<RouteInfo | null> => {
      if (!map) return null;

      const svc = ensureService();
      const renderer = ensureRenderer();

      setRouteLoading(true);

      try {
        const result = await new Promise<google.maps.DirectionsResult>(
          (resolve, reject) => {
            svc.route(
              {
                origin,
                destination,
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: {
                  departureTime: new Date(), // real-time traffic ETA
                  trafficModel: google.maps.TrafficModel.BEST_GUESS,
                },
                provideRouteAlternatives: false,
              },
              (res, status) => {
                if (status === google.maps.DirectionsStatus.OK && res) {
                  resolve(res);
                } else {
                  reject(new Error(`Directions failed: ${status}`));
                }
              },
            );
          },
        );

        renderer.setMap(map);
        renderer.setDirections(result);

        const leg = result.routes[0]?.legs[0];
        if (!leg) return null;

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: leg.duration_in_traffic?.text || leg.duration?.text || '—',
          distance: leg.distance?.text || '—',
          durationSec: leg.duration_in_traffic?.value || leg.duration?.value || 0,
          distanceMeters: leg.distance?.value || 0,
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
    [map, ensureService, ensureRenderer],
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
    if (rendererRef.current) {
      rendererRef.current.setMap(null);
    }
    setActiveRoute(null);
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, []);

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
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      serviceRef.current = null;
    };
  }, []);

  return {
    activeRoute,
    routeLoading,
    showRoute,
    clearRoute,
    updateOrigin,
  };
}
