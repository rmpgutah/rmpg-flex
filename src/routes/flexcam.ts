// src/routes/flexcam.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { ensureFootageSchema, enqueueFootage } from '../utils/footage/captureOrchestrator';
import { notConfigured } from '../utils/notConfigured';
import { getClearPathSource } from '../utils/footage/clearpathSource';
import { getApiConfig, getCredentials, listDevices, listMediaForAsset } from '../utils/clearpathGps';
import { ensureMarkersSchema, buildFootageMarkers } from '../utils/footage/markers';
import { buildManifest, concatToR2, buildPlayerManifest } from '../utils/footage/concat';
import { requireRole } from '../middleware/auth';
import { footageEvidenceNumber, isUnlockable, buildCourtManifest, manifestPayloadHash, logCustody, viewSessionKey } from '../utils/footage/evidence';
import { signTriple } from '../utils/pdfSign';
import { runQueueDrain } from '../utils/footage/queueDrainRunner';

const flexcam = new Hono<Env>();

// Display name for chain-of-custody rows. The user var has a typed `full_name`
// (see types.ts Variables.user); fall back to the user id, else null.
const actorName = (c: Context<Env>): string | null =>
  c.var.user?.full_name ?? (c.var.user?.id != null ? String(c.var.user.id) : null);

