// ============================================================
// RMPG Flex — useNavGuidanceEngine Hook
//
// MAP-FREE turn-by-turn guidance engine. Owns the active destination, the
// Mapbox Directions route (traffic-aware, with steps + congestion), live
// progress (remaining ETA/distance via route snapping), off-route detection,
// and automatic re-routing — with NO map rendering and NO page coupling.
//
// WHY: this engine is hosted app-wide by NavTripProvider so navigation keeps
// calculating while the officer is on Dispatch, Records, or any other page.
// Previously all of this state lived inside useMapRouting, instantiated BY
// NavigationPage — switching pages unmounted it and silently reset the route
// (destination lost, ETA gone, and on return the assigned-call auto-route
// could clobber a searched destination). The drive HUD now only RENDERS what
// this engine computes; unmounting the HUD no longer stops navigation.
//
// useMapRouting still exists unchanged for MapPage (dispatcher tooling:
// closest-unit matrix, multi-stop optimization, on-map call routes). The two
// share types + snapToRoute; the Directions fetch here is deliberately
// render-free.
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import {
  snapToRoute,
  type RouteInfo,
  type RouteProgress,
  type RouteGeom,
  type RouteStep,
  type CongestionLevel,
} from './useMapRouting';
import {
  nextWaypointIndex,
  hasArrivedAtWaypoint,
  advanceWaypoint,
  type NavWaypoint,
} from './waypointAdvance';

export type { NavWaypoint } from './waypointAdvance';

// ─── Types ──────────────────────────────────────────────────

/** The active navigation destination. `label` is the human destination line
 *  ("450 S Main St"); `callNumber` doubles as the label for searched
 *  destinations and is the CFS number for assigned-call routes. */
export interface GuidanceDestination {
  lat: number;
  lng: number;
  label: string | null;
  callNumber: string;
  unitCallSign: string;
}

/** Everything a page needs to DRAW the active route: the raw GeoJSON
 *  geometry, per-segment congestion classes, and the cumulative-distance
 *  table that maps congestion segments onto line-progress fractions. */
export interface RouteRenderData {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  congestion: CongestionLevel[];
  cum: number[];
  totalMeters: number;
}

// ─── Formatting (mirrors useMapRouting) ─────────────────────

const fmtMiles = (m: number) => `${(m * 0.000621371).toFixed(1)} mi`;
const fmtEta = (sec: number) => {
  const min = Math.round(sec / 60);
  return min < 1 ? '< 1 min' : `${min} min`;
};
const fmtStepDist = (m: number) =>
  m >= 1609 ? `${(m * 0.000621371).toFixed(1)} mi` : `${Math.round(m * 3.28084)} ft`;

// ─── Guardrails + reroute tuning (mirrors useMapRouting) ────

const VALID_LAT_MIN = 18.0;
const VALID_LAT_MAX = 72.0;
const VALID_LNG_MIN = -180.0;
const VALID_LNG_MAX = -64.0;
const MAX_POSITION_JUMP_MI = 50;
const REROUTE_THROTTLE_MS = 30_000;
const REROUTE_DISTANCE_THRESHOLD = 100;
const CORRIDOR_METERS = 45;
const OFFROUTE_SAMPLES = 3;
// Multi-stop waypoint arrival radius. No single-destination "arrival" concept
// lives in this engine today — NavigationPage detects arrival page-side via a
// crow-flight 0.15 mi (~241 m) threshold against guidance.destination (see
// NavigationPage.tsx destCrowMi). Reused here so a waypoint-to-waypoint
// advance in a multi-stop route fires at the same real-world distance as the
// existing single-destination "Arrived" banner.
const WAYPOINT_ARRIVAL_METERS = 241;

const CONGESTION_RANK: Record<CongestionLevel, number> = { low: 0, moderate: 1, heavy: 2, severe: 3, unknown: -1 };

/** Congestion class → line color (mirrors useMapRouting). */
export const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  low: '#22c55e',
  moderate: '#eab308',
  heavy: '#f97316',
  severe: '#ef4444',
  unknown: '#888888',
};

