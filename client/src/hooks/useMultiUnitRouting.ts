// ============================================================
// RMPG Flex — useMultiUnitRouting
// Renders Directions polylines for MULTIPLE units converging on
// the same call. Each unit gets its own DirectionsRenderer so
// dispatchers can see all responders' ETAs simultaneously.
//
// Polylines are colored by relative ETA:
//   green  — fastest unit
//   yellow — mid
//   red    — slowest
// This matches officer mental model of "who's closest" without
// requiring them to read the ETA text on every polyline.
//
// Throttling mirrors useMapRouting: at most one re-query per
// unit per 30s, and only if the unit has moved >100m. Cheap
// GPS callbacks (every 1s) don't burn Directions quota.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────

export interface UnitRoute {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
  /** Rendered polyline color — determined by relative-ETA bucket */
  color: string;
}

interface UseMultiUnitRoutingOptions {
  map: google.maps.Map | null;
}

// ─── Constants ──────────────────────────────────────────────

const REROUTE_THROTTLE_MS = 30_000;
const REROUTE_DISTANCE_THRESHOLD = 100; // meters

/** ETA-bucket colors (fastest → slowest) */
const COLOR_FASTEST = '#22c55e'; // green
const COLOR_MID = '#eab308'; // amber
const COLOR_SLOWEST = '#ef4444'; // red

// ─── Helpers ────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface RouteState {
  renderer: google.maps.DirectionsRenderer;
  lastOrigin: { lat: number; lng: number };
  lastQueryTime: number;
  destination: { lat: number; lng: number };
  callNumber: string;
  durationSec: number;
}

/**
 * Assign ETA-bucket colors based on relative standing across the current
 * active set. One unit → green. Two units → green + red. Three+ → green /
 * amber / red distributed by sorted durationSec.
 */
