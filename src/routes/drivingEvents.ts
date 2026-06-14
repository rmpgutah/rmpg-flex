// ============================================================
// RMPG Flex — Driving Events API (powers the Dashcam AI Console)
// ============================================================
// The console (client/src/pages/DashcamAiPage.tsx) was shipped without a
// backend. This route normalizes the live ClearPath dashcam feed —
// `dashcam_events` (AI events: FCW / lane-departure / close-following) joined
// to `units`/`users` and to the matching `alpr_captures` still — into the
// console's `DrivingEvent` shape, plus a fleet-health view from the active
// device mappings. Source-agnostic by design: a future flex_ai edge feed can
// UNION in here without touching the UI.
// ============================================================

import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { classifyDrivingEvent, fleetStatusFor } from '../utils/drivingEvents';

const drivingEvents = new Hono<Env>();

const ALPR_PREFIX = 'alpr-captures/';
const FIELD_PHOTO_PREFIX = 'field-photos/';
function imageUrlFor(key: string | null): string | null {
  if (!key) return null;
  if (key.startsWith(FIELD_PHOTO_PREFIX)) return `/api/field-photos/file/${key}`;
  return `/api/alpr/image/${key}`;
}

function tsMs(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
}

interface RawEventRow {
  id: number; cpg_device_id: string | null; unit_id: number | null;
  event_type: string | null; event_timestamp: string | null; cpg_media_timestamp: number | null;
  latitude: number | null; longitude: number | null; speed_mph: number | null;
  address: string | null; video_available: number | null; created_at: string | null;
  call_sign: string | null; unit_status: string | null; officer_id: number | null;
  officer_name: string | null; badge_number: string | null;
  image_key: string | null; plate: string | null; alpr_conf: number | null;
}

/** Shape one joined dashcam_events row into the console's DrivingEvent. */
function shapeEvent(r: RawEventRow) {
  const { type, severity } = classifyDrivingEvent(r.event_type);
  const hasImage = !!r.image_key;
  return {
    id: r.id,
    source: 'clearpathgps' as const,
    source_event_id: r.cpg_media_timestamp != null ? String(r.cpg_media_timestamp) : null,
    device_id: r.cpg_device_id,
    unit_id: r.unit_id,
    officer_id: r.officer_id ?? null,
    event_type: type,
    raw_event_type: r.event_type,                 // original label (badge tooltip)
    severity,
    event_timestamp: r.event_timestamp,
    latitude: r.latitude,
    longitude: r.longitude,
    heading: null,
    speed_mph: r.speed_mph,
    address: r.address,
    call_id: null,
    incident_id: null,
    beat_code: null,
    has_video: r.video_available ? 1 : hasImage ? 1 : 0,
    video_url: null,
    clip_object_key: r.image_key,
    still_image_url: imageUrlFor(r.image_key),     // ALPR still (gallery/detail thumb)
    plate: r.plate ?? null,
    duration_sec: null,
    model_version: hasImage ? 'clearpath-ai / workers-ai-alpr' : 'clearpath-ai',
    confidence: r.alpr_conf,
    created_at: r.created_at,
    call_sign: r.call_sign,
    unit_status: r.unit_status,
    officer_name: r.officer_name,
    badge_number: r.badge_number ?? null,
    call_number: null,
  };
}

const SELECT_EVENTS = `
  SELECT e.id, e.cpg_device_id, e.unit_id, e.event_type, e.event_timestamp, e.cpg_media_timestamp,
         e.latitude, e.longitude, e.speed_mph, e.address, e.video_available, e.created_at,
         u.call_sign, u.status AS unit_status, u.officer_id,
         ofc.full_name AS officer_name, ofc.badge_number,
         ac.image_key, ac.plate, ac.confidence AS alpr_conf
  FROM dashcam_events e
  LEFT JOIN units u ON u.id = e.unit_id
  LEFT JOIN users ofc ON ofc.id = u.officer_id
  LEFT JOIN alpr_captures ac ON ac.capture_id = 'cpg_dashcam:' || e.cpg_device_id || ':' || e.cpg_media_timestamp
`;

/** Robust read: the rich join can fail if units/users columns vary on live —
 *  fall back to a join-free read so the console never goes blank. */
