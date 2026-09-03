// ============================================================
// RMPG Flex — useMapRouting Hook
// Mapbox-powered routing between a unit and a dispatch call.
// Renders a polyline on the map with ETA and distance, and adds
// seven advanced dispatch-grade routing capabilities:
//   1. Live traffic-aware routing (driving-traffic profile)
//   2. Congestion-colored route line (green→yellow→orange→red)
//   3. Live route progress + dynamic remaining ETA
//   4. Off-route detection + automatic re-route
//   5. Closest-unit-by-drive-time (Mapbox Matrix API)
//   6. Pause/resume travel calculation (officer control)
//   7. Coordinate guardrails (bounds, sanity, jump detection)
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
// Type-only — erased at compile time. This hook is reachable from the
// always-mounted NavTripContext (app-wide trip detection), so a runtime
// `import { mapboxgl } from '../utils/mapboxLoader'` here was forcing the
// full mapbox-gl + deck.gl SDK (~2.3MB) onto every authenticated session,
// including roles that never touch a map. The two call sites that need the
// real runtime value (new mapboxgl.Marker/.LngLatBounds) already receive an
// already-instantiated `mapboxgl.Map`, so mapboxLoader is guaranteed to be
// loaded by then — they import it dynamically at point of use instead
// (2026-07-02 perf fix).
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { useNavTravel } from './useNavTravel';
import { getSourceSafe, hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { decodeMaxspeedAnnotation } from '../utils/speedLimit';
import { importWithRetry } from '../utils/importWithRetry';

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
  /**
   * Lane guidance for this step's upcoming maneuver, if Mapbox provided it
   * (only present at multi-lane decision points — absent on most steps).
   */
  lanes?: RouteStepLane[];
}

/** One lane's guidance state at a maneuver. */
export interface RouteStepLane {
  /** Whether this lane can be used to complete the upcoming maneuver. */
  valid: boolean;
  /** Mapbox's recommended lane, when provided. */
  active: boolean;
  /** Directions this lane permits, e.g. ["straight", "left"]. */
  indications: string[];
}

/** How many leading segments to scan for a posted limit before giving up. */
const MAXSPEED_LOOKAHEAD_SEGMENTS = 8;

/**
 * The posted limit for the segment the unit is on right now.
 *
 * `annotation.maxspeed` is per-segment along the route, and useMapRouting
 * recomputes from the unit's LIVE origin, so index 0 is the segment under the
 * vehicle. A short unmapped stub at the origin is common, so scan a few
 * segments ahead — but only a few, since segments far down the route describe
 * a different road.
 */
export function pickCurrentSegmentLimit(annotation: unknown[]): number | null {
  if (!Array.isArray(annotation) || annotation.length === 0) return null;
  const limit = Math.min(annotation.length, MAXSPEED_LOOKAHEAD_SEGMENTS);
  for (let i = 0; i < limit; i++) {
    const mph = decodeMaxspeedAnnotation(annotation[i]);
    if (mph != null) return mph;
  }
  return null;
}

export interface RouteInfo {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
  /** Point-by-point turn-by-turn directions (unit → call). */
  steps: RouteStep[];
  /** True when this ETA reflects live traffic (driving-traffic profile). */
  trafficAware: boolean;
  /** Worst congestion class anywhere on the route, for a headline badge. */
  worstCongestion: CongestionLevel;
  /** Posted speed limit (mph) for the segment being driven now, or null.
   *  Sourced from Mapbox's `annotation.maxspeed`, which rides along in the
   *  same Directions request that produces the ETA and the turn-by-turn steps. */
  postedLimitMph: number | null;
}

/** Live progress of the routed unit toward the call. */
export interface RouteProgress {
  /** Fraction of the route completed, 0–1. */
  fraction: number;
  /** Remaining distance to the call, meters. */
  remainingMeters: number;
  /** Remaining distance text, e.g. "1.2 mi". */
  remainingDistance: string;
  /** Remaining time, seconds (scaled by traffic-aware avg speed). */
  remainingSec: number;
  /** Remaining ETA text, e.g. "4 min". */
  remainingEta: string;
  /** Perpendicular distance from the unit to the route line, meters. */
  offRouteMeters: number;
}

/** A candidate responding unit ranked by real drive time to a call. */
export interface UnitDriveTime {
  callSign: string;
  /** Drive-time ETA in seconds (traffic-aware when available). */
  etaSec: number;
  /** ETA text, e.g. "6 min". */
  etaText: string;
  /** Road distance in meters. */
  distanceMeters: number;
  /** Distance text, e.g. "2.4 mi". */
  distanceText: string;
}

export type CongestionLevel = 'low' | 'moderate' | 'heavy' | 'severe' | 'unknown';