function assignColors(statesByCallSign: Map<string, RouteState>): Map<string, string> {
  const colors = new Map<string, string>();
  const sorted = [...statesByCallSign.entries()].sort(
    (a, b) => a[1].durationSec - b[1].durationSec,
  );
  if (sorted.length === 0) return colors;
  if (sorted.length === 1) {
    colors.set(sorted[0][0], COLOR_FASTEST);
    return colors;
  }
  if (sorted.length === 2) {
    colors.set(sorted[0][0], COLOR_FASTEST);
    colors.set(sorted[1][0], COLOR_SLOWEST);
    return colors;
  }
  // 3+ units: fastest = green, slowest = red, everyone else = amber
  sorted.forEach(([callSign], idx) => {
    if (idx === 0) colors.set(callSign, COLOR_FASTEST);
    else if (idx === sorted.length - 1) colors.set(callSign, COLOR_SLOWEST);
    else colors.set(callSign, COLOR_MID);
  });
  return colors;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMultiUnitRouting({ map }: UseMultiUnitRoutingOptions) {
  const [activeRoutes, setActiveRoutes] = useState<UnitRoute[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);

  const serviceRef = useRef<google.maps.DirectionsService | null>(null);
  const statesRef = useRef<Map<string, RouteState>>(new Map());

  const ensureService = useCallback(() => {
    if (!serviceRef.current) {
      serviceRef.current = new google.maps.DirectionsService();
    }
    return serviceRef.current;
  }, []);

  /** Rebuild the public activeRoutes array and recolor polylines. */
  const refreshActive = useCallback(() => {
    const colors = assignColors(statesRef.current);
    const next: UnitRoute[] = [];
    for (const [callSign, st] of statesRef.current.entries()) {
      const color = colors.get(callSign) || COLOR_FASTEST;
      // Recolor the polyline — cheap and keeps visual consistent when a
      // faster unit joins mid-response.
      st.renderer.setOptions({
        polylineOptions: { strokeColor: color, strokeWeight: 4, strokeOpacity: 0.85 },
      });
      next.push({
        unitCallSign: callSign,
        callNumber: st.callNumber,
        // Text fields are filled by query; placeholder prevents stale strings
        eta: '—',
        distance: '—',
        durationSec: st.durationSec,
        distanceMeters: 0,
        color,
      });
    }
    setActiveRoutes(next);
  }, []);

  /**
   * Query Directions for one unit and update that unit's state.
   * Callers are expected to throttle; we don't throttle here so
   * re-rendering with updated colors after removeRoute stays snappy.
   */
  const queryOne = useCallback(
    async (
      callSign: string,
      callNumber: string,
      origin: google.maps.LatLngLiteral,
      destination: google.maps.LatLngLiteral,
    ) => {
      if (!map) return;
      const svc = ensureService();
      setRouteLoading(true);
      try {
        const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
          svc.route(
            {
              origin,
              destination,
              travelMode: google.maps.TravelMode.DRIVING,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
              provideRouteAlternatives: false,
            },
            (res, status) => {
              if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
              else reject(new Error(`Directions ${status}`));
            },
          );
        });
        const leg = result.routes[0]?.legs[0];
        if (!leg) return;

        // Reuse an existing renderer for the unit, or create one.
        let st = statesRef.current.get(callSign);
        if (!st) {
          const renderer = new google.maps.DirectionsRenderer({
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: {
              strokeColor: COLOR_FASTEST,
              strokeWeight: 4,
              strokeOpacity: 0.85,
            },
          });
          renderer.setMap(map);
          st = {
            renderer,
            lastOrigin: origin,
            lastQueryTime: 0,
            destination,
            callNumber,
            durationSec: 0,
          };
          statesRef.current.set(callSign, st);
        }
        st.renderer.setDirections(result);
        st.lastOrigin = origin;
        st.lastQueryTime = Date.now();
        st.destination = destination;
        st.callNumber = callNumber;
        st.durationSec = leg.duration_in_traffic?.value || leg.duration?.value || 0;

        // Rebuild public state + recolor
        const colors = assignColors(statesRef.current);
        const next: UnitRoute[] = [];
        for (const [cs, s] of statesRef.current.entries()) {
          const color = colors.get(cs) || COLOR_FASTEST;
          s.renderer.setOptions({
            polylineOptions: { strokeColor: color, strokeWeight: 4, strokeOpacity: 0.85 },
          });
          // Pull text-based fields from this query for the matching unit,
          // use previous values for others (they'll be refreshed on their
          // own update).
          if (cs === callSign) {
            next.push({
              unitCallSign: cs,
              callNumber: s.callNumber,
              eta: leg.duration_in_traffic?.text || leg.duration?.text || '—',
              distance: leg.distance?.text || '—',
              durationSec: s.durationSec,
              distanceMeters: leg.distance?.value || 0,
              color,
            });
          } else {
            // Keep previously-known text if present; otherwise placeholder.
            const prev = activeRoutes.find((r) => r.unitCallSign === cs);
            next.push({
              unitCallSign: cs,
              callNumber: s.callNumber,
              eta: prev?.eta || '—',
              distance: prev?.distance || '—',
              durationSec: s.durationSec,
              distanceMeters: prev?.distanceMeters || 0,
              color,
            });
          }
        }
        setActiveRoutes(next);
      } catch (err) {
        console.warn('[useMultiUnitRouting] Directions query failed:', err);
      } finally {
        setRouteLoading(false);
      }
    },
    [map, ensureService, activeRoutes],
  );

  /** Show/refresh a route for one unit. */
  const showRoute = useCallback(
    (
      unitCallSign: string,
      callNumber: string,
      unitLat: number,
      unitLng: number,
      callLat: number,
      callLng: number,
    ) => {
      return queryOne(
        unitCallSign,
        callNumber,
        { lat: unitLat, lng: unitLng },
        { lat: callLat, lng: callLng },
      );
    },
    [queryOne],
  );

  /** Update origin for one unit when its GPS moves — throttled. */
  const updateOrigin = useCallback(
    (unitCallSign: string, newLat: number, newLng: number) => {
      const st = statesRef.current.get(unitCallSign);
      if (!st) return;
      const elapsed = Date.now() - st.lastQueryTime;
      if (elapsed < REROUTE_THROTTLE_MS) return;
      const moved = haversineMeters(st.lastOrigin.lat, st.lastOrigin.lng, newLat, newLng);
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;
      queryOne(unitCallSign, st.callNumber, { lat: newLat, lng: newLng }, st.destination);
    },
    [queryOne],
  );

  /** Remove a single unit's route. */
  const removeRoute = useCallback(
    (unitCallSign: string) => {
      const st = statesRef.current.get(unitCallSign);
      if (!st) return;
      st.renderer.setMap(null);
      statesRef.current.delete(unitCallSign);
      refreshActive();
    },
    [refreshActive],
  );

  /** Wipe every active route. */
  const clearAllRoutes = useCallback(() => {
    for (const st of statesRef.current.values()) {
      st.renderer.setMap(null);
    }
    statesRef.current.clear();
    setActiveRoutes([]);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const st of statesRef.current.values()) {
        st.renderer.setMap(null);
      }
      statesRef.current.clear();
      serviceRef.current = null;
    };
  }, []);

  return {
    activeRoutes,
    routeLoading,
    showRoute,
    updateOrigin,
    removeRoute,
    clearAllRoutes,
  };
}