/** Build a Mapbox `line-gradient` step expression from per-segment congestion.
 *  Returns null when a valid step expr can't be formed (single segment) — the
 *  caller should fall back to a flat line-color. Module-level (not hook state)
 *  so page renderers can paint the engine's route without owning the engine. */
export function buildCongestionGradient(
  cum: number[],
  total: number,
  congestion: CongestionLevel[],
): any | null {
  if (!congestion.length || total <= 0) return null;
  const expr: any[] = ['step', ['line-progress'], CONGESTION_COLOR[congestion[0]]];
  let lastFrac = 0;
  for (let i = 1; i < congestion.length; i++) {
    const frac = Math.min(cum[i] / total, 0.9999);
    if (frac <= lastFrac) continue; // strictly increasing stops required
    expr.push(frac, CONGESTION_COLOR[congestion[i]]);
    lastFrac = frac;
  }
  // A Mapbox `step` needs at least one stop PAIR (length >= 5); a stop-less
  // expr throws on addLayer.
  return expr.length >= 5 ? expr : null;
}

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

function validCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= VALID_LAT_MIN && lat <= VALID_LAT_MAX &&
    lng >= VALID_LNG_MIN && lng <= VALID_LNG_MAX
  );
}

// ─── Hook ───────────────────────────────────────────────────