// ── Evidence schema reconciler ───────────────────────────────
// Idempotent + module-cached. Phase-2 evidence columns/tables routinely fail to
// reach live D1 silently (deploy apply is continue-on-error), so reconcile at
// runtime before any evidence handler touches the schema.
let evidenceSchemaReady = false;
async function ensureEvidenceSchema(db: D1Database): Promise<void> {
  if (evidenceSchemaReady) return;
  const cols: Array<[string, string]> = [
    ['evidence_locked', 'INTEGER DEFAULT 0'], ['evidence_number', 'TEXT'], ['classification', "TEXT DEFAULT 'routine'"],
    ['preserved_reason', 'TEXT'], ['preserved_event_type', 'TEXT'], ['preserved_event_id', 'INTEGER'],
  ];
  for (const [name, type] of cols) {
    try { if (!(await columnExists(db, 'footage_requests', name))) await execute(db, `ALTER TABLE footage_requests ADD COLUMN ${name} ${type}`); } catch { /* */ }
  }
  try { if (!(await columnExists(db, 'footage_chunks', 'sha256'))) await execute(db, `ALTER TABLE footage_chunks ADD COLUMN sha256 TEXT`); } catch { /* */ }
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_custody_log (id INTEGER PRIMARY KEY AUTOINCREMENT, footage_request_id INTEGER NOT NULL, action TEXT NOT NULL, actor_user_id INTEGER, actor_name TEXT, reason TEXT, detail TEXT, session_key TEXT, created_at TEXT DEFAULT (datetime('now')))`).catch(() => {});
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_footage_custody_req ON footage_custody_log(footage_request_id, id)`).catch(() => {});
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_custody_view ON footage_custody_log(footage_request_id, actor_user_id, session_key) WHERE action='viewed'`).catch(() => {});
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_evidence_links (id INTEGER PRIMARY KEY AUTOINCREMENT, footage_request_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, linked_by INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`).catch(() => {});
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_evlink ON footage_evidence_links(footage_request_id, entity_type, entity_id)`).catch(() => {});
  evidenceSchemaReady = true;
}

// Mirrors ensureEvidenceSchema(): tolerates a live D1 that hasn't
// yet had migration 0144 applied. Safe to call repeatedly — every
// ALTER is guarded by columnExists().
async function ensureRemuxSchema(db: D1Database): Promise<void> {
  const adds: Array<[string, string]> = [
    ['remux_state', 'TEXT'],
    ['remux_started_at', 'INTEGER'],
    ['remux_finished_at', 'INTEGER'],
    ['remux_error', 'TEXT'],
    ['remux_attempts', 'INTEGER DEFAULT 0'],
    ['merged_sha256', 'TEXT'],
  ];
  for (const [col, ddl] of adds) {
    const has = await columnExists(db, 'footage_requests', col).catch(() => false);
    if (!has) {
      await db.prepare(`ALTER TABLE footage_requests ADD COLUMN ${col} ${ddl}`)
        .run().catch(() => {});
    }
  }
}

flexcam.get('/status', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureFootageSchema(db);
  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
  const counts = await queryFirst<Record<string, number>>(db,
    `SELECT COUNT(*) AS requests, COALESCE(SUM(bytes),0) AS bytes,
      SUM(CASE WHEN status IN ('queued','fulfilling') THEN 1 ELSE 0 END) AS pending FROM footage_requests`).catch(() => null);
  return c.json({ enabled: enabled?.config_value === 'true', ...(counts ?? { requests: 0, bytes: 0, pending: 0 }) });
});

flexcam.post('/request', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureFootageSchema(db);
  let body: { asset_id?: number; unit_id?: number; from?: number; to?: number; trip_id?: string; call_id?: number; title?: string; channels?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  let assetId = body.asset_id ?? 0;
  let cpgDeviceId: string | null = null;
  if (!assetId && body.unit_id) {
    const m = await queryFirst<{ cpg_camera_id: number | null; cpg_device_id: string }>(db,
      'SELECT cpg_camera_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1', body.unit_id).catch(() => null);
    assetId = m?.cpg_camera_id ?? 0; cpgDeviceId = m?.cpg_device_id ?? null;
  }
  if (!assetId || !body.from || !body.to || body.to <= body.from) return c.json({ error: 'asset_id/unit_id + from < to (epoch ms) required' }, 400);
  const id = await enqueueFootage(c.env, {
    assetId, unitId: body.unit_id ?? null, cpgDeviceId, tripId: body.trip_id ?? null, callId: body.call_id ?? null,
    fromTs: body.from, toTs: body.to, reason: 'on_demand', channels: body.channels, title: body.title ?? null,
    createdBy: c.var.user?.id ?? null,
  });
  if (!id) return c.json({ error: 'FlexCam not configured or request rejected' }, 503);
  return c.json({ success: true, request_id: id });
});

flexcam.get('/footage', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const { trip_id, call_id, unit_id, status } = c.req.query();
  const where: string[] = []; const params: unknown[] = [];
  if (trip_id) { where.push('trip_id=?'); params.push(trip_id); }
  if (call_id) { where.push('call_id=?'); params.push(call_id); }
  if (unit_id) { where.push('unit_id=?'); params.push(unit_id); }
  if (status) { where.push('status=?'); params.push(status); }
  const rows = await query(db, `SELECT * FROM footage_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`, ...params).catch(() => []);
  return c.json({ requests: rows });
});

flexcam.get('/footage/:id', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const req = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!req) return c.json({ error: 'Not found' }, 404);
  const rows = await query<{ seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number }>(
    db, 'SELECT seq, from_ts, to_ts, status, r2_key, bytes FROM footage_chunks WHERE request_id=? ORDER BY seq', id).catch(() => []);
  const manifest = buildManifest(id, rows);
  await ensureMarkersSchema(db);
  const markers = await query(db,
    'SELECT ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir FROM footage_markers WHERE footage_request_id=? ORDER BY offset_ms', id).catch(() => []);
  // `chunks` carries per-chunk from/to so the client player can map a marker's
  // offset → (chunk, seek-within) on the gap-collapsed playable timeline.
  return c.json({ request: req, manifest, markers, chunks: rows });
});

flexcam.get('/footage/:id/chunk/:seq/stream', async (c): Promise<Response> => {
  // Auth: `/stream` matches authMiddleware's media predicate, so a header-less
  // GET with sig+exp reaches this handler unverified. Require a real session —
  // the client fetches chunks via apiFetchBlob (which sends the Authorization
  // header), so there is no bare-<video> case to accommodate here.
  //
  // This also stops logCustody() below from writing a chain-of-custody
  // "viewed" row with actorUserId: null, which recorded anonymous evidence
  // access as a legitimate view instead of refusing it.
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  const db = getDb(c.env);
  const row = await queryFirst<{ r2_key: string | null; content_type: string | null }>(db,
    'SELECT r2_key, content_type FROM footage_chunks WHERE request_id=? AND seq=?', c.req.param('id'), c.req.param('seq')).catch(() => null);
  if (!row?.r2_key) return c.json({ error: 'Chunk not found' }, 404);
  const obj = await c.env.UPLOADS.get(row.r2_key);
  if (!obj) return c.json({ error: 'Object missing' }, 404);
  await logCustody(db, { requestId: Number(c.req.param('id')), action: 'viewed', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), sessionKey: viewSessionKey(c.var.user?.id ?? null, new Date().toISOString()) }); // new-date-ok
  return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600' } });
});

flexcam.get('/footage/:id/continuous', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const req = await queryFirst<{ merged_r2_key: string | null; merged_status: string | null }>(db,
    'SELECT merged_r2_key, merged_status FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!req) return c.json({ error: 'Not found' }, 404);
  if (req.merged_r2_key && req.merged_status === 'ready') {
    const obj = await c.env.UPLOADS.get(req.merged_r2_key);
    if (obj) return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600' } });
  }
  return c.json({ merged_status: req.merged_status ?? 'pending', hint: 'POST /render/:id (or client ffmpeg.wasm for MP4)' }, 202);
});

// Player-oriented trip manifest. Joins unit_trips × footage_chunks
// (via footage_requests.trip_id) and composes buildPlayerManifest()
// so the FlexCam page can scrub a multi-request trip on one timeline.
// Mount-level auth (`/api/flexcam` is `auth: 'required'`) gates access.
flexcam.get('/trips/:tripId/manifest', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const tripId = Number(c.req.param('tripId'));
  if (!Number.isFinite(tripId)) return c.json({ error: 'Invalid tripId' }, 400);
  const channel = c.req.query('channel') ?? 'outside';

  const trip = await queryFirst<{ id: number; start_time: number; end_time: number | null }>(
    db, 'SELECT id, start_time, end_time FROM unit_trips WHERE id = ?', tripId,
  ).catch(() => null);
  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  // Pull every chunk attached to any request whose trip_id matches.
  const chunks = await query<{
    id: number; request_id: number; seq: number; channel: string;
    from_ts: number; to_ts: number; status: string; r2_key: string | null;
    sha256: string | null; bytes: number;
  }>(db,
    `SELECT fc.id, fc.request_id, fc.seq, fc.channel, fc.from_ts, fc.to_ts,
            fc.status, fc.r2_key, fc.sha256, fc.bytes
       FROM footage_chunks fc
       JOIN footage_requests fr ON fr.id = fc.request_id
      WHERE fr.trip_id = ?
      ORDER BY fc.from_ts`, tripId,
  ).catch(() => []);

  const manifest = buildPlayerManifest(
    { id: trip.id, start_time: trip.start_time, end_time: trip.end_time },
    channel,
    chunks,
  );
  return c.json(manifest);
});

flexcam.post('/render/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureRemuxSchema(db);
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ format?: 'mp4' | 'ts' | 'fmp4' }>().catch(() => ({} as { format?: 'mp4' | 'ts' | 'fmp4' }));
  const format = body.format ?? 'mp4';

  const rows = await query<{ seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number }>(
    db, 'SELECT seq, from_ts, to_ts, status, r2_key, bytes FROM footage_chunks WHERE request_id=? ORDER BY seq', id,
  ).catch(() => []);
  const manifest = buildManifest(id, rows);
  if (!manifest.chunks.length) return c.json({ error: 'No downloaded chunks' }, 409);

  if (format === 'mp4') {
    const stub = c.env.FLEXCAM_REMUX.get(c.env.FLEXCAM_REMUX.idFromName('rmx-' + id));
    const resp = await stub.fetch('https://do/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id }),
    });
    const result = await resp.json<{ state: string }>();
    await execute(db, "UPDATE footage_requests SET merged_status='queued' WHERE id=?", id);
    return c.json({ remux_state: result.state, merged_status: 'queued' }, 202);
  }

  // Existing ts / fmp4 path (unchanged)
  const mergedKey = `flexcam/trips/merged/${id}.mp4`;
  const result = await concatToR2(c.env, mergedKey, manifest.chunks, format);
  await execute(db, 'UPDATE footage_requests SET merged_r2_key=?, merged_status=? WHERE id=?', result === 'ready' ? mergedKey : null, result, id);
  return c.json({ merged_status: result, merged_r2_key: result === 'ready' ? mergedKey : null });
});

// ── Evidence endpoints ───────────────────────────────────────

flexcam.post('/footage/:id/lock', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  const row = await queryFirst<{ evidence_number: string | null }>(db, 'SELECT evidence_number FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!row) return c.json({ error: 'Not found' }, 404);
  let evNum = row.evidence_number;
  if (!evNum) {
    const year = Number(new Date().toISOString().slice(0, 4)); // new-date-ok
    const seq = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM footage_requests WHERE evidence_number IS NOT NULL AND substr(evidence_number,1,2)=?", String(year).slice(-2)).catch(() => ({ n: 0 }));
    evNum = footageEvidenceNumber(year, (seq?.n ?? 0) + 1);
  }
  await execute(db, "UPDATE footage_requests SET evidence_locked=1, classification='evidence', evidence_number=COALESCE(evidence_number, ?), updated_at=datetime('now') WHERE id=?", evNum, id);
  await logCustody(db, { requestId: id, action: 'locked', actorUserId: c.var.user?.id ?? null, actorName: actorName(c) });
  return c.json({ success: true, evidence_number: evNum });
});

flexcam.post('/footage/:id/unlock', requireRole('admin'), async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  let body: { reason?: string }; try { body = await c.req.json(); } catch { body = {}; }
  if (!isUnlockable(body.reason)) return c.json({ error: 'A reason is required to unlock evidence' }, 400);
  const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!exists) return c.json({ error: 'Not found' }, 404);
  await execute(db, "UPDATE footage_requests SET evidence_locked=0, updated_at=datetime('now') WHERE id=?", id);
  await logCustody(db, { requestId: id, action: 'unlocked', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), reason: (body.reason as string).trim() });
  return c.json({ success: true });
});

flexcam.get('/footage/:id/custody', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  const req = await queryFirst<Record<string, unknown>>(db, 'SELECT id, evidence_locked, evidence_number, classification, preserved_reason FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!req) return c.json({ error: 'Not found' }, 404);
  const custody = await query(db, 'SELECT action, actor_user_id, actor_name, reason, detail, created_at FROM footage_custody_log WHERE footage_request_id=? ORDER BY id', id).catch(() => []);
  const links = await query(db, 'SELECT entity_type, entity_id, linked_by, notes, created_at FROM footage_evidence_links WHERE footage_request_id=?', id).catch(() => []);
  return c.json({ request: req, custody, links });
});

flexcam.post('/footage/:id/links', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  let body: { entity_type?: string; entity_id?: number; notes?: string }; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const allowed = ['incident', 'call', 'case', 'use_of_force', 'person', 'warrant'];
  if (!body.entity_type || !allowed.includes(body.entity_type) || !body.entity_id) return c.json({ error: 'entity_type (one of ' + allowed.join('|') + ') + entity_id required' }, 400);
  await execute(db, 'INSERT OR IGNORE INTO footage_evidence_links (footage_request_id, entity_type, entity_id, linked_by, notes) VALUES (?, ?, ?, ?, ?)', id, body.entity_type, body.entity_id, c.var.user?.id ?? null, body.notes ?? null);
  await logCustody(db, { requestId: id, action: 'linked', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), detail: { entity_type: body.entity_type, entity_id: body.entity_id } });
  return c.json({ success: true });
});

flexcam.get('/footage/:id/links', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const links = await query(db, 'SELECT entity_type, entity_id, linked_by, notes, created_at FROM footage_evidence_links WHERE footage_request_id=?', Number(c.req.param('id'))).catch(() => []);
  return c.json({ links });
});

flexcam.post('/footage/:id/court-package', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  // Guards the SELECT against schema drift on a live D1 that hasn't had
  // migration 0144 (merged_sha256 + remux_* columns) applied yet.
  await ensureRemuxSchema(db);
  const id = Number(c.req.param('id'));
  const req = await queryFirst<{
    id: number; evidence_number: string | null; classification: string;
    preserved_reason: string | null; from_ts: number; to_ts: number; evidence_locked: number;
    merged_status: string | null; merged_r2_key: string | null; merged_sha256: string | null;
  }>(
    db,
    `SELECT id, evidence_number, classification, preserved_reason, from_ts, to_ts, evidence_locked,
            merged_status, merged_r2_key, merged_sha256
       FROM footage_requests WHERE id=?`, id).catch(() => null);
  if (!req) return c.json({ error: 'Not found' }, 404);
  if (!req.evidence_locked) return c.json({ error: 'Lock this footage as evidence before generating a court package' }, 409);
  const chunks = await query<{ id: number; seq: number; from_ts: number; to_ts: number; bytes: number; sha256: string | null; status: string; r2_key: string | null }>(
    db, 'SELECT id, seq, from_ts, to_ts, bytes, sha256, status, r2_key FROM footage_chunks WHERE request_id=? ORDER BY seq', id).catch(() => []);
  const MAX_HASH_BYTES = 100 * 1024 * 1024; // 100 MB — avoid loading a pathological chunk into the 128 MB isolate
  for (const ch of chunks) {
    if (ch.sha256 || ch.status !== 'downloaded' || !ch.r2_key) continue;
    if (ch.bytes && ch.bytes > MAX_HASH_BYTES) continue; // skip oversized; sha256 stays null
    const obj = await c.env.UPLOADS.get(ch.r2_key); if (!obj) continue;
    const digest = await crypto.subtle.digest('SHA-256', await obj.arrayBuffer());
    ch.sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await execute(db, 'UPDATE footage_chunks SET sha256=? WHERE id=?', ch.sha256, ch.id).catch(() => {});
  }
  const links = await query<{ entity_type: string; entity_id: number }>(db, 'SELECT entity_type, entity_id FROM footage_evidence_links WHERE footage_request_id=?', id).catch(() => []);
  const custody = await query<{ action: string; actor_name: string | null; reason: string | null; created_at: string }>(db, 'SELECT action, actor_name, reason, created_at FROM footage_custody_log WHERE footage_request_id=? ORDER BY id', id).catch(() => []);
  const manifest = buildCourtManifest({ request: req, chunks, links, custody });
  const payloadHash = await manifestPayloadHash(manifest);
  const caseRef = links.find((l) => l.entity_type === 'incident' || l.entity_type === 'case');
  const ctx = (() => { try { return c.executionCtx; } catch { return undefined; } })();
  const signed = await signTriple(c.env, `flexcam:${req.evidence_number ?? id}`, caseRef ? `${caseRef.entity_type}:${caseRef.entity_id}` : '', payloadHash, ctx);
  await logCustody(db, { requestId: id, action: 'exported', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), detail: { payloadHash } });
  return c.json({ manifest, payloadHash, ...signed });
});

// Locked-evidence delete guard: a request flagged as evidence cannot be deleted
// until an admin unlocks it. The blocked attempt is itself recorded to custody.
flexcam.delete('/footage/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  const row = await queryFirst<{ evidence_locked: number }>(db, 'SELECT evidence_locked FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.evidence_locked) {
    await logCustody(db, { requestId: id, action: 'delete_attempt', actorUserId: c.var.user?.id ?? null, actorName: actorName(c) });
    return c.json({ error: 'Locked as evidence — unlock (admin) before deleting' }, 409);
  }
  await execute(db, 'DELETE FROM footage_chunks WHERE request_id=?', id);
  await execute(db, 'DELETE FROM footage_requests WHERE id=?', id);
  return c.json({ success: true });
});

// Drain the stuck queue: bail-out fulfilling/partial requests that haven't
// progressed in N hours (default 6) so they stop eating the cron's per-tick
// poll budget, and prune sibling chunks that downloaded byte-identical clips
// off the same source URL. Admin-only; idempotent; supports dry_run.
// Evidence-locked requests are never touched.
flexcam.post('/queue/drain', requireRole('admin'), async (c): Promise<Response> => {
  let body: { dry_run?: boolean; stale_hours?: number; limit?: number };
  try { body = await c.req.json(); } catch { body = {}; }
  const result = await runQueueDrain(c.env, {
    dryRun: body.dry_run === true,
    staleHours: typeof body.stale_hours === 'number' ? body.stale_hours : undefined,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  });
  return c.json({ success: true, ...result });
});

// Repair a stuck/partial request: reset missing chunks → pending_request and
// reopen the request → fulfilling so the next cron tick can retry them.
// Evidence-locked requests are not affected.
flexcam.post('/footage/:id/repair', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const row = await queryFirst<{ status: string; evidence_locked: number }>(db,
    'SELECT status, COALESCE(evidence_locked,0) AS evidence_locked FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.evidence_locked) return c.json({ error: 'Locked as evidence — cannot repair' }, 409);

  // Count how many chunks are stuck in a non-retryable state.
  const counts = await queryFirst<{ missing: number; pending: number }>(db,
    `SELECT SUM(CASE WHEN status='missing' THEN 1 ELSE 0 END) AS missing,
            SUM(CASE WHEN status IN ('pending_request','requested') THEN 1 ELSE 0 END) AS pending
     FROM footage_chunks WHERE request_id=?`, id).catch(() => null);

  const missing = counts?.missing ?? 0;
  if (!missing && row.status !== 'partial' && row.status !== 'fulfilling') {
    return c.json({ repaired: 0, message: 'Nothing to repair' });
  }

  // Reset missing chunks back to the request queue.
  const r = await execute(db,
    `UPDATE footage_chunks SET status='pending_request', attempts=0, updated_at=datetime('now')
     WHERE request_id=? AND status='missing'`, id).catch(() => null);
  const repaired = r?.meta.changes ?? 0;

  // Reopen the request so the cron's close-query doesn't immediately re-close it.
  await execute(db,
    `UPDATE footage_requests SET status='fulfilling', updated_at=datetime('now') WHERE id=?`, id).catch(() => {});

  return c.json({ repaired, message: `Reset ${repaired} chunk(s) to pending — cron will retry shortly` });
});

// Timeline markers for a request (event tags + turn pins). ?rebuild=1 re-derives
// from the live ClearPath events + GPS track for the window.
flexcam.get('/footage/:id/markers', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureMarkersSchema(db);
  const id = Number(c.req.param('id'));
  if (c.req.query('rebuild') === '1') { try { await buildFootageMarkers(c.env, id); } catch { /* best-effort */ } }
  const markers = await query(db,
    'SELECT ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir FROM footage_markers WHERE footage_request_id=? ORDER BY offset_ms', id).catch(() => []);
  return c.json({ markers });
});

// ── W1 verification spike ────────────────────────────────────
// Read-only probe of the LIVE ClearPath contract for a tiny recent window. Reports
// the raw response SHAPES (secrets / URLs / base64 stripped) so we can confirm,
// before flipping flexcam_full_drive on: does on-demand media/request return a
// handle? does media/data return arbitrary past segments or only events? is there a
// per-object still (thumbnail) the footage-ALPR can read? Admin-only; writes nothing.
flexcam.post('/diagnose', requireRole('admin'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  const client = await getApiConfig(db, c.env).catch(() => null);
  if (!client) return notConfigured(c, 'clearpath_refresh_token_unset', { ok: false, error: 'ClearPath not configured (no refresh token)' });
  let body: { asset_id?: number; window_seconds?: number; lookback_minutes?: number };
  try { body = await c.req.json(); } catch { body = {}; }

  const steps: Array<{ name: string; data: unknown }> = [];
  const step = (name: string, data: unknown) => steps.push({ name, data });
  const report: Record<string, unknown> = { steps };

  // 1) Resolve a camera asset (explicit, else first media-enabled device).
  let assetId = Number(body.asset_id) || 0;
  try {
    const creds = await getCredentials(db, c.env);
    const devices = creds ? await listDevices(creds) : [];
    step('devices', { count: devices.length, sample: devices.slice(0, 3).map((d) => ({ deviceId: d.deviceId, assetId: d.assetId, mediaEnabled: d.mediaEnabled, name: d.displayName })) });
    if (!assetId) { const m = devices.find((d) => d.mediaEnabled && d.assetId); assetId = m ? Number(m.assetId) : 0; }
  } catch (e) { step('devices_error', (e as Error).message); }
  if (!assetId) return c.json({ ok: false, error: 'No camera asset resolved', report }, 200);
  report.assetId = assetId;

  // 2) Tiny recent window.
  const lookbackMin = Number(body.lookback_minutes) || 10;
  const winSec = Math.min(Number(body.window_seconds) || 40, 120);
  const toTs = Date.now() - lookbackMin * 60_000;
  const fromTs = toTs - winSec * 1000;
  report.window = { fromTs, toTs, winSec, lookbackMin };

  // 3) On-demand request — confirmed endpoint (2026-06-15 HAR):
  //    POST /v2.0/media/cameras/{cameraId}/request-media
  const source = await getClearPathSource(db, c.env);
  try {
    const vendorId = source ? await source.requestChunk(assetId, fromTs, toTs, 'outside') : null;
    step('on_demand_request', { accepted: vendorId != null, vendorId });
  } catch (e) { step('on_demand_request_error', (e as Error).message); }

  // 4) What does media/data return for that window? (shapes only — strip URLs/base64)
  try {
    const page = await listMediaForAsset(c.env, client, assetId, fromTs, toTs, 0, 25);
    const objs = page.items.flatMap((ev) => ev.mediaObject.map((mo) => ({
      channel: mo.channel, type: mo.type, status: mo.status, eventType: mo.eventType,
      hasThumbnail: !!mo.thumbnailUrl, hasAccessUrl: !!mo.accessUrl,
      durationSec: mo.durationSec, gpsPoints: mo.gps?.length ?? 0,
    })));
    step('media_data', { total: page.total, events: page.items.length, objects: objs.slice(0, 25) });
  } catch (e) { step('media_data_error', (e as Error).message); }

  return c.json({ ok: true, report });
});

// ── POST /backfill ────────────────────────────────────────────
// Admin-triggered footage backfill: enqueue footage_requests for every
// closed unit_trip that has no existing request, within the 120-day
// ClearPath retention window. Paginated; admin presses Continue until
// has_more is false.
//
// Returns skipped_units so the UI can surface which units lack a camera
// mapping rather than silently burying them in the skipped count.
// Batch size configurable via system_config 'reanalysis_footage_batch' (default 500).

flexcam.post('/backfill', requireRole('admin'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureFootageSchema(db);

  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1",
  ).catch(() => null);
  if (enabled?.config_value !== 'true') {
    return notConfigured(c, 'flexcam_enabled_flag_off', { error: 'Footage backfill unavailable — set flexcam_enabled=true in system_config (integrations)' });
  }

  // Configurable batch size (default 500; spec conservative was 200)
  const cfgRow = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='reanalysis_footage_batch' AND category='integrations' AND is_active=1 LIMIT 1",
  ).catch(() => null);
  const batchSize = (() => { const n = parseInt(cfgRow?.config_value ?? '', 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 500; })();

  // Ensure job_runs table (same DDL as reanalysis route's schema guard)
  await execute(db, `CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running', total INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    error_detail TEXT, skipped_detail TEXT, started_by INTEGER,
    started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
  )`).catch(() => {});
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_job_runs_type ON job_runs(job_type, id DESC)`).catch(() => {});

  const jr = await execute(db,
    `INSERT INTO job_runs (job_type, status, started_by) VALUES ('footage_backfill','running',?)`,
    c.var.user.id,
  );
  const jobId = Number(jr.meta.last_row_id);

  // Fetch one extra row to detect has_more without a separate COUNT query
  const trips = await query<{ id: number; unit_id: number; start_time: string; end_time: string }>(db,
    `SELECT ut.id, ut.unit_id, ut.start_time, ut.end_time
     FROM unit_trips ut
     LEFT JOIN footage_requests fr ON fr.trip_id = CAST(ut.id AS TEXT)
     WHERE ut.status = 'closed'
       AND fr.id IS NULL
       AND ut.start_time IS NOT NULL
       AND ut.end_time IS NOT NULL
       AND ut.end_time > datetime('now', '-120 days')
     ORDER BY ut.id DESC
     LIMIT ?`,
    batchSize + 1,
  ).catch(() => []);

  const hasMore = trips.length > batchSize;
  const batch   = trips.slice(0, batchSize);

  let queued = 0, skipped = 0, errors = 0;
  const skippedUnits: Array<{ unit_id: number; trip_id: number }> = [];

  for (const trip of batch) {
    const mapping = await queryFirst<{ asset_id: number; cpg_device_id: string }>(db,
      // The CPG asset id lives in `cpg_camera_id` (mirrors the /request handler above).
      `SELECT cpg_camera_id AS asset_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1`,
      trip.unit_id,
    ).catch(() => null);

    if (!mapping) {
      skipped++;
      skippedUnits.push({ unit_id: trip.unit_id, trip_id: trip.id });
      continue;
    }

    const fromTs = new Date(trip.start_time).getTime();
    const toTs   = new Date(trip.end_time).getTime();
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs - fromTs < 80_000) {
      skipped++;
      continue;
    }

    try {
      await enqueueFootage(c.env, {
        assetId: mapping.asset_id,
        unitId: trip.unit_id,
        cpgDeviceId: mapping.cpg_device_id,
        tripId: String(trip.id),
        fromTs, toTs,
        reason: 'trip_auto',
        channels: ['outside'],
      });
      queued++;
    } catch (e) {
      errors++;
      console.error('[flexcam-backfill] enqueue failed:', (e as Error).message);
    }
  }

  const skippedDetail = skippedUnits.length ? JSON.stringify(skippedUnits) : null;
  await execute(db,
    `UPDATE job_runs SET status='complete', processed=?, skipped=?, errors=?, skipped_detail=?, finished_at=datetime('now') WHERE id=?`,
    queued, skipped, errors, skippedDetail, jobId,
  );

  return c.json({ queued, skipped, errors, has_more: hasMore, skipped_units: skippedUnits, job_id: jobId });
});

export default flexcam;
