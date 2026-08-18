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

// ── Phase-1 route-planner types (added 2026-08-12) ─────────

const APARTMENT_PATTERNS = /\b(apt|apartment|unit|ste|suite|bldg|building|fl(?:oor)?|#)\b|\s#\d/i;

export function inferDefendantType(
  address: string | null | undefined,
  businessId: number | null | undefined,
): 'individual' | 'apartment' | 'business' {
  if (businessId) return 'business';
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

export interface OptimizeResult {
  orderedStops: RouteStop[];
  etaPerStop: string[];
  matrixFallback: boolean;
  geocodeWarnings: GeocodeWarning[];
}

export interface TrafficCheckResult {
  degraded: boolean;
  addedMinutes: number;
  newOrder: RouteStop[];
  newEtas: string[];
  degradedSegments: Array<{ fromJobId: number; toJobId: number; addedSeconds: number }>;
  matrixFallback: boolean;
}

/**
 * Haversine distance between two {lat, lng} points. Returns metres.
 * Used as the fallback matrix calculation when live traffic data is unavailable.
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
 * Build an n×n distance matrix (metres) for a list of stops.
 * Diagonal entries are 0. Used as fallback when Mapbox Matrix API is unavailable.
 */
export function haversineMatrix(stops: Array<{ lat: number; lng: number }>): number[][] {
  return stops.map(a => stops.map(b => haversineDistance(a, b)));
}

// ── Mapbox Matrix API ──────────────────────────────────────

const MATRIX_CHUNK_SIZE = 25;

export async function buildCostMatrix(
  stops: RouteStop[],
  departAt: string,
  mapboxToken: string
): Promise<{ matrix: number[][]; fallback: boolean }> {
  if (!mapboxToken) {
    return { matrix: haversineMatrix(stops), fallback: true };
  }

  if (stops.length <= MATRIX_CHUNK_SIZE) {
    return fetchMatrixChunk(stops, departAt, mapboxToken);
  }

  // Chunk into overlapping 25-stop windows and merge
  const n = stops.length;
  const result: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let fallback = false;

  for (let start = 0; start < n; start += MATRIX_CHUNK_SIZE) {
    const end = Math.min(start + MATRIX_CHUNK_SIZE, n);
    const chunk = stops.slice(start, end);
    const { matrix: chunkMatrix, fallback: chunkFallback } = await fetchMatrixChunk(
      chunk,
      departAt,
      mapboxToken
    );
    if (chunkFallback) fallback = true;
    for (let i = start; i < end; i++) {
      for (let j = start; j < end; j++) {
        result[i][j] = chunkMatrix[i - start][j - start];
      }
    }
    // Fill cross-chunk cells with haversine fallback.
    // Mixed data sources (Mapbox durations for intra-chunk, haversine for
    // cross-chunk) are unavoidable in the chunked path, so mark fallback true
    // unconditionally whenever any cross-chunk cells are filled.
    if (start > 0) {
      fallback = true;
      for (let i = 0; i < start; i++) {
        for (let j = start; j < end; j++) {
          if (result[i][j] === 0 && i !== j) {
            result[i][j] = haversineDistance(stops[i], stops[j]);
            result[j][i] = result[i][j];
          }
        }
      }
    }
  }
  return { matrix: result, fallback };
}

async function fetchMatrixChunk(
  stops: RouteStop[],
  departAt: string,
  mapboxToken: string
): Promise<{ matrix: number[][]; fallback: boolean }> {
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
  const url = new URL(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coords}`
  );
  url.searchParams.set('sources', 'all');
  url.searchParams.set('destinations', 'all');
  url.searchParams.set('depart_at', departAt);
  url.searchParams.set('access_token', mapboxToken);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Mapbox Matrix HTTP ${res.status}`);
    const data = await (res.json() as Promise<{ durations: number[][] }>);
    return { matrix: data.durations, fallback: false };
  } catch {
    return { matrix: haversineMatrix(stops), fallback: true };
  }
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
const URBAN_AVG_MPH = 25;
const ROAD_WINDING_FACTOR = 1.3;

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

function getDenverOffsetMs(date: Date): number {
  // Returns Denver's UTC offset in milliseconds (e.g. -21600000 for UTC-6)
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const denverStr = date.toLocaleString('en-US', { timeZone: 'America/Denver' });
  return new Date(utcStr).getTime() - new Date(denverStr).getTime();
}

function parseTimeOfDay(timeStr: string, referenceDate: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  // Get the Denver date parts for the reference date
  const ref = new Date(referenceDate);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ref);
  const year = Number(parts.find(p => p.type === 'year')!.value);
  const month = Number(parts.find(p => p.type === 'month')!.value) - 1;
  const day = Number(parts.find(p => p.type === 'day')!.value);
  // Build the target time in Denver by creating a UTC date that corresponds to h:m Denver wall clock
  const denverOffset = getDenverOffsetMs(ref);
  return Date.UTC(year, month, day, h, m, 0, 0) - denverOffset;
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
    const windowEnd = parseTimeOfDay(note.serveEnd, departAt);

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
  const denverFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false });
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