export function useNavGuidanceEngine() {
  const [destination, setDestination] = useState<GuidanceDestination | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeProgress, setRouteProgress] = useState<RouteProgress | null>(null);
  const [routeGeom, setRouteGeom] = useState<RouteGeom | null>(null);
  const [routeRender, setRouteRender] = useState<RouteRenderData | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [waypoints, setWaypoints] = useState<NavWaypoint[]>([]);

  const destRef = useRef<GuidanceDestination | null>(null);
  const waypointsRef = useRef<NavWaypoint[]>([]);
  const geomRef = useRef<{ coords: [number, number][]; cum: number[]; totalMeters: number; totalSec: number } | null>(null);
  const lastOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTimeRef = useRef<number>(0);
  const offRouteStreakRef = useRef(0);
  const queryInFlightRef = useRef(false);
  // Generation counter: bumped on every start/stop so a stale in-flight
  // Directions response can never resurrect a cleared/replaced route.
  const genRef = useRef(0);

  // ── Directions query (fetch + state only; no map painting) ──
  const queryRoute = useCallback(async (
    origin: { lat: number; lng: number },
    dest: GuidanceDestination,
  ): Promise<RouteInfo | null> => {
    if (queryInFlightRef.current) return null;
    queryInFlightRef.current = true;
    const gen = genRef.current;
    setRouteLoading(true);
    try {
      // Routed through the Worker's /api/mapbox/directions proxy
      // (src/routes/mapbox.ts) rather than hitting api.mapbox.com directly
      // with an embedded public token — the officer's live turn-by-turn
      // route no longer depends on the client holding any Mapbox credential
      // at all; the MAPBOX_ACCESS_TOKEN secret stays server-side. Uses the
      // same auth (rmpg_token bearer) as every other apiFetch call.
      const coordStr = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
      const data = await apiFetch<{ routes?: any[] }>(
        `/mapbox/directions?coordinates=${encodeURIComponent(coordStr)}` +
        `&profile=driving-traffic&geometries=geojson&overview=full&steps=true&annotations=congestion`,
      );
      const route = data.routes?.[0];
      if (!route) throw new Error('No route found');
      if (gen !== genRef.current) return null; // guidance changed mid-fetch — discard

      const duration: number = route.duration;
      const distance: number = route.distance;
      const coords: [number, number][] = route.geometry?.coordinates ?? [];
      if (coords.length < 2) return null;

      const cum: number[] = [0];
      for (let i = 1; i < coords.length; i++) {
        cum[i] = cum[i - 1] + haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      }
      const total = cum[cum.length - 1] || distance;

      const rawCong: string[] = route.legs?.[0]?.annotation?.congestion ?? [];
      const congestion: CongestionLevel[] = rawCong.map((c) =>
        c === 'low' || c === 'moderate' || c === 'heavy' || c === 'severe' ? c : 'unknown',
      );
      let worst: CongestionLevel = 'unknown';
      for (const c of congestion) if (CONGESTION_RANK[c] > CONGESTION_RANK[worst]) worst = c;

      const steps: RouteStep[] = ((route.legs?.[0]?.steps ?? []) as any[]).map((s) => {
        const man = s.maneuver || {};
        const meters = typeof s.distance === 'number' ? s.distance : 0;
        const rawLanes = s.intersections?.[0]?.lanes as
          { valid?: boolean; active?: boolean; indications?: string[] }[] | undefined;
        return {
          instruction: man.instruction || s.name || 'Continue',
          distanceMeters: Math.round(meters),
          distanceText: fmtStepDist(meters),
          maneuverType: man.type || '',
          modifier: man.modifier,
          lanes: rawLanes?.map((l) => ({
            valid: l.valid === true,
            active: l.active === true,
            indications: Array.isArray(l.indications) ? l.indications : [],
          })),
        };
      });

      const info: RouteInfo = {
        unitCallSign: dest.unitCallSign,
        callNumber: dest.callNumber,
        eta: fmtEta(duration),
        distance: fmtMiles(distance),
        durationSec: Math.round(duration),
        distanceMeters: Math.round(distance),
        steps,
        trafficAware: true,
        worstCongestion: worst,
      };

      geomRef.current = { coords, cum, totalMeters: total, totalSec: duration };
      offRouteStreakRef.current = 0;
      lastOriginRef.current = origin;
      lastQueryTimeRef.current = Date.now();
      setOffRoute(false);
      setRouteGeom({ coords, cum, totalMeters: total });
      setRouteRender({
        geometry: { type: 'LineString', coordinates: coords },
        congestion,
        cum,
        totalMeters: total,
      });
      setActiveRoute(info);
      setRouteProgress({
        fraction: 0,
        remainingMeters: Math.round(distance),
        remainingDistance: fmtMiles(distance),
        remainingSec: Math.round(duration),
        remainingEta: fmtEta(duration),
        offRouteMeters: 0,
      });
      return info;
    } catch (err) {
      console.warn('[navGuidance] Directions query failed:', err);
      return null;
    } finally {
      queryInFlightRef.current = false;
      setRouteLoading(false);
    }
  }, []);

  // ── Public API ───────────────────────────────────────────

  /** Begin (or replace) guidance to a destination. Same coordinate contract
   *  as useMapRouting.showRoute. */
  const startGuidance = useCallback(async (
    unitCallSign: string,
    callNumber: string,
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    label?: string | null,
  ): Promise<RouteInfo | null> => {
    if (!validCoord(originLat, originLng) || !validCoord(destLat, destLng)) {
      console.warn('[navGuidance] startGuidance rejected: invalid coordinates');
      return null;
    }
    genRef.current += 1;
    queryInFlightRef.current = false; // new generation supersedes any in-flight query
    const dest: GuidanceDestination = {
      lat: destLat, lng: destLng,
      label: label ?? null,
      callNumber, unitCallSign,
    };
    destRef.current = dest;
    setDestination(dest);
    return queryRoute({ lat: originLat, lng: originLng }, dest);
  }, [queryRoute]);

  /** Begin a multi-stop route: sets the waypoint list and routes to the first
   *  incomplete stop via the same startGuidance path a single-destination
   *  route uses. Each waypoint's `id`/`label` become the route's
   *  callNumber/label so the existing HUD ("to <label>") needs no changes. */
  const startMultiStop = useCallback((
    unitCallSign: string,
    originLat: number,
    originLng: number,
    stops: NavWaypoint[],
  ): Promise<RouteInfo | null> => {
    waypointsRef.current = stops;
    setWaypoints(stops);
    const idx = nextWaypointIndex(stops);
    if (idx === null) return Promise.resolve(null);
    const wp = stops[idx];
    return startGuidance(unitCallSign, String(wp.id), originLat, originLng, wp.lat, wp.lng, wp.label);
  }, [startGuidance]);

  /** End guidance and clear all derived state. */
  const stopGuidance = useCallback(() => {
    genRef.current += 1;
    queryInFlightRef.current = false;
    destRef.current = null;
    geomRef.current = null;
    lastOriginRef.current = null;
    offRouteStreakRef.current = 0;
    waypointsRef.current = [];
    setWaypoints([]);
    setDestination(null);
    setActiveRoute(null);
    setRouteProgress(null);
    setRouteGeom(null);
    setRouteRender(null);
    setOffRoute(false);
  }, []);

  /** Read the live destination from inside async closures / stale renders. */
  const getDestination = useCallback((): GuidanceDestination | null => destRef.current, []);

  /** Feed a GPS fix: recompute progress, detect off-route (debounced over
   *  consecutive fixes), and re-route — forced when off-corridor, otherwise
   *  throttled (30s + 100m). Runs app-wide via NavTripProvider, so this keeps
   *  firing while the officer is on Dispatch/Records/etc. */
  const updateOrigin = useCallback((lat: number, lng: number) => {
    const dest = destRef.current;
    const g = geomRef.current;
    if (!dest || !g || g.coords.length < 2) return;
    if (!validCoord(lat, lng)) return;

    // Multi-stop advance: only engages when a waypoint list is active
    // (empty by default) — a no-op for every existing single-destination
    // caller, preserving today's behavior byte-for-byte.
    if (waypointsRef.current.length > 0 && hasArrivedAtWaypoint(waypointsRef.current, lat, lng, WAYPOINT_ARRIVAL_METERS)) {
      const advanced = advanceWaypoint(waypointsRef.current);
      waypointsRef.current = advanced;
      setWaypoints(advanced);
      const nextIdx = nextWaypointIndex(advanced);
      if (nextIdx !== null) {
        const wp = advanced[nextIdx];
        startGuidance(dest.unitCallSign, String(wp.id), lat, lng, wp.lat, wp.lng, wp.label);
        return;
      }
      // Final stop reached — fall through to the existing single-destination
      // logic below (unchanged), which already drives NavigationPage's
      // crow-flight "Arrived" banner off guidance.destination/routeProgress.
    }

    // Jump detection — reject teleportation glitches.
    if (lastOriginRef.current) {
      const jumpMi = haversineMeters(lastOriginRef.current.lat, lastOriginRef.current.lng, lat, lng) * 0.000621371;
      if (jumpMi > MAX_POSITION_JUMP_MI) return;
    }

    const { offRouteMeters, distAlong } = snapToRoute(g.coords, g.cum, lat, lng);
    const fraction = g.totalMeters > 0 ? Math.min(Math.max(distAlong / g.totalMeters, 0), 1) : 0;
    const remainingMeters = Math.max(g.totalMeters - distAlong, 0);
    const remainingSec = g.totalMeters > 0 ? Math.round(g.totalSec * (remainingMeters / g.totalMeters)) : 0;
    setRouteProgress({
      fraction,
      remainingMeters: Math.round(remainingMeters),
      remainingDistance: fmtMiles(remainingMeters),
      remainingSec,
      remainingEta: fmtEta(remainingSec),
      offRouteMeters: Math.round(offRouteMeters),
    });

    // Off-route detection + forced re-route (debounced over consecutive fixes).
    if (offRouteMeters > CORRIDOR_METERS) {
      offRouteStreakRef.current += 1;
    } else {
      offRouteStreakRef.current = 0;
      setOffRoute(false);
    }
    if (offRouteMeters > CORRIDOR_METERS && offRouteStreakRef.current >= OFFROUTE_SAMPLES) {
      setOffRoute(true);
      offRouteStreakRef.current = 0;
      queryRoute({ lat, lng }, dest);
      return;
    }

    // Routine throttled re-route (keeps traffic-aware ETA honest).
    const elapsed = Date.now() - lastQueryTimeRef.current;
    if (elapsed < REROUTE_THROTTLE_MS) return;
    const last = lastOriginRef.current;
    if (last) {
      const moved = haversineMeters(last.lat, last.lng, lat, lng);
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;
    }
    queryRoute({ lat, lng }, dest);
  }, [queryRoute, startGuidance]);

  return {
    destination,
    activeRoute,
    routeProgress,
    routeGeom,
    routeRender,
    offRoute,
    routeLoading,
    waypoints,
    startGuidance,
    startMultiStop,
    stopGuidance,
    updateOrigin,
    getDestination,
  };
}

export type NavGuidanceEngine = ReturnType<typeof useNavGuidanceEngine>;
