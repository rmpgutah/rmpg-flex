// ============================================================
// RMPG Flex — Process Server route optimization engine
// ============================================================
// Reorders serve attempts for minimum travel distance using a
// nearest-neighbor heuristic. No external APIs required — pure
// geometry on lat/lng coordinates stored in D1.
//
// All functions are async, Worker-compatible (no node: imports),
// and use the shared ./db helpers for D1 access.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, queryInChunks } from './db';
import { clampDwellSeconds, type DefendantType } from './serveStopTiming';

// ── Phase-1 route-planner types (added 2026-08-12) ─────────

const APARTMENT_PATTERNS = /\b(apt|apartment|unit|ste|suite|bldg|building|fl(?:oor)?|#)\b|\s#\d/i;

export function inferDefendantType(
  address: string | null | undefined,
  businessId: number | null | undefined,
  recipientType?: string | null,
): 'individual' | 'apartment' | 'business' {
  if (businessId || recipientType === 'business') return 'business';
  if (address && APARTMENT_PATTERNS.test(address)) return 'apartment';
  return 'individual';
}

export interface RouteStop {
  jobId: number;
  lat: number;
  lng: number;
  geocodeSource: 'point' | 'centroid' | null;
  deadlineAt: string | null;
  defendantType: 'individual' | 'apartment' | 'business';
  addressHash: string;
  defendant: string;
  address: string;
  locationNote: { serveStart: string | null; serveEnd: string | null } | null;
}

export interface GeocodeWarning {
  jobId: number;
  defendant: string;
  address: string;
  quality: 'low' | 'none';
}

export interface OptimizeOrigin {
  lat: number;
  lng: number;
}

export interface OptimizeOptions {
  origin?: OptimizeOrigin | null;
  circular?: boolean;
}

export interface OptimizeResult {
  orderedStops: RouteStop[];
  etaPerStop: string[];
  matrixFallback: boolean;
  /** Human-readable reason the Matrix API was unavailable, when matrixFallback is true. */
  fallbackReason?: string;
  geocodeWarnings: GeocodeWarning[];
}

export interface TrafficCheckResult {
  degraded: boolean;
  addedMinutes: number;
  newOrder: RouteStop[];
  newEtas: string[];
  degradedSegments: Array<{ fromJobId: number; toJobId: number; addedSeconds: number }>;
  matrixFallback: boolean;
  fallbackReason?: string;
}

const METERS_PER_MILE = 1609.344;
const URBAN_AVG_MPH = 25;
const ROAD_WINDING_FACTOR = 1.3;

/**
 * Haversine distance between two {lat, lng} points. Returns metres.
 */
export function haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Convert great-circle metres into estimated driving seconds (winding × 25 mph).
 * The cost matrix MUST be seconds — Mapbox Directions returns seconds, and
 * computeEtas / 2-opt add those cells as durations. Raw metres through that
 * path treat a 30-mile leg as ~13 hours and print next-morning ETAs.
 */
export function metresToDriveSeconds(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const roadMiles = (meters / METERS_PER_MILE) * ROAD_WINDING_FACTOR;
  return (roadMiles / URBAN_AVG_MPH) * 3600;
}

export function haversineDurationSeconds(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return metresToDriveSeconds(haversineDistance(a, b));
}

/**
 * Build an n×n travel-time matrix (seconds). Diagonal entries are 0.
 */
export function haversineMatrix(stops: Array<{ lat: number; lng: number }>): number[][] {
  return stops.map(a => stops.map(b => haversineDurationSeconds(a, b)));
}

/** Prefer the dedicated matrix secret, then the general Mapbox token. */
export function resolveMapboxDirectionsToken(env: {
  MAPBOX_SECRET_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}): string {
  return (env.MAPBOX_SECRET_TOKEN || env.MAPBOX_ACCESS_TOKEN || '').trim();
}

/**
 * Mapbox driving-traffic rejects depart_at more than ~30 minutes in the past.
 */
export function clampDepartAtForMapbox(departAt: string, nowMs: number = Date.now()): string {
  const t = new Date(departAt).getTime();
  if (!Number.isFinite(t)) return new Date(nowMs).toISOString();
  if (nowMs - t > 25 * 60_000) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

// ── Directions-API cost matrix (driving-traffic, one call per ordered pair) ──
//
// The Mapbox Matrix API driving-traffic profile requires an Enterprise plan.
// The Directions API driving-traffic profile is available on pay-as-you-go.
// We fire all n×(n-1) pairs concurrently; Workers paid plan allows 1,000
// subrequests per invocation (handles up to ~32 stops before hitting the cap).

export async function buildCostMatrix(
  stops: RouteStop[],
  departAt: string,
  mapboxToken: string
): Promise<{ matrix: number[][]; fallback: boolean; reason?: string }> {
  if (!mapboxToken) {
    return { matrix: haversineMatrix(stops), fallback: true, reason: 'no token configured' };
  }
  if (stops.length <= 1) {
    return { matrix: haversineMatrix(stops), fallback: false };
  }

  const n = stops.length;
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : 0))
  );

  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) pairs.push([i, j]);
    }
  }

  let anyFailed = false;
  const departAtIso = clampDepartAtForMapbox(departAt);

  const results = await Promise.all(
    pairs.map(async ([i, j]) => {
      const from = stops[i];
      const to = stops[j];
      const url = new URL(
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}`
      );
      url.searchParams.set('access_token', mapboxToken);
      url.searchParams.set('overview', 'false');
      url.searchParams.set('steps', 'false');
      url.searchParams.set('depart_at', departAtIso);

      try {
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) {
          console.warn(`[serveRouteOptimizer] Directions ${i}→${j} HTTP ${res.status}`);
          return { i, j, duration: null as number | null };
        }
        const data = await (res.json() as Promise<{ routes?: { duration: number }[] }>);
        return { i, j, duration: data.routes?.[0]?.duration ?? null };
      } catch {
        return { i, j, duration: null as number | null };
      }
    })
  );

  for (const { i, j, duration } of results) {
    if (duration !== null) {
      matrix[i][j] = duration;
    } else {
      matrix[i][j] = haversineDurationSeconds(stops[i], stops[j]);
      anyFailed = true;
    }
  }

  return {
    matrix,
    fallback: anyFailed,
    reason: anyFailed ? 'some directions calls failed' : undefined,
  };
}

// ── Legacy attempt-based types (nearest-neighbor optimizer) ─

export interface AttemptRouteStop {
  attemptId: number;
  queueId: number;
  lat: number;
  lng: number;
  address: string;
  defendantName: string;
  attemptNumber: number;
  priority: string;
  isBusiness: boolean;
}

export interface OptimizationResult {
  orderedAttemptIds: number[];
  totalDistanceMiles: number;
  estimatedDriveTimeMinutes: number;
  stops: AttemptRouteStop[];
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
  spanMiles: number;
}

export interface ServerRouteSummary {
  serverId: number;
  serverName: string;
  attemptCount: number;
  optimization: OptimizationResult;
}

export interface NearestAttemptResult {
  attemptId: number;
  queueId: number;
  distanceMiles: number;
  address: string;
  defendantName: string;
  priority: string;
  caseNumber: string;
}

// ── Constants ──────────────────────────────────────────────

const EARTH_RADIUS_MI = 3958.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

// ── Core geometry (legacy attempt optimizer) ───────────────

/**
 * Calculate the great-circle distance between two coordinates using the
 * Haversine formula. Returns distance in miles.
 *
 * @param lat1 - Latitude of first point (decimal degrees)
 * @param lng1 - Longitude of first point (decimal degrees)
 * @param lat2 - Latitude of second point (decimal degrees)
 * @param lng2 - Longitude of second point (decimal degrees)
 * @returns Distance in miles (always ≥ 0)
 */
export function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Estimate drive time in minutes for a given distance.
 * Uses 25 mph average (urban surface streets with stops/lights)
 * and a 1.3x road winding factor to approximate actual road distance
 * from straight-line distance.
 *
 * @param distanceMiles - Straight-line distance in miles
 * @returns Estimated drive time in minutes (minimum 1)
 */
export function estimateDriveTime(distanceMiles: number): number {
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) return 1;
  const roadMiles = distanceMiles * ROAD_WINDING_FACTOR;
  return Math.max(1, Math.round((roadMiles / URBAN_AVG_MPH) * 60));
}

// ── Work area ──────────────────────────────────────────────

/**
 * Compute the bounding box of all addresses currently assigned to this server.
 * Queries serve_queue where officer_id matches the server's user id.
 * Returns null if the server has no assigned attempts or none with valid coords.
 *
 * @param db - D1 database handle
 * @param serverId - The user id of the process server
 * @returns Bounding box with center and approximate span, or null
 */
export async function getServerWorkArea(
  db: D1Database,
  serverId: number,
): Promise<BoundingBox | null> {
  const rows = await query<{ lat: number; lng: number }>(
    db,
    // serve_queue has no lat/lng/assigned_to. The geocoded columns are
    // recipient_lat/recipient_lng and the assignment column is officer_id
    // (assigned_officer_id exists but is populated on 0 of 23 live rows).
    // Aliased so the row type and every caller stay unchanged.
    `SELECT recipient_lat AS lat, recipient_lng AS lng FROM serve_queue
      WHERE officer_id = ?
        AND recipient_lat IS NOT NULL AND recipient_lng IS NOT NULL
        AND status NOT IN ('served', 'cancelled', 'failed')`,
    serverId,
  ).catch(() => []);

  if (rows.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    if (r.lat < minLat) minLat = r.lat;
    if (r.lat > maxLat) maxLat = r.lat;
    if (r.lng < minLng) minLng = r.lng;
    if (r.lng > maxLng) maxLng = r.lng;
  }

  if (minLat === Infinity) return null;

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const spanMiles = haversineDistanceMiles(minLat, minLng, maxLat, maxLng);

  return { minLat, maxLat, minLng, maxLng, centerLat, centerLng, spanMiles };
}

// ── Nearest-neighbor route optimizer ───────────────────────

/**
 * Fetch the attempt stop data for a list of attempt IDs.
 * Joins serve_attempts → serve_queue to get coordinates and metadata.
 * Only returns attempts with valid lat/lng (those without coords are
 * appended to the end in their original order).
 */
async function fetchStops(
  db: D1Database,
  attemptIds: number[],
): Promise<{ withCoords: AttemptRouteStop[]; withoutCoords: AttemptRouteStop[] }> {
  if (attemptIds.length === 0) return { withCoords: [], withoutCoords: [] };

  // Caller-supplied id list: a full day's route plan can exceed D1's
  // 100-bound-parameter cap, which throws at BIND time -- before the query
  // runs -- so the whole route would fail to build on exactly the busy days
  // it matters most.
  const rows = await queryInChunks<AttemptRouteStop>(
    db, attemptIds,
    // Five of this query's column references did not exist on live D1, so the
    // route optimizer's stop fetch threw "no such column" on EVERY call and
    // the module has never produced a route. Verified against live schema:
    //   a.queue_id     -> serve_attempts.serve_queue_id
    //   q.lat / q.lng  -> serve_queue.recipient_lat / recipient_lng
    //   q.address      -> serve_queue.recipient_address
    //   q.is_business  -> no such column; derived from business_id
    // (The bounding-box query in this same file had the same defect and was
    // repaired separately.)
    (placeholders) => `SELECT
        a.id AS attemptId,
        a.serve_queue_id AS queueId,
        q.recipient_lat AS lat,
        q.recipient_lng AS lng,
        q.recipient_address AS address,
        q.defendant_name AS defendantName,
        a.attempt_number AS attemptNumber,
        q.priority AS priority,
        (q.business_id IS NOT NULL) AS isBusiness
      FROM serve_attempts a
      JOIN serve_queue q ON q.id = a.serve_queue_id
      WHERE a.id IN (${placeholders})`,
  );

  const withCoords: AttemptRouteStop[] = [];
  const withoutCoords: AttemptRouteStop[] = [];

  for (const row of rows) {
    if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
      withCoords.push(row);
    } else {
      withoutCoords.push(row);
    }
  }

  return { withCoords, withoutCoords };
}

/**
 * Nearest-neighbor reordering of route stops. Starts from the stop closest
 * to the server's current position (or the first stop if no position given),
 * then repeatedly picks the closest unvisited stop.
 *
 * Returns the stops in optimized order plus the total distance.
 */
function nearestNeighborSort(
  stops: AttemptRouteStop[],
  startLat: number | null,
  startLng: number | null,
): { ordered: AttemptRouteStop[]; totalMiles: number } {
  if (stops.length === 0) return { ordered: [], totalMiles: 0 };
  if (stops.length === 1) return { ordered: stops, totalMiles: 0 };

  const remaining = [...stops];
  const ordered: AttemptRouteStop[] = [];
  let totalMiles = 0;

  // Start from the server's current position if provided; otherwise start
  // from the first stop (nearest-neighbor from origin = first stop).
  let curLat = startLat ?? remaining[0].lat;
  let curLng = startLng ?? remaining[0].lng;

  // If no start position, find the stop nearest to the centroid as a
  // reasonable origin guess.
  if (startLat == null || startLng == null) {
    const centroidLat = stops.reduce((s, st) => s + st.lat, 0) / stops.length;
    const centroidLng = stops.reduce((s, st) => s + st.lng, 0) / stops.length;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistanceMiles(centroidLat, centroidLng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    // Move the chosen start to front.
    const [start] = remaining.splice(bestIdx, 1);
    ordered.push(start);
    curLat = start.lat;
    curLng = start.lng;
  }

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistanceMiles(curLat, curLng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const [next] = remaining.splice(bestIdx, 1);
    totalMiles += bestDist;
    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }

  return { ordered, totalMiles };
}

/**
 * Optimize the route for a given server and list of attempt IDs.
 * Reorders attempts using a nearest-neighbor heuristic for minimum
 * travel distance. Attempts without coordinates are appended in their
 * original order after all geocoded stops.
 *
 * @param db - D1 database handle
 * @param serverId - The user id of the process server
 * @param attemptIds - Array of serve_attempts.id values to optimize
 * @returns Ordered attempt IDs, estimated total distance, and drive time
 */
export async function optimizeRouteForServer(
  db: D1Database,
  serverId: number,
  attemptIds: number[],
): Promise<OptimizationResult> {
  if (attemptIds.length === 0) {
    return {
      orderedAttemptIds: [],
      totalDistanceMiles: 0,
      estimatedDriveTimeMinutes: 0,
      stops: [],
    };
  }

  const { withCoords, withoutCoords } = await fetchStops(db, attemptIds);

  // Get server's current location from their most recent GPS fix if available.
  const serverLoc = await queryFirst<{ lat: number; lng: number }>(
    db,
    // clearpathgps_reports does not exist; gps_breadcrumbs is the live
    // officer-keyed location source (see serveQueueEnhanced.ts).
    `SELECT latitude AS lat, longitude AS lng
       FROM gps_breadcrumbs
       WHERE officer_id = ?
       ORDER BY recorded_at DESC LIMIT 1`,
    serverId,
  );

  const { ordered, totalMiles } = nearestNeighborSort(
    withCoords,
    serverLoc?.lat ?? null,
    serverLoc?.lng ?? null,
  );

  // Append un-geocoded stops at the end (they can't be distance-optimized).
  const allStops = [...ordered, ...withoutCoords];

  // Also include any attempt IDs that weren't found in the query (defensive).
  const foundIds = new Set(allStops.map((s) => s.attemptId));
  const missingIds = attemptIds.filter((id) => !foundIds.has(id));

  return {
    orderedAttemptIds: [...allStops.map((s) => s.attemptId), ...missingIds],
    totalDistanceMiles: Math.round(totalMiles * 10) / 10,
    estimatedDriveTimeMinutes: estimateDriveTime(totalMiles),
    stops: allStops,
  };
}

/**
 * Optimize route using USER-PROVIDED GPS as the start origin (browser geolocation).
 * Unlike optimizeRoute() which uses server-side ClearPathGPS data, this accepts
 * lat/lng directly from the client so the optimization starts from the officer's
 * actual real-time position.
 */
export async function optimizeRouteFromUserLocation(
  db: D1Database,
  attemptIds: number[],
  userLat: number,
  userLng: number,
): Promise<OptimizationResult> {
  if (attemptIds.length === 0) {
    return { orderedAttemptIds: [], totalDistanceMiles: 0, estimatedDriveTimeMinutes: 0, stops: [] };
  }
  const { withCoords, withoutCoords } = await fetchStops(db, attemptIds);
  const { ordered, totalMiles } = nearestNeighborSort(withCoords, userLat, userLng);
  const allStops = [...ordered, ...withoutCoords];
  const foundIds = new Set(allStops.map((s) => s.attemptId));
  const missingIds = attemptIds.filter((id) => !foundIds.has(id));
  return {
    orderedAttemptIds: [...allStops.map((s) => s.attemptId), ...missingIds],
    totalDistanceMiles: Math.round(totalMiles * 10) / 10,
    estimatedDriveTimeMinutes: estimateDriveTime(totalMiles),
    stops: allStops,
  };
}

// ── Batch optimization ─────────────────────────────────────

/**
 * For every server with pending/assigned attempts, optimize their routes.
 * Returns per-server optimization results. Servers with no valid attempts
 * are omitted from the results.
 *
 * @param db - D1 database handle
 * @returns Array of per-server route optimization results
 */
export async function batchOptimizeAllServers(
  db: D1Database,
): Promise<ServerRouteSummary[]> {
  // Find all servers (users with role='officer') that have pending/assigned attempts.
  const servers = await query<{ id: number; full_name: string }>(
    db,
    // Same live-schema mapping as fetchStops above: serve_attempts uses
    // officer_id / serve_queue_id, and has no `status` — an unresolved attempt
    // is one whose `result` is still null/pending.
    `SELECT DISTINCT u.id, u.full_name
       FROM users u
       JOIN serve_attempts a ON a.officer_id = u.id
       JOIN serve_queue q ON q.id = a.serve_queue_id
       WHERE u.role = 'officer'
         AND (a.result IS NULL OR a.result = 'pending')
         AND q.status NOT IN ('served', 'cancelled', 'failed')`,
  ).catch(() => []);

  const results: ServerRouteSummary[] = [];

  for (const server of servers) {
    // Fetch the attempt IDs for this server.
    const attempts = await query<{ id: number }>(
      db,
      `SELECT a.id
         FROM serve_attempts a
         JOIN serve_queue q ON q.id = a.serve_queue_id
         WHERE a.officer_id = ?
           AND (a.result IS NULL OR a.result = 'pending')
           AND q.status NOT IN ('served', 'cancelled', 'failed')
         ORDER BY q.priority DESC, q.deadline ASC NULLS LAST, a.attempt_at ASC`,
      server.id,
    ).catch(() => []);

    if (attempts.length === 0) continue;

    const optimization = await optimizeRouteForServer(
      db,
      server.id,
      attempts.map((a) => a.id),
    );

    results.push({
      serverId: server.id,
      serverName: server.full_name,
      attemptCount: attempts.length,
      optimization,
    });
  }

  return results;
}

// ── Nearest unassigned attempt ─────────────────────────────

/**
 * Find the closest unassigned serve attempt to a given location.
 * Only considers attempts from serve_queue with valid coordinates
 * that are not yet assigned and have an active status.
 *
 * @param db - D1 database handle
 * @param serverLat - Server's current latitude
 * @param serverLng - Server's current longitude
 * @param maxRadiusMiles - Maximum search radius in miles (default 50)
 * @returns The nearest unassigned attempt within radius, or null
 */
export async function getNearestUnassignedAttempt(
  db: D1Database,
  serverLat: number,
  serverLng: number,
  maxRadiusMiles: number = 50,
): Promise<NearestAttemptResult | null> {
  if (!Number.isFinite(serverLat) || !Number.isFinite(serverLng)) return null;

  // Fetch all unassigned active attempts with valid coordinates.
  // We pull a broad set and filter in-memory — D1 doesn't support
  // Haversine in SQL, and the candidate set is bounded by queue size.
  const candidates = await query<{
    id: number;
    queue_id: number;
    lat: number;
    lng: number;
    address: string;
    defendant_name: string;
    priority: string;
    case_number: string;
  }>(
    db,
    `SELECT a.id, q.id AS queue_id,
            q.recipient_lat AS lat, q.recipient_lng AS lng,
            q.recipient_address AS address,
            q.defendant_name AS defendant_name,
            q.priority AS priority,
            q.case_number AS case_number
       FROM serve_queue q
       JOIN serve_attempts a ON a.serve_queue_id = q.id
       WHERE a.officer_id IS NULL
         AND (a.result IS NULL OR a.result = 'pending')
         AND q.status IN ('pending', 'assigned', 'in_progress', 'attempted')
         AND q.recipient_lat IS NOT NULL AND q.recipient_lng IS NOT NULL`,
  ).catch(() => []);

  let best: NearestAttemptResult | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const dist = haversineDistanceMiles(serverLat, serverLng, c.lat, c.lng);
    if (dist <= maxRadiusMiles && dist < bestDist) {
      bestDist = dist;
      best = {
        attemptId: c.id,
        queueId: c.queue_id,
        distanceMiles: Math.round(dist * 10) / 10,
        address: c.address,
        defendantName: c.defendant_name,
        priority: c.priority,
        caseNumber: c.case_number,
      };
    }
  }

  return best;
}

// ── Phase-1 solver: deadline coefficients + time-window penalties + 2-opt ──

export function deadlineCoefficient(stop: RouteStop, now: Date): number {
  if (!stop.deadlineAt) return 1.0;
  const hoursRemaining =
    (new Date(stop.deadlineAt).getTime() - now.getTime()) / 3_600_000;
  if (hoursRemaining > 72) return 1.0;
  if (hoursRemaining > 24) return 0.7;
  if (hoursRemaining > 0) return 0.4;
  return 0.1;
}

export function denverWallClockToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const want = `${year}-${pad(monthIndex + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wallAt = (ms: number) => fmt.format(new Date(ms)).replace(' ', 'T');
  let utc = Date.parse(want + 'Z');
  for (let i = 0; i < 4; i++) {
    const got = wallAt(utc);
    utc += Date.parse(want + 'Z') - Date.parse(got + 'Z');
  }
  return utc;
}

function parseTimeOfDay(timeStr: string, referenceDate: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const ref = new Date(referenceDate);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ref);
  const year = Number(parts.find(p => p.type === 'year')!.value);
  const month = Number(parts.find(p => p.type === 'month')!.value) - 1;
  const day = Number(parts.find(p => p.type === 'day')!.value);
  return denverWallClockToUtcMs(year, month, day, h || 0, m || 0);
}

/** If arrival is before today's window, wait; if the window already closed, go now (never +1d). */
export function clampArrivalToServeWindow(
  arrivalMs: number,
  serveStart: string | null | undefined,
  serveEnd: string | null | undefined,
  routeRefIso?: string,
): number {
  if (!serveStart) return arrivalMs;
  const refIso = routeRefIso || new Date(arrivalMs).toISOString();
  let windowStart = parseTimeOfDay(serveStart, refIso);
  let windowEnd = serveEnd
    ? parseTimeOfDay(serveEnd, refIso)
    : windowStart + 24 * 3600_000;
  if (windowEnd <= windowStart) windowEnd += 86_400_000;
  if (arrivalMs < windowStart) return windowStart;
  return arrivalMs;
}

export function applyTimeWindowPenalties(
  matrix: number[][],
  stops: RouteStop[],
  departAt: string,
  dwellSeconds: number[]
): number[][] {
  const n = stops.length;
  const flat = matrix.flat();
  const maxCost = Math.max(...flat.filter(v => isFinite(v)), 1);
  const PENALTY = 10 * maxCost;
  const result = matrix.map(row => [...row]);
  const departMs = new Date(departAt).getTime();

  for (let j = 0; j < n; j++) {
    const note = stops[j].locationNote;
    if (!note?.serveStart || !note?.serveEnd) continue;
    const windowStart = parseTimeOfDay(note.serveStart, departAt);
    let windowEnd = parseTimeOfDay(note.serveEnd, departAt);
    if (windowEnd <= windowStart) windowEnd += 86_400_000;

    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      const travelS = matrix[i][j] ?? 0;
      const dwellS = dwellSeconds[i] ?? 0;
      const arrivalMs = departMs + (travelS + dwellS) * 1000;
      if (arrivalMs < windowStart || arrivalMs > windowEnd) {
        result[i][j] += PENALTY;
      }
    }
  }
  return result;
}

const BUSINESS_HOURS_START = 8;  // 8 AM
const BUSINESS_HOURS_END = 17;   // 5 PM

export function isWithinBusinessHours(arrivalIso: string): boolean {
  const denverFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const hour = Number(denverFmt.format(new Date(arrivalIso)));
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

export function applyBusinessHoursPenalties(
  matrix: number[][],
  stops: RouteStop[],
  departAt: string,
  dwellSeconds: number[]
): number[][] {
  const n = stops.length;
  const flat = matrix.flat();
  const maxCost = Math.max(...flat.filter(v => isFinite(v)), 1);
  const PENALTY = 5 * maxCost;
  const result = matrix.map(row => [...row]);
  const departMs = new Date(departAt).getTime();

  for (let j = 0; j < n; j++) {
    if (stops[j].defendantType !== 'business') continue;
    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      const travelS = matrix[i][j] ?? 0;
      const dwellS = dwellSeconds[i] ?? 0;
      const arrivalMs = departMs + (travelS + dwellS) * 1000;
      const arrivalIso = new Date(arrivalMs).toISOString();
      if (!isWithinBusinessHours(arrivalIso)) {
        result[i][j] += PENALTY;
      }
    }
  }
  return result;
}

function nearestNeighborOrder(matrix: number[][], n: number, startIdx: number = 0): number[] {
  const visited = new Set<number>([startIdx]);
  const order: number[] = [startIdx];
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && matrix[last][j] < bestCost) {
        bestCost = matrix[last][j];
        best = j;
      }
    }
    order.push(best);
    visited.add(best);
  }
  return order;
}

