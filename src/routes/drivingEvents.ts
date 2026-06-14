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
import { getApiConfig, listMedia, type CpgMediaObject } from '../utils/clearpathGps';

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

// ── Plate re-identification — prior sightings of a plate across all sources ──
// Routed under /api/driving-events (rewrite-proxied) to dodge the legacy
// fall-through; defined BEFORE /:id so 'plate-history' isn't read as an id.
drivingEvents.get('/plate-history', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const plate = (c.req.query('plate') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{2,8}$/.test(plate)) return c.json({ plate, count: 0, sightings: [] });
  try {
    const rows = await query<any>(db, `
      SELECT id, plate, state, location_text, lat, lng, notes, confidence, created_at
      FROM vehicle_sightings WHERE UPPER(REPLACE(REPLACE(plate,' ',''),'-','')) = ?
      ORDER BY created_at DESC LIMIT 20`, plate);
    const total = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM vehicle_sightings WHERE UPPER(REPLACE(REPLACE(plate,' ',''),'-','')) = ?`, plate);
    // distinct days seen (frequency signal)
    const days = new Set(rows.map((r) => String(r.created_at || '').slice(0, 10))).size;
    return c.json({
      plate, count: total?.n ?? rows.length, distinct_days: days,
      sightings: rows.map((r) => ({
        id: r.id, location: r.location_text, lat: r.lat, lng: r.lng,
        source: /dashcam/i.test(r.notes || '') ? 'dashcam' : /alpr/i.test(r.notes || '') ? 'field' : 'manual',
        confidence: r.confidence, created_at: r.created_at,
      })),
    });
  } catch (err: any) {
    return c.json({ plate, count: 0, sightings: [], error: err?.message }, 200);
  }
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

// ── On-demand video + telemetry ──────────────────────────────
// Dashcam clips are NEVER bulk-downloaded. We resolve a fresh pre-signed S3 url
// (and the 1Hz GPS+speed track) from ClearPath only when a clip is requested,
// cache it in KV for < its expiry, and stream it through the Worker (the S3 url
// is CORS-blocked in-browser, fine server-side). `/:id/stream` then proxies the
// bytes with Range passthrough so the player can seek without buffering it all.

const isOutsideObj = (m: CpgMediaObject) => {
  const ch = (m.channel || 'outside').toLowerCase();
  return ch !== 'inside' && ch !== 'interior' && ch !== 'cabin';
};

interface ResolvedMedia {
  accessUrl: string | null;            // fresh pre-signed mp4 url (server-side only)
  gps: Array<{ latitude: number; longitude: number; speed: number; altitude: number; timestamp: number }>;
  durationSec: number | null;
  address: string | null;
}

/** Resolve (and KV-cache for 30 min) the fresh video url + GPS track for an
 *  event. The pre-signed url lives ~1h; we cache under it so a video's many
 *  Range requests don't each hit the ClearPath API. */
async function resolveEventMedia(env: Env['Bindings'], db: D1Database, eventId: number): Promise<{ media: ResolvedMedia; event: any } | null> {
  const ev = await queryFirst<any>(db,
    'SELECT id, cpg_device_id, cpg_media_timestamp, event_type, event_timestamp, address, latitude, longitude FROM dashcam_events WHERE id = ?', eventId);
  if (!ev || ev.cpg_media_timestamp == null) return null;

  const cacheKey = `cpg:video:${eventId}`;
  try {
    const cached = await env.KV.get(cacheKey, 'json') as ResolvedMedia | null;
    if (cached) return { media: cached, event: ev };
  } catch { /* KV optional */ }

  const map = await queryFirst<{ cpg_camera_id: number | null }>(db,
    'SELECT cpg_camera_id FROM cpg_device_mappings WHERE cpg_device_id = ? LIMIT 1', ev.cpg_device_id);
  const assetId = Number(map?.cpg_camera_id);
  if (!Number.isFinite(assetId)) return null;
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return null;

  const ts = Number(ev.cpg_media_timestamp);
  const resp = await listMedia(env, client, assetId, ts - 120_000, ts + 120_000, 0, 50);
  const item = resp.items.find((i) => i.eventTimestamp === ts) || resp.items[0];
  if (!item) return null;
  const vid = (item.mediaObject || []).find((m) => m.type === 'VIDEO' && isOutsideObj(m) && !!m.accessUrl);
  const anyGps = vid || (item.mediaObject || []).find((m) => isOutsideObj(m) && (m.gps?.length));
  const media: ResolvedMedia = {
    accessUrl: vid?.accessUrl || null,
    gps: (anyGps?.gps as ResolvedMedia['gps']) || [],
    durationSec: (vid?.durationSec as number | null) ?? null,
    address: item.address || ev.address || null,
  };
  try { await env.KV.put(cacheKey, JSON.stringify(media), { expirationTtl: 1800 }); } catch { /* */ }
  return { media, event: ev };
}

// Telemetry JSON for the forensic overlay (GPS track + plate + metadata).
drivingEvents.get('/:id/media', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  let resolved: Awaited<ReturnType<typeof resolveEventMedia>> = null;
  try { resolved = await resolveEventMedia(c.env, db, id); }
  catch (err) { return c.json({ error: (err as Error)?.message || 'resolve failed', has_video: false }, 200); }
  if (!resolved) return c.json({ has_video: false, gps: [], error: 'No media for this event' }, 200);
  const { media, event } = resolved;
  // The persisted ALPR still + plate + vehicle attributes (from the still scan).
  const cap = await queryFirst<{
    image_key: string | null; plate: string | null; confidence: number | null;
    state: string | null; make: string | null; model: string | null; color: string | null;
    year: number | null; raw_json: string | null;
  }>(db,
    "SELECT image_key, plate, confidence, state, make, model, color, year, raw_json FROM alpr_captures WHERE capture_id = ? LIMIT 1",
    `cpg_dashcam:${event.cpg_device_id}:${event.cpg_media_timestamp}`).catch(() => null);
  // Null out the model's "not visible / unknown" non-answers so the tag stays clean.
  const cleanAttr = (s: string | null): string | null => {
    if (!s) return null;
    const t = s.trim().toLowerCase();
    return ['', 'not visible', 'notvisible', 'unknown', 'n/a', 'na', 'none', 'not legible', 'unreadable', 'obscured'].includes(t) ? null : s;
  };
  // Any detection geometry the engine recorded (Roboflow path); [] for plate-only reads.
  let detections: unknown[] = [];
  try { const raw = cap?.raw_json ? JSON.parse(cap.raw_json) : null;
    detections = Array.isArray(raw?.detections) ? raw.detections : Array.isArray(raw?.predictions) ? raw.predictions : []; } catch { /* */ }
  return c.json({
    id, has_video: !!media.accessUrl,
    stream_url: media.accessUrl ? `/api/driving-events/${id}/stream` : null,
    duration_sec: media.durationSec,
    gps: media.gps,
    address: media.address,
    event_type: event.event_type,
    event_timestamp: event.event_timestamp,
    still_url: cap?.image_key ? `/api/alpr/image/${cap.image_key}` : null,
    plate: cap?.plate ?? null,
    plate_confidence: cap?.confidence ?? null,
    vehicle: cap ? { state: cleanAttr(cap.state), make: cleanAttr(cap.make), model: cleanAttr(cap.model), color: cleanAttr(cap.color), year: cap.year } : null,
    detections,
  });
});

// Stream the mp4 on-demand (Range passthrough; nothing is stored).
drivingEvents.get('/:id/stream', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  let resolved: Awaited<ReturnType<typeof resolveEventMedia>> = null;
  try { resolved = await resolveEventMedia(c.env, db, id); } catch { resolved = null; }
  const accessUrl = resolved?.media.accessUrl;
  if (!accessUrl) return c.json({ error: 'Clip not available' }, 404);

  const range = c.req.header('Range');
  const upstream = await fetch(accessUrl, {
    headers: range ? { Range: range } : {},
    signal: AbortSignal.timeout(120_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    // Stale pre-signed url? drop the cache so the next play re-resolves.
    try { await c.env.KV.delete(`cpg:video:${id}`); } catch { /* */ }
    return c.json({ error: `Upstream ${upstream.status}` }, 502);
  }
  // ClearPath stores the clip as application/octet-stream; <video> needs a real
  // video type to play it. These are always mp4 dashcam clips.
  const upType = upstream.headers.get('content-type') || '';
  const headers = new Headers({
    'Content-Type': /video\//i.test(upType) ? upType : 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  });
  const cr = upstream.headers.get('content-range'); if (cr) headers.set('Content-Range', cr);
  const cl = upstream.headers.get('content-length'); if (cl) headers.set('Content-Length', cl);
  return new Response(upstream.body, { status: upstream.status, headers });
});

export default drivingEvents;
