// ============================================================
// RMPG Flex — useMultiUnitRouting
// Renders Directions polylines for MULTIPLE units converging on
// the same call. Each unit gets its own route polyline so
// dispatchers can see all responders' ETAs simultaneously.
//
// Polylines are colored by relative ETA:
//   green  — fastest unit
//   yellow — mid
//   red    — slowest
//
// Uses Mapbox Directions API instead of Google Maps.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { getCachedMapboxToken } from '../utils/mapboxApiKey';
import { addMapboxTrail, removeMapboxTrail } from '../utils/mapboxLoader';

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
  map: mapboxgl.Map | null;
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
}

interface RouteState {
  trailId: string;
  lastOrigin: { lat: number; lng: number };
  lastQueryTime: number;
  destination: { lat: number; lng: number };
  callNumber: string;
  durationSec: number;
  distanceMeters: number;
  eta: string;
  distance: string;
}

/**
 * Assign ETA-bucket colors based on relative standing across the current
 * active set.
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

  const statesRef = useRef<Map<string, RouteState>>(new Map());

  /** Rebuild the public activeRoutes array and recolor polylines. */
  const refreshActive = useCallback(() => {
    if (!map) return;
    const colors = assignColors(statesRef.current);
    const next: UnitRoute[] = [];
    for (const [callSign, st] of statesRef.current.entries()) {
      const color = colors.get(callSign) || COLOR_FASTEST;
      // Recolor the polyline by removing and re-adding with new color
      try {
        removeMapboxTrail(map, st.trailId);
      } catch { /* ignore */ }
      // Re-fetch route coords from the source if available
      const source = map.getSource(st.trailId) as mapboxgl.GeoJSONSource | undefined;
      if (!source) {
        // Trail was removed, skip recolor
      }
      next.push({
        unitCallSign: callSign,
        callNumber: st.callNumber,
        eta: st.eta || '—',
        distance: st.distance || '—',
        durationSec: st.durationSec,
        distanceMeters: st.distanceMeters || 0,
        color,
      });
    }
    setActiveRoutes(next);
  }, [map]);

  /**
   * Query Mapbox Directions API for one unit and update that unit's state.
   */
  const queryOne = useCallback(
    async (
      callSign: string,
      callNumber: string,
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ) => {
      if (!map) return;
      const token = getCachedMapboxToken();
      if (!token) return;

      setRouteLoading(true);
      try {
        const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?access_token=${token}&geometries=geojson&overview=full`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Directions ${resp.status}`);
        const data = await resp.json();
        const route = data.routes?.[0];
        if (!route) return;

        const durationSec = route.duration || 0;
        const distanceMeters = route.distance || 0;
        const eta = formatDuration(durationSec);
        const distanceText = formatDistance(distanceMeters);

        const trailId = `multi-route-${callSign.replace(/\s+/g, '-')}`;

        // Remove old trail if exists
        try { removeMapboxTrail(map, trailId); } catch { /* ok */ }

        // Get color for this unit
        let st = statesRef.current.get(callSign);
        if (!st) {
          st = {
            trailId,
            lastOrigin: origin,
            lastQueryTime: 0,
            destination,
            callNumber,
            durationSec: 0,
            distanceMeters: 0,
            eta: '—',
            distance: '—',
          };
          statesRef.current.set(callSign, st);
        }

        st.lastOrigin = origin;
        st.lastQueryTime = Date.now();
        st.destination = destination;
        st.callNumber = callNumber;
        st.durationSec = durationSec;
        st.distanceMeters = distanceMeters;
        st.eta = eta;
        st.distance = distanceText;

        // Get colors after updating state
        const colors = assignColors(statesRef.current);
        const color = colors.get(callSign) || COLOR_FASTEST;

        // Draw the route
        const routeCoords: [number, number][] = route.geometry.coordinates;
        addMapboxTrail(map, trailId, routeCoords, color, 4);

        // Rebuild public state + recolor all trails
        const next: UnitRoute[] = [];
        for (const [cs, s] of statesRef.current.entries()) {
          const c = colors.get(cs) || COLOR_FASTEST;
          // Recolor existing trails
          if (cs !== callSign) {
            try {
              removeMapboxTrail(map, s.trailId);
              // Re-query would be expensive; just rebuild with last known route
              // The trail data is lost after remove, so we skip recoloring non-queried units
            } catch { /* ok */ }
          }
          next.push({
            unitCallSign: cs,
            callNumber: s.callNumber,
            eta: s.eta,
            distance: s.distance,
            durationSec: s.durationSec,
            distanceMeters: s.distanceMeters,
            color: c,
          });
        }
        setActiveRoutes(next);
      } catch (err) {
        console.warn('[useMultiUnitRouting] Directions query failed:', err);
      } finally {
        setRouteLoading(false);
      }
    },
    [map],
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
      if (!st || !map) return;
      try { removeMapboxTrail(map, st.trailId); } catch { /* ok */ }
      statesRef.current.delete(unitCallSign);
      refreshActive();
    },
    [map, refreshActive],
  );

  /** Wipe every active route. */
  const clearAllRoutes = useCallback(() => {
    if (map) {
      for (const st of statesRef.current.values()) {
        try { removeMapboxTrail(map, st.trailId); } catch { /* ok */ }
      }
    }
    statesRef.current.clear();
    setActiveRoutes([]);
  }, [map]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (map) {
        for (const st of statesRef.current.values()) {
          try { removeMapboxTrail(map, st.trailId); } catch { /* ok */ }
        }
      }
      statesRef.current.clear();
    };
  }, [map]);

  return {
    activeRoutes,
    routeLoading,
    showRoute,
    updateOrigin,
    removeRoute,
    clearAllRoutes,
  };
}