async function readEvents(db: D1Database): Promise<RawEventRow[]> {
  try {
    return await query<RawEventRow>(db, `${SELECT_EVENTS} ORDER BY e.event_timestamp DESC LIMIT 600`);
  } catch {
    try {
      const rows = await query<any>(db, `
        SELECT id, cpg_device_id, unit_id, event_type, event_timestamp, cpg_media_timestamp,
               latitude, longitude, speed_mph, address, video_available, created_at
        FROM dashcam_events ORDER BY event_timestamp DESC LIMIT 600`);
      return rows.map((r) => ({ ...r, call_sign: null, unit_status: null, officer_id: null,
        officer_name: null, badge_number: null, image_key: null, plate: null, alpr_conf: null }));
    } catch { return []; }
  }
}

// ── List ─────────────────────────────────────────────────────
drivingEvents.get('/', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const source = (c.req.query('source') || '').toLowerCase();
  const severity = (c.req.query('severity') || '').toLowerCase();
  const eventType = (c.req.query('event_type') || '').toLowerCase();
  const hasVideo = c.req.query('has_video');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '200', 10), 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  let rows = (await readEvents(db)).map(shapeEvent);
  if (source) rows = rows.filter((r) => r.source === source);
  if (severity) rows = rows.filter((r) => r.severity === severity);
  if (eventType) rows = rows.filter((r) => r.event_type === eventType);
  if (hasVideo === '1') rows = rows.filter((r) => r.has_video === 1);
  else if (hasVideo === '0') rows = rows.filter((r) => r.has_video === 0);

  const total = rows.length;
  const events = rows.slice(offset, offset + limit);
  return c.json({ events, total, limit, offset });
});

// ── Fleet health ─────────────────────────────────────────────
drivingEvents.get('/fleet-health', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const now = Date.now();
  let rows: any[] = [];
  try {
    rows = await query<any>(db, `
      SELECT m.id, m.unit_id, m.cpg_device_id AS device_id, m.cpg_display_name,
             m.last_media_synced_at, m.last_synced_at, m.media_sync_errors,
             u.call_sign, ofc.full_name AS officer_name
      FROM cpg_device_mappings m
      LEFT JOIN units u ON u.id = m.unit_id
      LEFT JOIN users ofc ON ofc.id = u.officer_id
      WHERE m.is_active = 1 ORDER BY m.id`);
  } catch {
    try { rows = await query<any>(db, 'SELECT id, unit_id, cpg_device_id AS device_id, cpg_display_name, last_media_synced_at, last_synced_at, media_sync_errors FROM cpg_device_mappings WHERE is_active = 1'); }
    catch { rows = []; }
  }
  const units = rows.map((r) => {
    const lastSeen = tsMs(r.last_media_synced_at) ?? tsMs(r.last_synced_at);
    return {
      id: r.id, unit_id: r.unit_id, device_id: r.device_id,
      device_kind: 'clearpathgps_dashcam',
      last_heartbeat_at: r.last_media_synced_at || r.last_synced_at || null,
      firmware_version: null, model_version: 'clearpath-ai',
      gpu_temp_c: null, cpu_temp_c: null, disk_used_pct: null, ram_used_pct: null,
      network_status: (r.media_sync_errors ?? 0) > 0 ? 'degraded' : 'online',
      lte_rssi_dbm: null, uptime_sec: null,
      call_sign: r.call_sign ?? r.cpg_display_name ?? null,
      officer_name: r.officer_name ?? null,
      status: fleetStatusFor(lastSeen, now),
    };
  });
  return c.json({ units });
});

// ── Single event (detail) ────────────────────────────────────
drivingEvents.get('/:id', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  let row: RawEventRow | null = null;
  try { row = await queryFirst<RawEventRow>(db, `${SELECT_EVENTS} WHERE e.id = ? LIMIT 1`, id); }
  catch {
    row = await queryFirst<any>(db, 'SELECT id, cpg_device_id, unit_id, event_type, event_timestamp, cpg_media_timestamp, latitude, longitude, speed_mph, address, video_available, created_at FROM dashcam_events WHERE id = ?', id)
      .then((r) => r ? { ...r, call_sign: null, unit_status: null, officer_id: null, officer_name: null, badge_number: null, image_key: null, plate: null, alpr_conf: null } : null)
      .catch(() => null);
  }
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(shapeEvent(row));
});

export default drivingEvents;