/** Active route geometry, exposed for downstream corridor analysis
 *  (e.g. hazard-ahead scanning in useNavGuidance). */
export interface RouteGeom {
  /** Route polyline as [lng, lat][]. */
  coords: [number, number][];
  /** Cumulative meters at each coordinate. */
  cum: number[];
  /** Total route length in meters. */
  totalMeters: number;
}

/** One stop in an optimized multi-call patrol route. */
export interface MultiStop {
  callNumber: string;
  lat: number;
  lng: number;
  /** Short label for the stop (incident type / address), optional. */
  label?: string;
  /** 1-based position in the optimized visit order. */
  order: number;
  /** Drive time from the previous stop (or the unit) to here, seconds. */
  legSec: number;
  /** Drive distance from the previous stop to here, meters. */
  legMeters: number;
  /** Leg ETA text, e.g. "6 min". */
  legEta: string;
  /** Leg distance text, e.g. "2.4 mi". */
  legDistance: string;
  /** Cumulative ETA from the unit to this stop, text. */
  cumEta: string;
}

/** An optimized one-unit-many-calls route (Mapbox Optimization API / TSP). */
export interface MultiStopRoute {
  /** Origin unit call sign. */
  unitCallSign: string;
  /** Stops in optimized visit order. */
  stops: MultiStop[];
  /** Total drive time across all legs, text. */
  totalEta: string;
  /** Total drive time, seconds. */
  totalSec: number;
  /** Total drive distance, text. */
  totalDistance: string;
  /** Total drive distance, meters. */
  totalMeters: number;
}

interface UseMapRoutingOptions {
  /** Mapbox Map instance — must be set before calling showRoute */
  map: mapboxgl.Map | null;
}

// ─── Geometry helpers ───────────────────────────────────────

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

/** Local equirectangular projection (lng/lat → meters) around a reference
 *  latitude. Accurate to well under a meter at city scale, and lets us do
 *  cheap planar point-to-segment math for snapping a unit onto the route. */
function makeProjector(refLat: number) {
  const mPerDegLat = 110540;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  return (lng: number, lat: number): [number, number] => [lng * mPerDegLng, lat * mPerDegLat];
}

/** Snap a point to the nearest position along a polyline (route geometry).
 *  Returns the perpendicular distance to the line and the distance traveled
 *  *along* the line to that snap point — the basis for progress + off-route. */
