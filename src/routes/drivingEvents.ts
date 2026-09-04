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
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { getR2Range, rangeNotSatisfiableInit } from '../utils/byteRange';
import { classifyDrivingEvent, fleetStatusFor } from '../utils/drivingEvents';
import { getApiConfig, listMediaForAsset, type CpgMediaObject } from '../utils/clearpathGps';
import { recordAudit } from '../utils/auditLog';
import { verifySignedResource } from '../utils/signedAccess';
import { log } from '../utils/logger';

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
  const limit = clampIntParam(c.req.query('limit'), 200, 1, 500);
  const offset = clampIntParam(c.req.query('offset'), 0, 0, 1000000);

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
  } catch (err) {
    return c.json({ plate, count: 0, sightings: [], error: err instanceof Error ? err.message : String(err) }, 200);
  }
});

// Chain-of-custody audit write for forensic actions (view/export/rescan).
// Lives here (operational-gated) rather than under /api/audit (admin/manager only).
drivingEvents.post('/audit-log', async (c: Context<Env>): Promise<Response> => {
  const db = getDb(c.env);
  let body: { action?: string; event_id?: number; details?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false }, 200); }
  const action = (body.action || 'forensic_access').toString().slice(0, 64);
  const userId = Number((c.get('user') as any)?.id) || (c.get('userId') as number) || null;
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  await recordAudit(c, { action, entityType: 'dashcam_event', entityId: body.event_id ?? null, details: (body.details || '').toString().slice(0, 500), actorId: userId });
  return c.json({ ok: true });
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

// ── R2 clip storage ───────────────────────────────────────────
// Videos are always persisted to R2 on first play so they remain available
// after ClearPath's pre-signed URLs expire. Full-drive chunks (continuous
// dashcam footage already in R2) are preferred over the short AI-event clip.

let dashcamSchemaReady = false;
async function ensureDashcamClipColumn(db: D1Database): Promise<void> {
  if (dashcamSchemaReady) return;
  await execute(db, 'ALTER TABLE dashcam_events ADD COLUMN clip_r2_key TEXT').catch(() => {});
  dashcamSchemaReady = true;
}

/** Find a downloaded full-drive footage chunk whose window covers the event timestamp. */
async function findFullDriveChunk(
  db: D1Database, deviceId: string | null, eventTsMs: number,
): Promise<{ r2_key: string; request_id: number } | null> {
  if (!deviceId) return null;
  return queryFirst<{ r2_key: string; request_id: number }>(db, `
    SELECT fc.r2_key, fc.request_id
    FROM footage_chunks fc
    JOIN footage_requests fr ON fr.id = fc.request_id
    WHERE fr.cpg_device_id = ?
      AND fc.channel = 'outside'
      AND fc.from_ts <= ? AND fc.to_ts >= ?
      AND fc.status = 'downloaded'
      AND fc.r2_key IS NOT NULL
    ORDER BY ABS(? - (fc.from_ts + fc.to_ts) / 2) ASC
    LIMIT 1`,
    deviceId, eventTsMs, eventTsMs, eventTsMs,
  ).catch(() => null);
}

/** Download a ClearPath clip URL to R2 and persist the key on the event row. */
async function downloadClipToR2(
  env: Env['Bindings'], accessUrl: string, r2Key: string, eventId: number,
): Promise<void> {
  const resp = await fetch(accessUrl, { signal: AbortSignal.timeout(300_000) });
  if (!resp.ok || !resp.body) return;
  await env.UPLOADS.put(r2Key, resp.body, { httpMetadata: { contentType: 'video/mp4' } });
  await execute(getDb(env), 'UPDATE dashcam_events SET clip_r2_key=? WHERE id=?', r2Key, eventId);
  await env.KV.delete(`cpg:video:${eventId}`).catch(() => {});
}

function parseEventRange(header: string): { offset: number; length?: number } | null {
  const m = /bytes=(\d+)-(\d*)/.exec(header);
  if (!m) return null;
  const offset = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : undefined;
  return end !== undefined ? { offset, length: end - offset + 1 } : { offset };
}

