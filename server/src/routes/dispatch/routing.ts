// ============================================================
// RMPG Flex — Dispatch Route Builder API
//
// Automatic multi-stop route optimization for officers handling
// multiple CFS calls. Uses nearest-neighbor + 2-opt heuristic
// for server-side TSP solving, with haversine distances.
//
// Endpoints:
//   POST   /routing/optimize     — Compute optimized stop order
//   GET    /routing/unit/:unitId — Get active/saved routes for a unit
//   POST   /routing/save         — Persist a route
//   PUT    /routing/:id          — Update route (reorder, notes)
//   DELETE /routing/:id          — Delete a saved route
//   POST   /routing/:id/complete-stop — Mark a stop completed
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { paramStr } from '../../utils/reqHelpers';

const router = Router();

// ─── Haversine Distance ─────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineMeters(lat1, lng1, lat2, lng2) / 1609.344;
}

// ─── TSP Solver: Nearest Neighbor + 2-opt ───────────────────

interface Waypoint {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  latitude: number;
  longitude: number;
  location_address: string;
  status: string;
  description?: string;
}

/**
 * Build distance matrix between all points (including origin at index 0).
 */
function buildDistanceMatrix(
  origin: { lat: number; lng: number },
  waypoints: Waypoint[],
): number[][] {
  const n = waypoints.length + 1; // +1 for origin
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const lat1 = i === 0 ? origin.lat : waypoints[i - 1].latitude;
      const lng1 = i === 0 ? origin.lng : waypoints[i - 1].longitude;
      const lat2 = j === 0 ? origin.lat : waypoints[j - 1].latitude;
      const lng2 = j === 0 ? origin.lng : waypoints[j - 1].longitude;
      const d = haversineMiles(lat1, lng1, lat2, lng2);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }

  return matrix;
}

/**
 * Nearest-neighbor greedy starting from origin (index 0).
 * Priority-weighted: P1 calls get a distance bonus (closer in priority-adjusted space).
 */
function nearestNeighbor(
  matrix: number[][],
  waypoints: Waypoint[],
  priorityWeight: boolean,
): number[] {
  const n = matrix.length;
  const visited = new Set<number>([0]); // origin visited
  const order: number[] = [];
  let current = 0;

  // Priority multipliers — lower priority calls appear "farther"
  const priorityMult: Record<string, number> = {
    P1: 0.5,  // P1 appears half the distance — prioritized
    P2: 0.8,
    P3: 1.0,
    P4: 1.3,
  };

  while (order.length < n - 1) {
    let bestDist = Infinity;
    let bestIdx = -1;

    for (let j = 1; j < n; j++) {
      if (visited.has(j)) continue;
      let d = matrix[current][j];
      if (priorityWeight) {
        const wp = waypoints[j - 1];
        d *= priorityMult[wp.priority] ?? 1.0;
      }
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }

    if (bestIdx === -1) break;
    visited.add(bestIdx);
    order.push(bestIdx);
    current = bestIdx;
  }

  return order;
}

/**
 * 2-opt local search improvement on the route.
 * Iteratively reverses segments to reduce total distance.
 */
function twoOpt(matrix: number[][], route: number[]): number[] {
  const improved = [...route];
  let totalDist = routeDistance(matrix, improved);
  let betterFound = true;
  let iterations = 0;
  const maxIterations = 1000;

  while (betterFound && iterations < maxIterations) {
    betterFound = false;
    iterations++;
    for (let i = 0; i < improved.length - 1; i++) {
      for (let j = i + 1; j < improved.length; j++) {
        // Reverse the segment between i and j
        const newRoute = [
          ...improved.slice(0, i),
          ...improved.slice(i, j + 1).reverse(),
          ...improved.slice(j + 1),
        ];
        const newDist = routeDistance(matrix, newRoute);
        if (newDist < totalDist - 0.001) {
          improved.splice(0, improved.length, ...newRoute);
          totalDist = newDist;
          betterFound = true;
        }
      }
    }
  }

  return improved;
}

/**
 * Calculate total route distance starting from origin (index 0).
 */
function routeDistance(matrix: number[][], route: number[]): number {
  if (route.length === 0) return 0;
  let dist = matrix[0][route[0]]; // origin → first stop
  for (let i = 0; i < route.length - 1; i++) {
    dist += matrix[route[i]][route[i + 1]];
  }
  return dist;
}

// ─── POST /routing/optimize ─────────────────────────────────
// Accepts unit position + call IDs, returns optimized stop order.
// If no call_ids given, auto-detects from call_stack + assigned calls.