function twoOpt(matrix: number[][], order: number[]): number[] {
  const n = order.length;
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const nextJ = j + 1 < n ? j + 1 : 0;
        const before = matrix[best[i - 1]][best[i]] + (matrix[best[j]][best[nextJ]] ?? 0);
        const after = matrix[best[i - 1]][best[j]] + (matrix[best[i]][best[nextJ]] ?? 0);
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
  dwellSeconds: number[]
): number[] {
  const n = stops.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Apply deadline coefficients to matrix
  const weighted = matrix.map((row, _i) =>
    row.map((cost, j) => cost * deadlineCoefficient(stops[j], now))
  );

  // Apply time-window penalties on top of weighted costs
  const penalized = applyTimeWindowPenalties(weighted, stops, departAt, dwellSeconds);

  // Penalize business stops arriving outside 8 AM – 5 PM Denver time
  const bizPenalized = applyBusinessHoursPenalties(penalized, stops, departAt, dwellSeconds);

  // Start from the most urgent stop (lowest deadline coefficient = highest priority)
  let startIdx = 0;
  let lowestCoeff = deadlineCoefficient(stops[0], now);
  for (let i = 1; i < n; i++) {
    const c = deadlineCoefficient(stops[i], now);
    if (c < lowestCoeff) { lowestCoeff = c; startIdx = i; }
  }

  const seed = nearestNeighborOrder(bizPenalized, n, startIdx);
  return twoOpt(bizPenalized, seed);
}

export function geocodeQualityScore(stop: RouteStop): 'high' | 'low' | 'none' {
  if (stop.geocodeSource === 'point') return 'high';
  if (stop.geocodeSource === 'centroid') return 'low';
  if (stop.geocodeSource === null) return 'high'; // null = benefit of the doubt; don't warn on pre-existing jobs
  if (stop.lat == null || stop.lng == null) return 'none';
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

export async function optimizeRouteFullPipeline(
  stops: RouteStop[],
  departAt: string,
  db: D1Database,
  mapboxToken: string
): Promise<OptimizeResult> {
  const now = new Date();
  const geocodeWarnings = collectGeocodeWarnings(stops);
  const dwellSecs = await fetchDwellSeconds(db, stops);
  const { matrix, fallback } = await buildCostMatrix(stops, departAt, mapboxToken);
  const orderedIndices = optimizeRoute(stops, matrix, departAt, now, dwellSecs);
  const orderedStops = orderedIndices.map(i => stops[i]);
  const etaPerStop = computeEtas(orderedIndices, matrix, dwellSecs, departAt);

  return { orderedStops, etaPerStop, matrixFallback: fallback, geocodeWarnings };
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

const DEFAULT_DWELL: Record<RouteStop['defendantType'], number> = {
  individual: 420,   // 7 minutes — house: knock, ID, serve, brief exchange
  apartment: 600,    // 10 minutes — complex: navigate building/gate, find unit, wait for access
  business: 780,     // 13 minutes — lobby/reception, wait for agent, verify authority
};

/**
 * Fetch per-stop average dwell times (seconds) from the serve_dwell_times table.
 * Falls back to DEFAULT_DWELL constants when no 90-day history exists for a stop.
 * Result array is parallel-indexed to `stops`.
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
  return stops.map(s => byHash.get(s.addressHash) ?? DEFAULT_DWELL[s.defendantType]);
}

/**
 * Compute ETAs for each stop in the optimized order.
 * Each ETA is the ISO timestamp at which the server is expected to DEPART
 * the stop (arrival + dwell). Travel time between stops comes from `matrix`.
 *
 * @param orderedIndices - Stop indices in visit order (from optimizeRoute)
 * @param matrix - n×n travel-time matrix in seconds
 * @param dwellSeconds - Per-stop dwell time in seconds, parallel-indexed to the original stops array
 * @param departAt - ISO timestamp of route start
 * @returns ISO timestamp strings, one per stop in orderedIndices order
 */
export function computeEtas(
  orderedIndices: number[],
  matrix: number[][],
  dwellSeconds: number[],
  departAt: string
): string[] {
  const etas: string[] = [];
  let currentMs = new Date(departAt).getTime();
  for (let step = 0; step < orderedIndices.length; step++) {
    const idx = orderedIndices[step];
    const prevIdx = step === 0 ? -1 : orderedIndices[step - 1];
    const travelSeconds = step === 0 ? 0 : (matrix[prevIdx][idx] ?? 0);
    currentMs += (travelSeconds + (dwellSeconds[idx] ?? 0)) * 1000;
    etas.push(new Date(currentMs).toISOString());
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
  const { matrix, fallback } = await buildCostMatrix(allStops, nowIso, mapboxToken);

  if (fallback) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: currentOrder.map(i => remainingStops[i]),
      newEtas: originalEtas,
      degradedSegments: [],
      matrixFallback: true,
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

  // Re-optimize with live matrix when degraded
  const now = new Date();
  const dwellSecs = await fetchDwellSeconds(db, remainingStops);
  const remainingMatrix = matrix.slice(1).map(row => row.slice(1)); // strip origin row/col
  const newOrderIndices = degraded
    ? optimizeRoute(remainingStops, remainingMatrix, nowIso, now, dwellSecs)
    : currentOrder;

  const newOrder = newOrderIndices.map(i => remainingStops[i]);
  const newEtas = computeEtas(newOrderIndices, remainingMatrix, dwellSecs, nowIso);

  return {
    degraded,
    addedMinutes: Math.round(totalAddedSeconds / 60),
    newOrder,
    newEtas,
    degradedSegments,
    matrixFallback: false,
  };
}