/** Serve a clip from R2 with Range-request support. */
async function serveR2Clip(env: Env['Bindings'], r2Key: string, rangeHeader: string | undefined): Promise<Response> {
  const parsed = rangeHeader ? parseEventRange(rangeHeader) : null;
  // getR2Range() instead of a bare get(): R2 THROWS on an unsatisfiable range
  // (start > end, or start past EOF). serveR2Clip has no try/catch of its own,
  // so that throw reached the global onError as a 500 on a client error.
  const got = await getR2Range(env.UPLOADS, r2Key, parsed ?? undefined);
  if (got.kind === 'missing') return new Response('Not found', { status: 404 });
  if (got.kind === 'unsatisfiable') {
    const init = rangeNotSatisfiableInit(got.total);
    return new Response(JSON.stringify(init.body), {
      status: init.status,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  }
  const obj = got.obj;
  const status = rangeHeader ? 206 : 200;
  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
  if (obj.size) headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status, headers });
}

const isOutsideObj = (m: CpgMediaObject) => {
  const ch = (m.channel || 'outside').toLowerCase();
  return ch !== 'inside' && ch !== 'interior' && ch !== 'cabin';
};

interface ResolvedMedia {
  accessUrl: string | null;
  r2Key: string | null;             // R2 key if clip is stored locally
  footageRequestId: number | null;  // full-drive footage_request_id when a chunk covers this event
  gps: Array<{ latitude: number; longitude: number; speed: number; altitude: number; timestamp: number }>;
  durationSec: number | null;
  address: string | null;
}

/** Resolve video + GPS track for an event. Priority:
 *  1. Already saved to R2 (clip_r2_key on dashcam_events)
 *  2. Full-drive chunk covering this timestamp (preferred — full 40s continuous frame)
 *  3. ClearPath live pre-signed URL (fetched on demand, cached 30 min in KV) */
async function resolveEventMedia(env: Env['Bindings'], db: D1Database, eventId: number): Promise<{ media: ResolvedMedia; event: any } | null> {
  const ev = await queryFirst<any>(db,
    'SELECT id, cpg_device_id, cpg_media_timestamp, event_type, event_timestamp, address, latitude, longitude, clip_r2_key FROM dashcam_events WHERE id = ?',
    eventId);
  if (!ev || ev.cpg_media_timestamp == null) return null;

  const eventTsMs = Number(ev.cpg_media_timestamp);

  // 1. Already downloaded to R2.
  if (ev.clip_r2_key) {
    const chunk = await findFullDriveChunk(db, ev.cpg_device_id, eventTsMs);
    return { media: { accessUrl: null, r2Key: ev.clip_r2_key, footageRequestId: chunk?.request_id ?? null, gps: [], durationSec: null, address: ev.address }, event: ev };
  }

  // 2. Full-drive chunk in R2 covering this timestamp (full continuous frame, no expiry).
  const chunk = await findFullDriveChunk(db, ev.cpg_device_id, eventTsMs);
  if (chunk) {
    return { media: { accessUrl: null, r2Key: chunk.r2_key, footageRequestId: chunk.request_id, gps: [], durationSec: null, address: ev.address }, event: ev };
  }

  // 3. ClearPath live URL — resolve and KV-cache.
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

  const resp = await listMediaForAsset(env, client, assetId, eventTsMs - 120_000, eventTsMs + 120_000, 0, 50);
  const item = resp.items.find((i) => i.eventTimestamp === eventTsMs) || resp.items[0];
  if (!item) return null;
  const vid = (item.mediaObject || []).find((m) => m.type === 'VIDEO' && isOutsideObj(m) && !!m.accessUrl);
  const anyGps = vid || (item.mediaObject || []).find((m) => isOutsideObj(m) && (m.gps?.length));
  const media: ResolvedMedia = {
    accessUrl: vid?.accessUrl || null,
    r2Key: null,
    footageRequestId: null,
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
  await ensureDashcamClipColumn(db);
  const id = Number(c.req.param('id'));
  let resolved: Awaited<ReturnType<typeof resolveEventMedia>> = null;
  try { resolved = await resolveEventMedia(c.env, db, id); }
  catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) || 'resolve failed', has_video: false }, 200); }
  if (!resolved) return c.json({ has_video: false, gps: [], error: 'No media for this event' }, 200);
  const { media, event } = resolved;
  // The persisted ALPR still + plate + vehicle attributes (from the still scan).
  const cap = await queryFirst<{
    image_key: string | null; plate: string | null; confidence: number | null;
    state: string | null; make: string | null; model: string | null; color: string | null;
    year: number | null; raw_json: string | null;
    accepted: number | null; review_status: string | null;
  }>(db,
    "SELECT image_key, plate, confidence, state, make, model, color, year, raw_json, accepted, review_status FROM alpr_captures WHERE capture_id = ? LIMIT 1",
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
  const hasVideo = !!(media.r2Key || media.accessUrl);
  return c.json({
    id, has_video: hasVideo,
    stream_url: hasVideo ? `/api/driving-events/${id}/stream` : null,
    footage_request_id: media.footageRequestId,   // non-null = full-drive trip in FlexCam
    duration_sec: media.durationSec,
    gps: media.gps,
    address: media.address,
    event_type: event.event_type,
    event_timestamp: event.event_timestamp,
    still_url: cap?.image_key ? `/api/alpr/image/${cap.image_key}` : null,
    plate: cap?.plate ?? null,
    plate_confidence: cap?.confidence ?? null,   // DERIVED trust (not the model self-report) since the clearpathAlpr fix
    // Honesty signals so the overlay never presents an unconfirmed read as a positive ID.
    plate_accepted: cap ? (cap.accepted === 1) : null,
    plate_review_status: cap?.review_status ?? null,   // 'accepted' | 'confirmed' | 'needs_review' | 'no_plate'
    vehicle: cap ? { state: cleanAttr(cap.state), make: cleanAttr(cap.make), model: cleanAttr(cap.model), color: cleanAttr(cap.color), year: cap.year } : null,
    detections,
  });
});

