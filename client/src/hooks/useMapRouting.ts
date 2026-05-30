// ============================================================
// RMPG Flex — useMapRouting Hook
// Mapbox-powered routing between a unit and a dispatch call.
// Renders a polyline on the map with ETA and distance, and adds
// five advanced dispatch-grade routing capabilities:
//   1. Live traffic-aware routing (driving-traffic profile)
//   2. Congestion-colored route line (green→yellow→orange→red)
//   3. Live route progress + dynamic remaining ETA
//   4. Off-route detection + automatic re-route
//   5. Closest-unit-by-drive-time (Mapbox Matrix API)
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
  /** True when this ETA reflects live traffic (driving-traffic profile). */
  trafficAware: boolean;
  /** Worst congestion class anywhere on the route, for a headline badge. */
  worstCongestion: CongestionLevel;
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
function snapToRoute(
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

// ─── Hook ───────────────────────────────────────────────────

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeProgress, setRouteProgress] = useState<RouteProgress | null>(null);
  const [offRoute, setOffRoute] = useState(false);

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
      if (map.getLayer(TRAVELED_LAYER_ID)) map.removeLayer(TRAVELED_LAYER_ID);
      if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
      if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
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
      return expr.length >= 3 ? expr : null;
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
        const token = await getMapboxAccessToken();
        if (!token) return null;

        const coordStr = `${originLatLng.lng},${originLatLng.lat};${destinationLatLng.lng},${destinationLatLng.lat}`;
        // Feature 1: live traffic-aware routing. driving-traffic factors in
        // real-time speeds; annotations=congestion drives the colored line.
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordStr}` +
          `?access_token=${token}&geometries=geojson&overview=full&steps=true&annotations=congestion`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);

        const data = await res.json();
        const route = data.routes?.[0];
        if (!route) throw new Error('No route found');

        const duration: number = route.duration;     // seconds (traffic-aware)
        const distance: number = route.distance;      // meters
        const geometry = route.geometry;              // GeoJSON LineString
        const coords: [number, number][] = geometry?.coordinates ?? [];

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
        offRouteStreakRef.current = 0;
        setOffRoute(false);

        // ── Render on map (Feature 2: congestion-colored line) ──
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
          paint: { 'line-color': '#3a3a3a', 'line-width': 7, 'line-opacity': 0.5, 'line-gradient': ['step', ['line-progress'], '#3a3a3a', 0.0001, 'rgba(0,0,0,0)'] },
        });
        const gradient = buildCongestionGradient(cum, total, congestion);
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
      if (map?.getLayer(TRAVELED_LAYER_ID)) {
        try {
          map.setPaintProperty(TRAVELED_LAYER_ID, 'line-gradient', [
            'step', ['line-progress'],
            'rgba(58,58,58,0.55)', Math.max(fraction, 0.0001), 'rgba(0,0,0,0)',
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
   *  - routine throttled re-route (30s + 100m moved) otherwise.
   */
  const updateOrigin = useCallback(
    (newLat: number, newLng: number) => {
      if (!destRef.current || !lastOriginRef.current) return;

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
    [queryRoute, updateProgress],
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
        const token = await getMapboxAccessToken();
        if (!token) return [];

        const pts = [...valid.map((u) => ({ lng: u.lng, lat: u.lat })), { lng: dest.lng, lat: dest.lat }];
        const coordStr = pts.map((p) => `${p.lng},${p.lat}`).join(';');
        const destIdx = pts.length - 1;
        const sources = valid.map((_, i) => i).join(';');
        const url =
          `https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coordStr}` +
          `?access_token=${token}&sources=${sources}&destinations=${destIdx}&annotations=duration,distance`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Matrix HTTP ${res.status}`);
        const data = await res.json();

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

  // ── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      clearRouteFromMap();
    };
  }, [clearRouteFromMap]);

  return {
    activeRoute,
    routeLoading,
    routeProgress,
    offRoute,
    showRoute,
    clearRoute,
    updateOrigin,
    updateProgress,
    findClosestUnit,
  };
}