router.post(
  '/routing/optimize',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const {
      unit_id,
      origin_lat,
      origin_lng,
      call_ids,
      priority_weighted = true,
    } = req.body;

    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required' });
      return;
    }

    // Determine origin — provided or from latest GPS breadcrumb
    let originLat = origin_lat;
    let originLng = origin_lng;
    if (originLat == null || originLng == null) {
      const gps = db
        .prepare(
          `SELECT latitude, longitude FROM gps_breadcrumbs
         WHERE unit_id = ? ORDER BY recorded_at DESC LIMIT 1`,
        )
        .get(unit_id) as { latitude: number; longitude: number } | undefined;
      if (gps) {
        originLat = gps.latitude;
        originLng = gps.longitude;
      } else {
        // Default to SLC HQ
        originLat = 40.7608;
        originLng = -111.891;
      }
    }

    // Gather calls — either explicit list or auto-detect
    let callIds: number[] = [];
    if (Array.isArray(call_ids) && call_ids.length > 0) {
      callIds = call_ids.map(Number).filter(Number.isFinite);
    } else {
      // Auto-detect: call_stack entries + directly assigned active calls
      const stackRows = db
        .prepare(
          `SELECT call_id FROM call_stack WHERE unit_id = ? ORDER BY priority_order ASC`,
        )
        .all(unit_id) as { call_id: number }[];

      const assignedRows = db
        .prepare(
          `SELECT id FROM calls_for_service
         WHERE status IN ('dispatched','enroute','onscene','pending','open')
           AND json_extract(assigned_unit_ids, '$') LIKE '%' || ? || '%'`,
        )
        .all(String(unit_id)) as { id: number }[];

      const idSet = new Set<number>();
      for (const r of stackRows) idSet.add(r.call_id);
      for (const r of assignedRows) idSet.add(r.id);
      callIds = [...idSet];
    }

    if (callIds.length === 0) {
      res.json({
        optimized_order: [],
        waypoints: [],
        total_distance_miles: 0,
        estimated_time_minutes: 0,
      });
      return;
    }

    // Fetch call details with coordinates
    const placeholders = callIds.map(() => '?').join(',');
    const calls = db
      .prepare(
        `SELECT id, call_number, incident_type, priority, latitude, longitude,
              location_address, status, description
       FROM calls_for_service
       WHERE id IN (${placeholders})
         AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      )
      .all(...callIds) as Waypoint[];

    if (calls.length === 0) {
      res.json({
        optimized_order: [],
        waypoints: [],
        total_distance_miles: 0,
        estimated_time_minutes: 0,
        warning: 'No geocoded calls found — calls need latitude/longitude coordinates.',
      });
      return;
    }

    // Build distance matrix and optimize
    const origin = { lat: originLat, lng: originLng };
    const matrix = buildDistanceMatrix(origin, calls);
    const greedyOrder = nearestNeighbor(matrix, calls, priority_weighted);
    const optimizedOrder = twoOpt(matrix, greedyOrder);

    // Map back to waypoints in optimized order
    const orderedWaypoints = optimizedOrder.map((idx, stopNum) => {
      const wp = calls[idx - 1]; // idx-1 because matrix index 0 is origin
      return {
        stop_number: stopNum + 1,
        call_id: wp.id,
        call_number: wp.call_number,
        incident_type: wp.incident_type,
        priority: wp.priority,
        latitude: wp.latitude,
        longitude: wp.longitude,
        location_address: wp.location_address,
        status: wp.status,
        description: wp.description,
        distance_from_prev_miles:
          stopNum === 0
            ? matrix[0][optimizedOrder[0]]
            : matrix[optimizedOrder[stopNum - 1]][optimizedOrder[stopNum]],
      };
    });

    const totalDistance = routeDistance(matrix, optimizedOrder);
    // Rough estimate: avg 25mph city driving
    const estimatedMinutes = (totalDistance / 25) * 60;

    res.json({
      unit_id,
      origin: { lat: originLat, lng: originLng },
      optimized_order: orderedWaypoints.map((w) => w.call_id),
      waypoints: orderedWaypoints,
      total_distance_miles: Math.round(totalDistance * 100) / 100,
      estimated_time_minutes: Math.round(estimatedMinutes),
      algorithm: 'nearest-neighbor + 2-opt',
      priority_weighted,
    });
  },
);

// ─── GET /routing/unit/:unitId ──────────────────────────────
// Get saved routes for a unit.

router.get(
  '/routing/unit/:unitId',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const unitId = paramStr(req.params.unitId);
    const rows = db
      .prepare(
        `SELECT * FROM dispatch_routes
       WHERE unit_id = ? AND status = 'active'
       ORDER BY created_at DESC`,
      )
      .all(unitId);
    res.json(rows);
  },
);

// ─── POST /routing/save ─────────────────────────────────────
// Persist an optimized route.

router.post(
  '/routing/save',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const {
      unit_id,
      origin_lat,
      origin_lng,
      waypoints_json,
      optimized_order_json,
      total_distance_miles,
      estimated_time_minutes,
      notes,
    } = req.body;

    if (!unit_id || !waypoints_json) {
      res.status(400).json({ error: 'unit_id and waypoints_json are required' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO dispatch_routes
       (unit_id, created_by, origin_lat, origin_lng, waypoints_json,
        optimized_order_json, total_distance_miles, estimated_time_minutes, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      )
      .run(
        unit_id,
        (req as any).user?.id,
        origin_lat,
        origin_lng,
        typeof waypoints_json === 'string' ? waypoints_json : JSON.stringify(waypoints_json),
        typeof optimized_order_json === 'string'
          ? optimized_order_json
          : JSON.stringify(optimized_order_json),
        total_distance_miles,
        estimated_time_minutes,
        notes ?? null,
      );

    broadcastDispatchUpdate({
      action: 'route_saved',
      data: { unit_id, route_id: result.lastInsertRowid },
    });

    res.json({ success: true, id: result.lastInsertRowid });
  },
);

// ─── PUT /routing/:id ───────────────────────────────────────
// Update a saved route (reorder stops, add notes).

router.put(
  '/routing/:id',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const routeId = parseInt(paramStr(req.params.id), 10);
    const { waypoints_json, optimized_order_json, total_distance_miles, estimated_time_minutes, notes } =
      req.body;

    const existing = db.prepare('SELECT id, unit_id FROM dispatch_routes WHERE id = ?').get(routeId) as
      | { id: number; unit_id: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }

    db.prepare(
      `UPDATE dispatch_routes SET
       waypoints_json = COALESCE(?, waypoints_json),
       optimized_order_json = COALESCE(?, optimized_order_json),
       total_distance_miles = COALESCE(?, total_distance_miles),
       estimated_time_minutes = COALESCE(?, estimated_time_minutes),
       notes = COALESCE(?, notes),
       updated_at = datetime('now','localtime')
     WHERE id = ?`,
    ).run(
      waypoints_json ? (typeof waypoints_json === 'string' ? waypoints_json : JSON.stringify(waypoints_json)) : null,
      optimized_order_json
        ? typeof optimized_order_json === 'string'
          ? optimized_order_json
          : JSON.stringify(optimized_order_json)
        : null,
      total_distance_miles ?? null,
      estimated_time_minutes ?? null,
      notes ?? null,
      routeId,
    );

    broadcastDispatchUpdate({
      action: 'route_updated',
      data: { unit_id: existing.unit_id, route_id: routeId },
    });

    res.json({ success: true });
  },
);

// ─── DELETE /routing/:id ────────────────────────────────────

router.delete(
  '/routing/:id',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const routeId = parseInt(paramStr(req.params.id), 10);
    const existing = db.prepare('SELECT unit_id FROM dispatch_routes WHERE id = ?').get(routeId) as
      | { unit_id: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }

    db.prepare('DELETE FROM dispatch_routes WHERE id = ?').run(routeId);

    broadcastDispatchUpdate({
      action: 'route_deleted',
      data: { unit_id: existing.unit_id, route_id: routeId },
    });

    res.json({ success: true });
  },
);

// ─── POST /routing/:id/complete-stop ────────────────────────
// Mark a waypoint stop as completed in the route.

router.post(
  '/routing/:id/complete-stop',
  requireRole('admin', 'manager', 'dispatcher', 'supervisor', 'officer'),
  (req: Request, res: Response) => {
    const db = getDb();
    const routeId = parseInt(paramStr(req.params.id), 10);
    const { call_id } = req.body;

    if (!call_id) {
      res.status(400).json({ error: 'call_id is required' });
      return;
    }

    const route = db.prepare('SELECT id, unit_id, waypoints_json FROM dispatch_routes WHERE id = ?').get(routeId) as
      | { id: number; unit_id: string; waypoints_json: string }
      | undefined;

    if (!route) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }

    // Update the waypoint's completed status in the JSON
    try {
      const waypoints = JSON.parse(route.waypoints_json);
      const wp = waypoints.find((w: any) => w.call_id === call_id);
      if (wp) {
        wp.completed = true;
        wp.completed_at = new Date().toISOString();
      }

      const allComplete = waypoints.every((w: any) => w.completed);

      db.prepare(
        `UPDATE dispatch_routes SET
         waypoints_json = ?,
         status = ?,
         updated_at = datetime('now','localtime')
       WHERE id = ?`,
      ).run(JSON.stringify(waypoints), allComplete ? 'completed' : 'active', routeId);

      broadcastDispatchUpdate({
        action: 'route_stop_completed',
        data: { unit_id: route.unit_id, route_id: routeId, call_id },
      });

      res.json({ success: true, all_complete: allComplete });
    } catch {
      res.status(500).json({ error: 'Failed to parse route waypoints' });
    }
  },
);

export default router;