// Stream the mp4. Serves from R2 when available; proxies ClearPath on first
// access and downloads to R2 in the background so subsequent plays are instant.
drivingEvents.get('/:id/stream', async (c: Context<Env>): Promise<Response> => {
  // Auth: this path ends in `/stream`, so authMiddleware forwards header-less
  // GETs carrying sig+exp WITHOUT verifying them (a <video> tag can't send an
  // Authorization header). Verification is therefore this handler's job — and
  // until it was added, the whole dashcam archive was readable unauthenticated
  // by anyone passing `?sig=x&exp=1`, with sequential ids to enumerate.
  // A plain JWT (header, cookie, or the media ?token= fallback) also works,
  // since authMiddleware sets `user` in that case.
  const idStr = c.req.param('id') ?? '';
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) {
    const ok = await verifySignedResource(c.env.JWT_SECRET, 'driving-event', idStr, {
      sig: c.req.query('sig'), exp: c.req.query('exp'), nonce: c.req.query('nonce'),
    });
    if (!ok) return c.json({ error: 'Authentication required' }, 401);
  }

  const db = getDb(c.env);
  await ensureDashcamClipColumn(db);
  const id = Number(idStr);
  let resolved: Awaited<ReturnType<typeof resolveEventMedia>> = null;
  try { resolved = await resolveEventMedia(c.env, db, id); } catch { resolved = null; }

  // R2-stored clip (full-drive chunk or previously downloaded event clip) — serve directly.
  if (resolved?.media.r2Key) {
    return serveR2Clip(c.env, resolved.media.r2Key, c.req.header('Range'));
  }

  const accessUrl = resolved?.media.accessUrl;
  if (!accessUrl) return c.json({ error: 'Clip not available' }, 404);

  // First play: proxy from ClearPath and save to R2 in background.
  const ev = resolved?.event;
  if (ev?.cpg_device_id && ev?.cpg_media_timestamp) {
    const r2Key = `flexcam/events/${ev.cpg_device_id}/${ev.cpg_media_timestamp}.mp4`;
    try {
      c.executionCtx.waitUntil(
        downloadClipToR2(c.env, accessUrl, r2Key, id).catch((err) => {
          // Surface the failure in `wrangler tail` instead of silently dropping —
          // R2 quota, ClearPath URL expiry, and D1 schema drift on clip_r2_key
          // all manifest here and have no other observability.
          log.error('drivingEvents downloadClipToR2 failed', {
            eventId: id, r2Key, error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    } catch { /* executionCtx unavailable in tests */ }
  }

  const range = c.req.header('Range');
  const upstream = await fetch(accessUrl, {
    headers: range ? { Range: range } : {},
    signal: AbortSignal.timeout(120_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    try { await c.env.KV.delete(`cpg:video:${id}`); } catch { /* */ }
    return c.json({ error: `Upstream ${upstream.status}` }, 502);
  }
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
