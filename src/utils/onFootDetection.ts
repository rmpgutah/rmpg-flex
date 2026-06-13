// ============================================================
// RMPG Flex — on-foot detection engine (pure functions)
// ============================================================
// Classifies iOS CoreMotion activity attached to GPS breadcrumbs and
// debounces state transitions so a stoplight (stationary) or a single
// noisy ping never flips a unit. The stateful runner that applies
// transitions to D1 lives in this file too (runOnFootTransition) but
// only the pure functions are unit-tested.
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { haversineM } from './tripTelemetry';

export type FootState = 'on_foot' | 'in_vehicle' | 'unknown';
export type Transition = 'ON_FOOT' | 'BACK_IN_VEHICLE';

export interface ActivityPoint {
  activity?: string | null;
  activity_confidence?: string | null;
}

/** Points required in the SAME state before a transition fires (~20 s at
 *  the apps' ping cadence). */
export const DEBOUNCE_POINTS = 2;

export function classifyActivity(p: ActivityPoint): FootState {
  const conf = (p.activity_confidence || '').toLowerCase();
  if (conf !== 'medium' && conf !== 'high') return 'unknown';
  const a = (p.activity || '').toLowerCase();
  if (a === 'walking' || a === 'running') return 'on_foot';
  if (a === 'automotive') return 'in_vehicle';
  return 'unknown'; // stationary (could be standing OR stopped car), cycling, unknown
}

/**
 * Debounced transition decision. `recent` = the most recent points,
 * chronological order not required (every one must agree anyway).
 */
export function detectTransition(prev: 'on_foot' | 'in_vehicle', recent: ActivityPoint[]): Transition | null {
  if (recent.length < DEBOUNCE_POINTS) return null;
  const states = recent.slice(-DEBOUNCE_POINTS).map(classifyActivity);
  if (states.every((s) => s === 'on_foot') && prev !== 'on_foot') return 'ON_FOOT';
  if (states.every((s) => s === 'in_vehicle') && prev !== 'in_vehicle') return 'BACK_IN_VEHICLE';
  return null;
}

// ── Stateful runner (called from the gps ingest, best-effort) ──
interface RunArgs {
  unitId: number;
  officerId: number;
  callSign: string | null;
  prevOnFoot: boolean;
  lastLat: number;
  lastLng: number;
  source: string | null;
}

/**
 * Reads the last DEBOUNCE_POINTS breadcrumbs' activity for the unit,
 * decides a transition, and applies it: units flags + foot_segments
 * open/close. Returns the transition applied (or null).
 */
export async function runOnFootTransition(db: D1Database, a: RunArgs): Promise<Transition | null> {
  const recent = await query<ActivityPoint>(db,
    `SELECT activity, activity_confidence FROM gps_breadcrumbs
     WHERE unit_id = ? AND activity IS NOT NULL ORDER BY id DESC LIMIT ?`,
    a.unitId, DEBOUNCE_POINTS);
  // query returns newest-first; detectTransition only needs agreement.
  const t = detectTransition(a.prevOnFoot ? 'on_foot' : 'in_vehicle', recent);
  if (!t) return null;

  if (t === 'ON_FOOT') {
    await execute(db,
      `UPDATE units SET on_foot = 1, on_foot_since = datetime('now'),
         on_foot_source = ?, on_foot_alerted = 0, updated_at = datetime('now') WHERE id = ?`,
      a.source ?? 'coremotion', a.unitId);
    await execute(db,
      `INSERT INTO foot_segments (officer_id, unit_id, call_sign, start_lat, start_lng)
       VALUES (?, ?, ?, ?, ?)`,
      a.officerId, a.unitId, a.callSign, a.lastLat, a.lastLng);
    return t;
  }

  // BACK_IN_VEHICLE — close the open segment, clear the unit flags.
  const open = await queryFirst<{ id: number; started_at: string; start_lat: number | null; start_lng: number | null }>(db,
    `SELECT id, started_at, start_lat, start_lng FROM foot_segments
     WHERE unit_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`, a.unitId);
  if (open) {
    const peak = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM gps_breadcrumbs
       WHERE unit_id = ? AND activity = 'running' AND recorded_at >= ?`,
      a.unitId, open.started_at);
    const dist = (open.start_lat != null && open.start_lng != null)
      ? haversineM(open.start_lat, open.start_lng, a.lastLat, a.lastLng) : null;
    await execute(db,
      `UPDATE foot_segments SET ended_at = datetime('now'), end_lat = ?, end_lng = ?,
         duration_s = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400 AS INTEGER),
         distance_m = ?, peak_activity = ? WHERE id = ?`,
      a.lastLat, a.lastLng, dist, (peak?.n ?? 0) > 0 ? 'running' : 'walking', open.id);
  }
  await execute(db,
    `UPDATE units SET on_foot = 0, on_foot_since = NULL, updated_at = datetime('now') WHERE id = ?`,
    a.unitId);
  return t;
}