export function snapToRoute(
  coords: [number, number][], // [lng, lat][]
  cum: number[],              // cumulative meters at each coord
  lat: number,
  lng: number,
): { offRouteMeters: number; distAlong: number } {
  if (coords.length < 2) return { offRouteMeters: Infinity, distAlong: 0 };
  const project = makeProjector(lat);
  const [px, py] = project(lng, lat);

  let best = { offRouteMeters: Infinity, distAlong: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = project(coords[i][0], coords[i][1]);
    const [bx, by] = project(coords[i + 1][0], coords[i + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    // Parametric projection of P onto segment AB, clamped to [0,1].
    const tRaw = segLenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / segLenSq;
    const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const perp = Math.hypot(px - cx, py - cy);
    if (perp < best.offRouteMeters) {
      const segLen = Math.sqrt(segLenSq);
      best = { offRouteMeters: perp, distAlong: cum[i] + t * segLen };
    }
  }
  return best;
}

// ─── Formatting ─────────────────────────────────────────────

const fmtMiles = (m: number) => `${(m * 0.000621371).toFixed(1)} mi`;
const fmtEta = (sec: number) => {
  const min = Math.round(sec / 60);
  return min < 1 ? '< 1 min' : `${min} min`;
};
const fmtStepDist = (m: number) =>
  m >= 1609 ? `${(m * 0.000621371).toFixed(1)} mi` : `${Math.round(m * 3.28084)} ft`;

// ─── Guardrail constants ────────────────────────────────────

/** Valid latitude range for the US (including AK/HI edge cases). */
const VALID_LAT_MIN = 18.0;
const VALID_LAT_MAX = 72.0;
/** Valid longitude range for the US. */
const VALID_LNG_MIN = -180.0;
const VALID_LNG_MAX = -64.0;
/** Max plausible speed for any road vehicle, mph. Guards against GPS glitches. */
const MAX_PLAUSIBLE_SPEED_MPH = 150;
/** Max haversine distance between consecutive origin updates before rejecting, miles. */
const MAX_POSITION_JUMP_MI = 50;

// ─── Constants ──────────────────────────────────────────────

/** Minimum time between *routine* re-routing queries (ms). */
const REROUTE_THROTTLE_MS = 30_000;
/** Minimum forward movement before a routine re-route (meters). */
const REROUTE_DISTANCE_THRESHOLD = 100;

/**
 * Off-route decision — a genuine safety/UX trade-off.
 *
 * Too tight a corridor and every wide turn or GPS wobble triggers a nuisance
 * re-route; too loose and an officer who misses an exit keeps following a
 * stale line. We debounce on *consecutive* off-corridor samples so a single
 * bad GPS fix can't yank the route.
 *
 * NOTE (learning hand-off): this default is deliberately conservative.
 * Tune `CORRIDOR_METERS` / `OFFROUTE_SAMPLES` for your fleet's GPS quality.
 */
const CORRIDOR_METERS = 45;   // how far off the line counts as "off-route"
const OFFROUTE_SAMPLES = 3;   // consecutive off-corridor fixes before re-routing

function shouldForceReroute(offRouteMeters: number, consecutiveOffRoute: number): boolean {
  return offRouteMeters > CORRIDOR_METERS && consecutiveOffRoute >= OFFROUTE_SAMPLES;
}

/** Congestion class → line color. */
const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  low: '#22c55e',
  moderate: '#eab308',
  heavy: '#f97316',
  severe: '#ef4444',
  unknown: '#888888',
};
const CONGESTION_RANK: Record<CongestionLevel, number> = { low: 0, moderate: 1, heavy: 2, severe: 3, unknown: -1 };

/** Route source/layer IDs on the map. */
const ROUTE_SOURCE_ID = 'rmpg-route-source';
const ROUTE_LAYER_ID = 'rmpg-route-layer';
const TRAVELED_LAYER_ID = 'rmpg-route-traveled';

/** Multi-stop (optimized patrol) route source/layer IDs. */
const MULTI_SOURCE_ID = 'rmpg-multi-route-source';
const MULTI_CASING_LAYER_ID = 'rmpg-multi-route-casing';
const MULTI_LAYER_ID = 'rmpg-multi-route-layer';


// ─── Coordinate validation guardrail ────────────────────────
function validateCoordinate(lat: number, lng: number): { valid: boolean; reason?: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, reason: 'Coordinates must be finite numbers' };
  }
  if (lat < VALID_LAT_MIN || lat > VALID_LAT_MAX) {
    return { valid: false, reason: `Latitude ${lat} outside valid range` };
  }
  if (lng < VALID_LNG_MIN || lng > VALID_LNG_MAX) {
    return { valid: false, reason: `Longitude ${lng} outside valid range` };
  }
  return { valid: true };
}

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeProgress, setRouteProgress] = useState<RouteProgress | null>(null);
  const [routeGeom, setRouteGeom] = useState<RouteGeom | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [multiStopRoute, setMultiStopRoute] = useState<MultiStopRoute | null>(null);
  const [multiStopLoading, setMultiStopLoading] = useState(false);

  // Travel calculation pause/resume + data retention
  const { travelState, pauseTravel, resumeTravel, updatePosition } = useNavTravel();

  // DOM markers for the numbered stops on the optimized patrol route.
  const multiMarkersRef = useRef<mapboxgl.Marker[]>([]);

  const lastOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTimeRef = useRef<number>(0);
  const destRef = useRef<{ lat: number; lng: number } | null>(null);
  const metaRef = useRef<{ unitCallSign: string; callNumber: string }>({ unitCallSign: '', callNumber: '' });

  // Geometry of the active route, kept for progress + off-route math.
  const geomRef = useRef<{
    coords: [number, number][];
    cum: number[];
    totalMeters: number;
    totalSec: number;
  } | null>(null);
  const offRouteStreakRef = useRef(0);

  // ── Clear route from map ─────────────────────────────────
  const clearRouteFromMap = useCallback(() => {
    if (!map) return;
    try {
      safeRemoveLayer(map, TRAVELED_LAYER_ID);
      safeRemoveLayer(map, ROUTE_LAYER_ID);
      safeRemoveSource(map, ROUTE_SOURCE_ID);
    } catch { /* ignore cleanup errors */ }
  }, [map]);

  // ── Build a congestion line-gradient from per-segment annotations ──
  // Mapbox returns one congestion class per coordinate pair. We translate
  // those into `line-gradient` stops keyed on `line-progress` (0–1), which
  // requires `lineMetrics: true` on the source.
  const buildCongestionGradient = useCallback(
    (cum: number[], total: number, congestion: CongestionLevel[]): any | null => {
      if (!congestion.length || total <= 0) return null;
      // step expression: color for line-progress >= each stop fraction.
      const expr: any[] = ['step', ['line-progress'], CONGESTION_COLOR[congestion[0]]];
      let lastFrac = 0;
      for (let i = 1; i < congestion.length; i++) {
        const frac = Math.min(cum[i] / total, 0.9999);
        if (frac <= lastFrac) continue; // strictly increasing stops required
        expr.push(frac, CONGESTION_COLOR[congestion[i]]);
        lastFrac = frac;
      }
      // A Mapbox `step` needs at least one stop PAIR — minimum valid form is
      // ['step', input, base, stop1_in, stop1_out] (length 5). A length-3 expr
      // (single congestion segment → just a base color, no stops) is invalid
      // and throws "Expected at least 4 arguments" on addLayer. Fall back to a
      // flat line-color in that case (caller treats null as "no gradient").
      return expr.length >= 5 ? expr : null;
    },
    [],
  );

  // ── Query the Mapbox Directions API ─────────────────────
  const queryRoute = useCallback(
    async (
      originLatLng: { lat: number; lng: number },
      destinationLatLng: { lat: number; lng: number },
    ): Promise<RouteInfo | null> => {
      if (!map) return null;
      setRouteLoading(true);

      try {
        const coordStr = `${originLatLng.lng},${originLatLng.lat};${destinationLatLng.lng},${destinationLatLng.lat}`;
        // Feature 1: live traffic-aware routing. driving-traffic factors in
        // real-time speeds; annotations=congestion drives the colored line.
        // Routed through the Worker's /api/mapbox/directions proxy (src/
        // routes/mapbox.ts) instead of a direct api.mapbox.com call with an
        // embedded public token — see useNavGuidanceEngine.ts for the
        // sibling engine that made this same change first.
        const data = await apiFetch<{ routes?: any[] }>(
          `/mapbox/directions?coordinates=${encodeURIComponent(coordStr)}` +
          // maxspeed rides along with congestion — same request, and overview=full
          // (already set) is Mapbox's precondition for any annotation.
          `&profile=driving-traffic&geometries=geojson&overview=full&steps=true&annotations=congestion,maxspeed`,
        );
        const route = data.routes?.[0];
        if (!route) throw new Error('No route found');

        const duration: number = route.duration;     // seconds (traffic-aware)
        const distance: number = route.distance;      // meters
        const geometry = route.geometry;              // GeoJSON LineString
        const coords: [number, number][] = geometry?.coordinates ?? [];
        // A degenerate route (<2 points) can't form a line; rendering it would
        // build a stop-less Mapbox `line-gradient` step expr and throw on
        // addLayer. Bail before any source/layer work — the caller treats null
        // as "no route".
        if (coords.length < 2) return null;

        // Cumulative distance at each coordinate (for progress + gradient).
        const cum: number[] = [0];
        for (let i = 1; i < coords.length; i++) {
          cum[i] = cum[i - 1] + haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        }
        const total = cum[cum.length - 1] || distance;

        // Per-segment congestion classes.
        const rawCong: string[] = route.legs?.[0]?.annotation?.congestion ?? [];
        const congestion: CongestionLevel[] = rawCong.map((c) =>
          c === 'low' || c === 'moderate' || c === 'heavy' || c === 'severe' ? c : 'unknown',
        );
        let worst: CongestionLevel = 'unknown';
        for (const c of congestion) if (CONGESTION_RANK[c] > CONGESTION_RANK[worst]) worst = c;

        geomRef.current = { coords, cum, totalMeters: total, totalSec: duration };
        setRouteGeom({ coords, cum, totalMeters: total });
        offRouteStreakRef.current = 0;
        setOffRoute(false);

        // ── Render on map (Feature 2: congestion-colored line) ──
        // Guard on STYLE readiness — addSource throws "Style is not done
        // loading" if the basemap style hasn't finished (map.loaded() alone
        // isn't sufficient).
        const gradient = buildCongestionGradient(cum, total, congestion);
        whenStyleReady(map, () => {
          clearRouteFromMap();
          map.addSource(ROUTE_SOURCE_ID, {
            type: 'geojson',
            lineMetrics: true, // required for line-gradient
            data: { type: 'Feature', properties: {}, geometry },
          });
          // Traveled-portion underlay (dimmed) — trimmed by updateProgress.
          map.addLayer({
            id: TRAVELED_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#3a3a3a', 'line-width': 7, 'line-opacity': 0.5, 'line-gradient': ['step', ['line-progress'], '#3a3a3a', 0.0001, 'rgba(0 0 0 / 0)'] },
          });
          map.addLayer({
            id: ROUTE_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              ...(gradient ? { 'line-gradient': gradient } : { 'line-color': CONGESTION_COLOR.unknown }),
              'line-width': 5,
              'line-opacity': 0.9,
            },
          });
        });

        // Turn-by-turn maneuvers (single leg: unit → call).
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

        const leg = route.legs?.[0] || {};
        const durationSec = leg.duration || 0;
        const distanceMeters = leg.distance || 0;

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: fmtEta(duration),
          distance: fmtMiles(distance),
          durationSec: Math.round(duration),
          distanceMeters: Math.round(distance),
          steps,
          trafficAware: true,
          worstCongestion: worst,
          postedLimitMph: pickCurrentSegmentLimit(
            (route?.legs?.[0]?.annotation?.maxspeed ?? []) as unknown[],
          ),
        };

        lastOriginRef.current = originLatLng;
        lastQueryTimeRef.current = Date.now();
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
        console.warn('[useMapRouting] Directions query failed:', err);
        return null;
      } finally {
        setRouteLoading(false);
      }
    },
    [map, clearRouteFromMap, buildCongestionGradient],
  );

  // ── Public API ───────────────────────────────────────────

  /** Show a route between a unit position and a call location. */
  const showRoute = useCallback(
    async (
      unitCallSign: string,
      callNumber: string,
      unitLat: number,
      unitLng: number,
      callLat: number,
      callLng: number,
    ) => {
      // Guardrails: validate both origin and destination coordinates
      const originCheck = validateCoordinate(unitLat, unitLng);
      if (!originCheck.valid) {
        console.warn('[useMapRouting] showRoute rejected — origin:', originCheck.reason);
        return null;
      }
      const destCheck = validateCoordinate(callLat, callLng);
      if (!destCheck.valid) {
        console.warn('[useMapRouting] showRoute rejected — destination:', destCheck.reason);
        return null;
      }
      metaRef.current = { unitCallSign, callNumber };
      destRef.current = { lat: callLat, lng: callLng };
      return queryRoute({ lat: unitLat, lng: unitLng }, { lat: callLat, lng: callLng });
    },
    [queryRoute],
  );

  /** Clear the active route and all derived state. */
  const clearRoute = useCallback(() => {
    clearRouteFromMap();
    setActiveRoute(null);
    setRouteProgress(null);
    setRouteGeom(null);
    setOffRoute(false);
    geomRef.current = null;
    offRouteStreakRef.current = 0;
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, [clearRouteFromMap]);

  // ── Feature 3: live progress + dynamic remaining ETA ─────
  /** Snap the unit onto the route and recompute remaining distance/ETA,
   *  trim the traveled portion of the line, and report off-route distance. */
  const updateProgress = useCallback(
    (lat: number, lng: number): RouteProgress | null => {
      const g = geomRef.current;
      if (!g || g.coords.length < 2) return null;

      const { offRouteMeters, distAlong } = snapToRoute(g.coords, g.cum, lat, lng);
      const fraction = g.totalMeters > 0 ? Math.min(Math.max(distAlong / g.totalMeters, 0), 1) : 0;
      const remainingMeters = Math.max(g.totalMeters - distAlong, 0);
      // Scale remaining time by the route's traffic-aware average pace.
      const remainingSec = g.totalMeters > 0 ? Math.round(g.totalSec * (remainingMeters / g.totalMeters)) : 0;

      // Trim the traveled portion: dim everything up to `fraction`.
      if (map && hasLayer(map, TRAVELED_LAYER_ID)) {
        try {
          map.setPaintProperty(TRAVELED_LAYER_ID, 'line-gradient', [
            'step', ['line-progress'],
            'rgba(58,58,58,0.55)', Math.max(fraction, 0.0001), 'rgba(0 0 0 / 0)',
          ]);
        } catch { /* style not ready */ }
      }

      const progress: RouteProgress = {
        fraction,
        remainingMeters: Math.round(remainingMeters),
        remainingDistance: fmtMiles(remainingMeters),
        remainingSec,
        remainingEta: fmtEta(remainingSec),
        offRouteMeters: Math.round(offRouteMeters),
      };
      setRouteProgress(progress);
      return progress;
    },
    [map],
  );

  /**
   * Update the route origin when unit GPS changes. Combines:
   *  - Feature 3: recompute progress every fix.
   *  - Feature 4: force an immediate re-route when the unit leaves the
   *    corridor for OFFROUTE_SAMPLES consecutive fixes (bypasses throttle).
   *  - Feature 6: skip all routing work when travel is paused.
   *  - Feature 7: coordinate guardrails + jump detection.
   *  - routine throttled re-route (30s + 100m moved) otherwise.
   */
  const updateOrigin = useCallback(
    (newLat: number, newLng: number) => {
      // Feature 6: bail entirely when travel calculation is paused
      if (travelState.paused) return;

      // Feature 7: coordinate guardrail — reject out-of-bounds coords
      const coordCheck = validateCoordinate(newLat, newLng);
      if (!coordCheck.valid) {
        console.warn('[useMapRouting] updateOrigin rejected:', coordCheck.reason);
        return;
      }

      if (!destRef.current || !lastOriginRef.current) return;

      // Feature 7: jump detection — reject teleportation glitches
      if (lastOriginRef.current) {
        const jumpMi = haversineMeters(
          lastOriginRef.current.lat, lastOriginRef.current.lng, newLat, newLng
        ) * 0.000621371;
        if (jumpMi > MAX_POSITION_JUMP_MI) {
          console.warn(`[useMapRouting] updateOrigin rejected: jump of ${jumpMi.toFixed(1)} mi exceeds sanity threshold`);
          return;
        }
      }

      // Track position for travel calculation (distance accumulation, odometer)
      updatePosition(newLat, newLng);

      const progress = updateProgress(newLat, newLng);

      // Feature 4: off-route detection + auto re-route.
      if (progress) {
        if (progress.offRouteMeters > CORRIDOR_METERS) {
          offRouteStreakRef.current += 1;
        } else {
          offRouteStreakRef.current = 0;
        }
        const isOff = shouldForceReroute(progress.offRouteMeters, offRouteStreakRef.current);
        setOffRoute(isOff);
        if (isOff) {
          offRouteStreakRef.current = 0;
          queryRoute({ lat: newLat, lng: newLng }, destRef.current);
          return;
        }
      }

      // Routine throttled re-route.
      const elapsed = Date.now() - lastQueryTimeRef.current;
      if (elapsed < REROUTE_THROTTLE_MS) return;
      const moved = haversineMeters(lastOriginRef.current.lat, lastOriginRef.current.lng, newLat, newLng);
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;
      queryRoute({ lat: newLat, lng: newLng }, destRef.current);
    },
    [queryRoute, updateProgress, travelState.paused, updatePosition],
  );

  // ── Feature 5: closest unit by real drive time (Matrix API) ──
  /**
   * Rank responding units by traffic-aware drive time to a call.
   * Uses the Mapbox Matrix API (one request, N sources → 1 destination),
   * so dispatch can pick the genuinely fastest responder rather than the
   * one that's closest as the crow flies.
   *
   * Mapbox caps driving-traffic matrices at 10 coordinates, so we take up to
   * the first 9 units (+ the destination). Returns units sorted fastest-first.
   */
  const findClosestUnit = useCallback(
    async (
      units: { callSign: string; lat: number; lng: number }[],
      dest: { lat: number; lng: number },
    ): Promise<UnitDriveTime[]> => {
      const valid = units.filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lng)).slice(0, 9);
      if (!valid.length) return [];
      try {
        const pts = [...valid.map((u) => ({ lng: u.lng, lat: u.lat })), { lng: dest.lng, lat: dest.lat }];
        const coordStr = pts.map((p) => `${p.lng},${p.lat}`).join(';');
        const destIdx = pts.length - 1;
        const sources = valid.map((_, i) => i).join(';');
        // Routed through /api/mapbox/matrix — see queryRoute above.
        const data = await apiFetch<{ durations?: (number | null)[][]; distances?: (number | null)[][] }>(
          `/mapbox/matrix?coordinates=${encodeURIComponent(coordStr)}` +
          `&profile=driving-traffic&sources=${sources}&destinations=${destIdx}&annotations=duration,distance`,
        );

        const ranked: UnitDriveTime[] = valid.map((u, i) => {
          const etaSec = data.durations?.[i]?.[0];
          const distM = data.distances?.[i]?.[0];
          return {
            callSign: u.callSign,
            etaSec: typeof etaSec === 'number' ? Math.round(etaSec) : Infinity,
            etaText: typeof etaSec === 'number' ? fmtEta(etaSec) : '—',
            distanceMeters: typeof distM === 'number' ? Math.round(distM) : Infinity,
            distanceText: typeof distM === 'number' ? fmtMiles(distM) : '—',
          };
        });
        ranked.sort((a, b) => a.etaSec - b.etaSec);
        return ranked.filter((r) => Number.isFinite(r.etaSec));
      } catch (err) {
        console.warn('[useMapRouting] Matrix query failed:', err);
        return [];
      }
    },
    [],
  );

  // ── Multi-stop patrol routing (Mapbox Optimization API / TSP) ──
  /** Remove the optimized route line + all numbered stop markers. */
  const clearMultiStopFromMap = useCallback(() => {
    for (const m of multiMarkersRef.current) {
      try { m.remove(); } catch { /* ignore */ }
    }
    multiMarkersRef.current = [];
    if (!map) return;
    try {
      safeRemoveLayer(map, MULTI_LAYER_ID);
      safeRemoveLayer(map, MULTI_CASING_LAYER_ID);
      safeRemoveSource(map, MULTI_SOURCE_ID);
    } catch { /* ignore cleanup errors */ }
  }, [map]);

  const clearMultiStop = useCallback(() => {
    clearMultiStopFromMap();
    setMultiStopRoute(null);
  }, [clearMultiStopFromMap]);

  /** Build a gold numbered "stop" marker (1, 2, 3 …) for the patrol route. */
  const makeStopMarker = useCallback((order: number): HTMLElement => {
    const el = document.createElement('div');
    // #b8912f = MAP_PALETTE.arterial (graphical gold — passes 3:1 on navy for border/glow)
    // #d9bd72 = MAP_PALETTE.labelMajor (text gold — passes 4.5:1 on navy for the numeral)
    el.style.cssText =
      'width:24px;height:24px;border-radius:2px;display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(180deg,#1a2535,#0d1722);border:1.5px solid #b8912f;' +
      'color:#d9bd72;font-family:system-ui,sans-serif;font-size:12px;font-weight:900;line-height:1;' +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 0 8px #b8912f66, 0 1px 4px rgba(0,0,0,0.6);' +
      'cursor:default;';
    el.textContent = String(order);
    return el;
  }, []);

  /**
   * Route one unit through many calls in the fastest visiting order.
   *
   * Uses the Mapbox Optimization API (a traveling-salesman solver): the unit is
   * pinned as the start (`source=first`) and the call order is fully optimized
   * (`destination=any`, `roundtrip=false`) so dispatch gets the genuinely
   * shortest patrol path, not the click order. Caps at 11 stops (API limit 12
   * coords incl. the unit). Renders a gold route line + numbered stop markers.
   */
  const showMultiStopRoute = useCallback(
    async (
      unitCallSign: string,
      origin: { lat: number; lng: number },
      stops: { callNumber: string; lat: number; lng: number; label?: string }[],
    ): Promise<MultiStopRoute | null> => {
      if (!map) return null;
      const valid = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).slice(0, 11);
      if (valid.length < 1 || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return null;

      setMultiStopLoading(true);
      try {
        // Loaded dynamically, not statically imported at module scope (see
        // the header comment) — `map` above is already a live mapboxgl.Map
        // instance, so this resolves from the already-warm module cache.
        const { mapboxgl } = await importWithRetry(() => import('../utils/mapboxLoader'));

        // Coord 0 = unit origin; coords 1..n = the calls (in queue order).
        const pts = [origin, ...valid];
        const coordStr = pts.map((p) => `${p.lng},${p.lat}`).join(';');
        // Mapbox Optimization v1 only implements two (source,destination,roundtrip)
        // combos: roundtrip=true (any endpoints), or roundtrip=false with BOTH
        // source=first AND destination=last. The open-tour we actually want
        // (unit pinned as start, end optimized freely) maps to the UNSUPPORTED
        // roundtrip=false + destination=any — Mapbox answers HTTP 200 with
        // {code:"NotImplemented"}, which surfaced as "[useMapRouting] Optimization
        // query failed: Error: NotImplemented". So we solve it as a ROUNDTRIP
        // (optimal visiting order, unit as the fixed start) and drop the final
        // return-to-unit leg from the drawn line + ETA below — dispatch doesn't
        // need the officer to loop back to where they started. steps=true gives
        // per-leg geometry so the line can be rebuilt without that return leg.
        // Routed through /api/mapbox/optimization — see queryRoute above.
        const data = await apiFetch<{ code?: string; trips?: any[]; waypoints?: any[] }>(
          `/mapbox/optimization?coordinates=${encodeURIComponent(coordStr)}` +
          `&profile=driving&source=first&roundtrip=true` +
          `&steps=true&annotations=duration,distance`,
        );
        if (data.code !== 'Ok' || !data.trips?.[0]) throw new Error(data.code || 'No trip');

        const trip = data.trips[0];
        const legs: any[] = trip.legs ?? [];

        // `waypoints[i].waypoint_index` = position of input coord i in the
        // optimized sequence. Build input-index → optimized-position map.
        const waypoints: any[] = data.waypoints ?? [];
        // optimizedOrder[pos] = input coordinate index visited at that position.
        const optimizedOrder: number[] = [];
        waypoints.forEach((w, inputIdx) => {
          if (typeof w?.waypoint_index === 'number') optimizedOrder[w.waypoint_index] = inputIdx;
        });

        // Walk the optimized order (skip position 0 = the unit origin). Leg k
        // is the drive INTO optimized position k+1.
        const orderedStops: MultiStop[] = [];
        let cumSec = 0;
        let cumMeters = 0;
        for (let pos = 1; pos < optimizedOrder.length; pos++) {
          const inputIdx = optimizedOrder[pos];
          const stop = pts[inputIdx] as typeof valid[number];
          const leg = legs[pos - 1] || {};
          const legSec = typeof leg.duration === 'number' ? leg.duration : 0;
          const legMeters = typeof leg.distance === 'number' ? leg.distance : 0;
          cumSec += legSec;
          cumMeters += legMeters;
          orderedStops.push({
            callNumber: stop.callNumber,
            lat: stop.lat,
            lng: stop.lng,
            label: stop.label,
            order: pos,
            legSec: Math.round(legSec),
            legMeters: Math.round(legMeters),
            legEta: fmtEta(legSec),
            legDistance: fmtMiles(legMeters),
            cumEta: fmtEta(cumSec),
          });
        }

        // Build the drawn line from ONLY the legs INTO the stops (legs 0..k-1),
        // excluding the roundtrip's final return-to-unit leg (legs[k]). Each leg's
        // geometry is the concatenation of its steps' geometries (steps=true),
        // de-duping the vertex shared between consecutive steps. Falls back to the
        // full trip geometry (the closed loop, incl. return) only if steps are
        // missing — better a slightly-wrong line than none.
        const usedLegCount = Math.max(0, optimizedOrder.length - 1);
        const lineCoords: [number, number][] = [];
        for (let i = 0; i < usedLegCount; i++) {
          for (const step of legs[i]?.steps ?? []) {
            const cs = step?.geometry?.coordinates;
            if (!Array.isArray(cs)) continue;
            for (const c of cs) {
              const last = lineCoords[lineCoords.length - 1];
              if (!last || last[0] !== c[0] || last[1] !== c[1]) lineCoords.push(c as [number, number]);
            }
          }
        }
        const geometry =
          lineCoords.length >= 2
            ? { type: 'LineString' as const, coordinates: lineCoords }
            : trip.geometry; // fallback: full loop incl. the return leg

        // ── Render the optimized line + numbered markers ──
        clearMultiStopFromMap();
        whenStyleReady(map, () => {
          try {
            map.addSource(MULTI_SOURCE_ID, {
              type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry },
            });
            // Dark casing under a gold dashed line — reads as a planned patrol
            // path, visually distinct from the live single-call congestion line.
            map.addLayer({
              id: MULTI_CASING_LAYER_ID,
              type: 'line',
              source: MULTI_SOURCE_ID,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#0a0a0a', 'line-width': 8, 'line-opacity': 0.7 },
            });
            map.addLayer({
              id: MULTI_LAYER_ID,
              type: 'line',
              source: MULTI_SOURCE_ID,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#c3ccd6', 'line-width': 4, 'line-opacity': 0.95, 'line-dasharray': [2, 1.5] },
            });
          } catch { /* style race — markers below still render */ }
        });

        for (const s of orderedStops) {
          try {
            const marker = new mapboxgl.Marker({ element: makeStopMarker(s.order), anchor: 'center' })
              .setLngLat([s.lng, s.lat])
              .addTo(map);
            multiMarkersRef.current.push(marker);
          } catch { /* ignore marker failure */ }
        }

        // Totals are the sum of the kept (into-stop) legs, so they exclude the
        // dropped return-to-unit leg — trip.duration/trip.distance would include it.
        const totalSec = cumSec;
        const totalMeters = cumMeters;
        const route: MultiStopRoute = {
          unitCallSign,
          stops: orderedStops,
          totalEta: fmtEta(totalSec),
          totalSec: Math.round(totalSec),
          totalDistance: fmtMiles(totalMeters),
          totalMeters: Math.round(totalMeters),
        };
        setMultiStopRoute(route);

        // Fit the map to the whole patrol path.
        try {
          const coords: [number, number][] = geometry?.coordinates ?? [];
          if (coords.length >= 2) {
            const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
            for (const c of coords) b.extend(c as [number, number]);
            map.fitBounds(b, { padding: 80, duration: 600, maxZoom: 15 });
          }
        } catch { /* ignore fit errors */ }

        return route;
      } catch (err) {
        console.warn('[useMapRouting] Optimization query failed:', err);
        return null;
      } finally {
        setMultiStopLoading(false);
      }
    },
    [map, clearMultiStopFromMap, makeStopMarker],
  );

  // ── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      clearRouteFromMap();
      clearMultiStopFromMap();
    };
  }, [clearRouteFromMap, clearMultiStopFromMap]);

  return {
    activeRoute,
    routeLoading,
    routeProgress,
    routeGeom,
    offRoute,
    showRoute,
    clearRoute,
    updateOrigin,
    updateProgress,
    findClosestUnit,
    // Multi-stop patrol routing
    multiStopRoute,
    multiStopLoading,
    showMultiStopRoute,
    clearMultiStop,
    // Pause/resume travel calculation (officer control)
    travelPaused: travelState.paused,
    pauseTravel,
    resumeTravel,
    travelState,
  };
}
