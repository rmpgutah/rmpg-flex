// src/utils/footage/markers.ts
// Derive + store FlexCam timeline markers for a footage request:
//   • event tags    — ClearPath camera-triggered driving events (→ classifyDrivingEvent),
//                      i.e. the "camera triggered for a ~20s violation observation" tags;
//   • turn pins      — GPS direction-changes (→ detectTurns), with camera 'hard_turn'
//                      events distinctly flagged (kind='camera_hard_turn').
// Idempotent per request (DELETE + reinsert). Best-effort — never throws. The GPS
// track comes from the gps[] arrays on the window's media objects.
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute } from '../db';
import { getApiConfig, listMedia } from '../clearpathGps';
import { classifyDrivingEvent } from '../drivingEvents';
import { detectTurns, type GpsPoint } from './turns';
import { markerOffsetMs, type OffsetChunk } from './markerOffset';

type DB = D1Database;

let markersReady = false;
export async function ensureMarkersSchema(db: DB): Promise<void> {
  if (markersReady) return;
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, footage_request_id INTEGER NOT NULL,
    ts_ms INTEGER NOT NULL, offset_ms INTEGER, kind TEXT NOT NULL, type TEXT, severity TEXT,
    label TEXT, lat REAL, lng REAL, heading_deg REAL, turn_dir TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_footage_markers_req ON footage_markers(footage_request_id, offset_ms)`);
  markersReady = true;
}

interface DerivedMarker {
  ts: number; kind: string; type: string | null; severity: string | null;
  label: string | null; lat: number | null; lng: number | null; heading: number | null; turnDir: string | null;
}

/** Derive markers for one request from ClearPath events + GPS track and replace any
 *  existing markers for that request. Returns the count. Never throws. */
export async function buildFootageMarkers(env: Bindings, requestId: number): Promise<number> {
  const db = getDb(env);
  await ensureMarkersSchema(db);
  const req = await queryFirst<{ id: number; asset_id: number; from_ts: number; to_ts: number }>(
    db, 'SELECT id, asset_id, from_ts, to_ts FROM footage_requests WHERE id=?', requestId).catch(() => null);
  if (!req) return 0;
  const chunks = await query<OffsetChunk>(db,
    'SELECT seq, from_ts, to_ts, status FROM footage_chunks WHERE request_id=? ORDER BY seq', requestId).catch(() => []);

  const client = await getApiConfig(db, env).catch(() => null);
  const markers: DerivedMarker[] = [];
  const track: GpsPoint[] = [];
  const hardTurnTimes: number[] = [];

  if (client) {
    const page = await listMedia(env, client, req.asset_id, req.from_ts, req.to_ts, 0, 50).catch(() => null);
    for (const ev of page?.items ?? []) {
      for (const mo of ev.mediaObject) {
        for (const g of mo.gps ?? []) {
          if (Number.isFinite(g.latitude) && Number.isFinite(g.longitude) && g.timestamp) {
            track.push({ lat: g.latitude, lng: g.longitude, ts: g.timestamp });
          }
        }
        const cls = classifyDrivingEvent(mo.eventType);
        if (mo.eventType && cls.type !== 'custom') {
          const ts = ev.eventTimestamp || mo.lastUpdate || req.from_ts;
          markers.push({ ts, kind: 'event', type: cls.type, severity: cls.severity, label: mo.eventType,
            lat: mo.location?.lat ?? null, lng: mo.location?.lng ?? null, heading: null, turnDir: null });
          if (cls.type === 'hard_turn') hardTurnTimes.push(ts);
        }
      }
    }
  }

  // Turn pins from the GPS track; flag ones near a camera hard-turn event (±3s).
  for (const t of detectTurns(track)) {
    const camera = hardTurnTimes.some((h) => Math.abs(h - t.ts) <= 3000);
    markers.push({ ts: t.ts, kind: camera ? 'camera_hard_turn' : 'gps_turn', type: 'turn',
      severity: camera ? 'warning' : 'info', label: `${t.turnDir} turn`, lat: null, lng: null,
      heading: t.headingDeg, turnDir: t.turnDir });
  }

  await execute(db, 'DELETE FROM footage_markers WHERE footage_request_id=?', requestId).catch(() => {});
  for (const m of markers) {
    const offset = markerOffsetMs(m.ts, chunks);
    await execute(db, `INSERT INTO footage_markers
      (footage_request_id, ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      requestId, m.ts, offset, m.kind, m.type, m.severity, m.label, m.lat, m.lng, m.heading, m.turnDir).catch(() => {});
  }
  return markers.length;
}