function twoOpt(matrix: number[][], order: number[], circular: boolean): number[] {
  const n = order.length;
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const hasNext = j + 1 < n;
        const before = matrix[best[i - 1]][best[i]]
          + (hasNext ? matrix[best[j]][best[j + 1]] : (circular ? matrix[best[j]][best[0]] : 0));
        const after = matrix[best[i - 1]][best[j]]
          + (hasNext ? matrix[best[i]][best[j + 1]] : (circular ? matrix[best[i]][best[0]] : 0));
        if (after < before - 0.001) {
          best = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return best;
}

export function optimizeRoute(
  stops: RouteStop[],
  matrix: number[][],
  departAt: string,
  now: Date,
  dwellSeconds: number[],
  options: { circular?: boolean; lockStart?: boolean } = {},
): number[] {
  const n = stops.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const weighted = matrix.map((row, _i) =>
    row.map((cost, j) => cost * deadlineCoefficient(stops[j], now))
  );

  const penalized = applyTimeWindowPenalties(weighted, stops, departAt, dwellSeconds);
  const bizPenalized = applyBusinessHoursPenalties(penalized, stops, departAt, dwellSeconds);

  let startIdx = 0;
  if (!options.lockStart) {
    let lowestCoeff = deadlineCoefficient(stops[0], now);
    for (let i = 1; i < n; i++) {
      const c = deadlineCoefficient(stops[i], now);
      if (c < lowestCoeff) { lowestCoeff = c; startIdx = i; }
    }
  }

  const seed = nearestNeighborOrder(bizPenalized, n, startIdx);
  return twoOpt(bizPenalized, seed, options.circular === true);
}

export function geocodeQualityScore(stop: RouteStop): 'high' | 'low' | 'none' {
  if (stop.lat == null || stop.lng == null) return 'none';
  if (stop.geocodeSource === 'point') return 'high';
  if (stop.geocodeSource === 'centroid') return 'low';
  if (stop.geocodeSource === null) return 'low';
  return 'high';
}

export function collectGeocodeWarnings(stops: RouteStop[]): GeocodeWarning[] {
  return stops
    .map(s => ({ stop: s, quality: geocodeQualityScore(s) }))
    .filter(({ quality }) => quality !== 'high')
    .map(({ stop, quality }) => ({
      jobId: stop.jobId,
      defendant: stop.defendant,
      address: stop.address,
      quality: quality as 'low' | 'none',
    }));
}

function makeOriginStop(origin: OptimizeOrigin): RouteStop {
  return {
    jobId: -1,
    lat: origin.lat,
    lng: origin.lng,
    geocodeSource: 'point',
    deadlineAt: null,
    defendantType: 'individual',
    addressHash: '',
    defendant: '__origin__',
    address: '',
    locationNote: null,
  };
}

export async function optimizeRouteFullPipeline(
  stops: RouteStop[],
  departAt: string,
  db: D1Database,
  mapboxToken: string,
  options: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const now = new Date();
  const geocodeWarnings = collectGeocodeWarnings(stops);
  const dwellSecs = await fetchDwellSeconds(db, stops);
  const origin = options.origin && Number.isFinite(options.origin.lat) && Number.isFinite(options.origin.lng)
    ? options.origin
    : null;
  const allStops = origin ? [makeOriginStop(origin), ...stops] : stops;
  const allDwell = origin ? [0, ...dwellSecs] : dwellSecs;
  const { matrix, fallback, reason } = await buildCostMatrix(allStops, departAt, mapboxToken);
  const orderedIndices = optimizeRoute(allStops, matrix, departAt, now, allDwell, {
    circular: options.circular === true,
    lockStart: origin != null,
  });
  const visitOrder = origin ? orderedIndices.filter(i => i !== 0) : orderedIndices;
  const orderedStops = visitOrder.map(i => (origin ? allStops[i] : stops[i]));
  const etaWalk = origin ? orderedIndices : visitOrder;
  const etaAll = computeEtas(etaWalk, matrix, allDwell, departAt, allStops);
  const etaPerStop = origin ? etaAll.slice(1) : etaAll;

  return { orderedStops, etaPerStop, matrixFallback: fallback, fallbackReason: reason, geocodeWarnings };
}

export async function hashAddress(address: string): Promise<string> {
  const normalized = address.toUpperCase().trim().replace(/\s+/g, ' ');
  const data = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function shouldRecordDwell(seconds: number): boolean {
  return seconds > 30 && seconds < 7200;
}

export function dwellSeconds(arrivedAt: string, loggedAt: string): number {
  return Math.round(
    (new Date(loggedAt).getTime() - new Date(arrivedAt).getTime()) / 1000
  );
}

// ── Dwell-time read path + ETA computation ─────────────────

/**
 * Fetch per-stop average dwell times (seconds) from the serve_dwell_times table.
 * Learned values are clamped to the type range (see DWELL_RANGE_S).
 */
export async function fetchDwellSeconds(
  db: D1Database,
  stops: RouteStop[]
): Promise<number[]> {
  if (stops.length === 0) return [];

  const hashes = stops.map(s => s.addressHash);
  // Use queryInChunks to stay within D1's 100-bound-parameter cap.
  // serve_dwell_times may not yet exist on all environments — degrade to
  // defaults rather than crashing the entire route optimization on a missing table.
  const rows = await queryInChunks<{ address_hash: string; avg_dwell: number }>(
    db,
    hashes,
    placeholders =>
      `SELECT address_hash, CAST(AVG(dwell_seconds) AS INTEGER) AS avg_dwell
       FROM serve_dwell_times
       WHERE address_hash IN (${placeholders})
         AND logged_at > datetime('now', '-90 days')
       GROUP BY address_hash`,
  ).catch(() => [] as { address_hash: string; avg_dwell: number }[]);

  const byHash = new Map(rows.map(r => [r.address_hash, r.avg_dwell]));
  return stops.map(s => clampDwellSeconds(s.defendantType as DefendantType, byHash.get(s.addressHash)));
}

/** Attach planner dwell (learned + clamped) onto serve_queue list rows. */
export async function attachLearnedDwellSeconds<T extends {
  recipient_address?: string | null;
  business_id?: number | null;
  recipient_type?: string | null;
}>(db: D1Database, jobs: T[]): Promise<void> {
  if (jobs.length === 0) return;
  const hashed = await Promise.all(jobs.map(async (j) => {
    const addr = (j.recipient_address || '').trim();
    const addressHash = addr ? await hashAddress(addr) : '';
    return {
      job: j,
      stop: {
        jobId: 0,
        lat: 0,
        lng: 0,
        geocodeSource: null,
        deadlineAt: null,
        defendantType: inferDefendantType(j.recipient_address, j.business_id, j.recipient_type),
        addressHash,
        defendant: '',
        address: addr,
        locationNote: null,
      } satisfies RouteStop,
    };
  }));
  const withHash = hashed.filter((h) => h.stop.addressHash);
  const dwells = await fetchDwellSeconds(db, withHash.map((h) => h.stop));
  const byHash = new Map(withHash.map((h, i) => [h.stop.addressHash, dwells[i]]));
  for (const h of hashed) {
    const learned = h.stop.addressHash ? byHash.get(h.stop.addressHash) : undefined;
    (h.job as T & { learned_dwell_seconds: number }).learned_dwell_seconds =
      learned ?? clampDwellSeconds(h.stop.defendantType);
  }
}

/**
 * Compute ARRIVAL ETAs for each stop in visit order.
 * Travel comes from `matrix` (seconds). Dwell is applied AFTER the arrival
 * so the next leg departs from the stop, but the returned timestamp is when
 * the officer is expected to arrive — matching the "ETA" label in the planner.
 */
export function computeEtas(
  orderedIndices: number[],
  matrix: number[][],
  dwellSeconds: number[],
  departAt: string,
  stops?: RouteStop[],
): string[] {
  const etas: string[] = [];
  let currentMs = new Date(departAt).getTime();
  if (!Number.isFinite(currentMs)) currentMs = Date.now();
  for (let step = 0; step < orderedIndices.length; step++) {
    const idx = orderedIndices[step];
    const prevIdx = step === 0 ? -1 : orderedIndices[step - 1];
    const travelSeconds = step === 0 ? 0 : (matrix[prevIdx]?.[idx] ?? 0);
    currentMs += travelSeconds * 1000;
    const note = stops?.[idx]?.locationNote;
    if (note?.serveStart) {
      currentMs = clampArrivalToServeWindow(currentMs, note.serveStart, note.serveEnd, departAt);
    }
    etas.push(new Date(currentMs).toISOString());
    currentMs += (dwellSeconds[idx] ?? 0) * 1000;
  }
  return etas;
}

// ---------------------------------------------------------------------------
// Mid-shift traffic degradation detection
// ---------------------------------------------------------------------------

const TRAFFIC_DEGRADE_THRESHOLD_S = 900;  // 15 min total added
const TRAFFIC_SEGMENT_THRESHOLD_S = 600;  // 10 min per segment

/**
 * Compare current live traffic costs against original ETAs.
 * Returns a TrafficCheckResult indicating whether re-routing is warranted.
 *
 * @param remainingStops - Stops not yet served, in their current visit order
 * @param currentOrder   - Indices into remainingStops representing the planned sequence
 * @param currentPosition - Officer's current GPS position
 * @param originalEtas   - ISO timestamps from the last route optimization (one per stop in currentOrder)
 * @param db             - D1 database binding (for dwell-time lookup)
 * @param mapboxToken    - Mapbox secret token for the Matrix API
 */
export async function checkTrafficDegradation(
  remainingStops: RouteStop[],
  currentOrder: number[],
  currentPosition: { lat: number; lng: number },
  originalEtas: string[],
  db: D1Database,
  mapboxToken: string,
): Promise<TrafficCheckResult> {
  if (remainingStops.length === 0) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: [],
      newEtas: [],
      degradedSegments: [],
      matrixFallback: false,
    };
  }

  if (originalEtas.length < currentOrder.length) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: currentOrder.map(i => remainingStops[i]),
      newEtas: originalEtas,
      degradedSegments: [],
      matrixFallback: true,
    };
  }

  const outOfBounds = currentOrder.some(i => i < 0 || i >= remainingStops.length);
  if (outOfBounds) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: remainingStops,
      newEtas: originalEtas,
      degradedSegments: [],
      matrixFallback: true,
    };
  }

  const origin: RouteStop = {
    jobId: -1,
    lat: currentPosition.lat,
    lng: currentPosition.lng,
    geocodeSource: 'point',
    deadlineAt: null,
    defendantType: 'individual',
    addressHash: '',
    defendant: '__origin__',
    address: '',
    locationNote: null,
  };

  const allStops = [origin, ...remainingStops];
  const nowIso = new Date().toISOString();
  const { matrix, fallback, reason } = await buildCostMatrix(allStops, nowIso, mapboxToken);

  if (fallback) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: currentOrder.map(i => remainingStops[i]),
      newEtas: originalEtas,
      degradedSegments: [],
      matrixFallback: true,
      fallbackReason: reason,
    };
  }

  // Reconstruct original per-segment durations from ETA timestamps
  const departMs = Date.now();
  const originalSegmentSeconds: number[] = currentOrder.map((_, step) => {
    if (step === 0) return (new Date(originalEtas[0]).getTime() - departMs) / 1000;
    return (new Date(originalEtas[step]).getTime() - new Date(originalEtas[step - 1]).getTime()) / 1000;
  });

  // Compare new live traffic costs against original plan
  const degradedSegments: TrafficCheckResult['degradedSegments'] = [];
  let totalAddedSeconds = 0;

  for (let step = 0; step < currentOrder.length; step++) {
    const stopIdx = currentOrder[step];
    const matrixStopIdx = stopIdx + 1; // +1: origin is [0] in allStops
    const prevMatrixIdx = step === 0 ? 0 : currentOrder[step - 1] + 1;
    const newCost = matrix[prevMatrixIdx][matrixStopIdx];
    // Clamp to 0 in case ETAs are already past (officer is late — don't inflate "added")
    const originalCost = Math.max(0, originalSegmentSeconds[step]);
    const added = newCost - originalCost;

    if (added > TRAFFIC_SEGMENT_THRESHOLD_S) {
      degradedSegments.push({
        fromJobId: step === 0 ? -1 : remainingStops[currentOrder[step - 1]].jobId,
        toJobId: remainingStops[stopIdx].jobId,
        addedSeconds: Math.round(added),
      });
    }
    totalAddedSeconds += Math.max(0, added);
  }

  const degraded = totalAddedSeconds > TRAFFIC_DEGRADE_THRESHOLD_S;

  const now = new Date();
  const dwellSecs = await fetchDwellSeconds(db, remainingStops);
  const allDwell = [0, ...dwellSecs];
  const newOrderAll = degraded
    ? optimizeRoute(allStops, matrix, nowIso, now, allDwell, { lockStart: true })
    : [0, ...currentOrder.map(i => i + 1)];
  const newOrderIndices = newOrderAll.filter(i => i !== 0).map(i => i - 1);

  const newOrder = newOrderIndices.map(i => remainingStops[i]);
  const newEtas = computeEtas(newOrderAll, matrix, allDwell, nowIso, allStops).slice(1);

  return {
    degraded,
    addedMinutes: Math.round(totalAddedSeconds / 60),
    newOrder,
    newEtas,
    degradedSegments,
    matrixFallback: false,
  };
}
