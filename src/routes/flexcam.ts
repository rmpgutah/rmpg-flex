// src/routes/flexcam.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { ensureFootageSchema, enqueueFootage } from '../utils/footage/captureOrchestrator';
import { buildManifest, concatToR2 } from '../utils/footage/concat';
import { requireRole } from '../middleware/auth';
import { footageEvidenceNumber, isUnlockable, buildCourtManifest, manifestPayloadHash, logCustody, viewSessionKey } from '../utils/footage/evidence';
import { signTriple } from '../utils/pdfSign';

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
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_custody_view ON footage_custody_log(footage_request_id, actor_user_id, session_key) WHERE action='viewed'`).catch(() => {});
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_evidence_links (id INTEGER PRIMARY KEY AUTOINCREMENT, footage_request_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, linked_by INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`).catch(() => {});
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_evlink ON footage_evidence_links(footage_request_id, entity_type, entity_id)`).catch(() => {});
  evidenceSchemaReady = true;
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

flexcam.post('/request', async (c): Promise<Response> => {
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
  return c.json({ request: req, manifest });
});

flexcam.get('/footage/:id/chunk/:seq/stream', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const row = await queryFirst<{ r2_key: string | null; content_type: string | null }>(db,
    'SELECT r2_key, content_type FROM footage_chunks WHERE request_id=? AND seq=?', c.req.param('id'), c.req.param('seq')).catch(() => null);
  if (!row?.r2_key) return c.json({ error: 'Chunk not found' }, 404);
  const obj = await c.env.UPLOADS.get(row.r2_key);
  if (!obj) return c.json({ error: 'Object missing' }, 404);
  await logCustody(db, { requestId: Number(c.req.param('id')), action: 'viewed', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), sessionKey: viewSessionKey(c.var.user?.id ?? null, new Date().toISOString()) }); // new-date-ok
  return new Response(obj.body, { headers: { 'Content-Type': row.content_type || 'video/mp4', 'Cache-Control': 'private, max-age=3600' } });
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

flexcam.post('/render/:id', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const rows = await query<{ seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number }>(
    db, 'SELECT seq, from_ts, to_ts, status, r2_key, bytes FROM footage_chunks WHERE request_id=? ORDER BY seq', id).catch(() => []);
  const manifest = buildManifest(id, rows);
  if (!manifest.chunks.length) return c.json({ error: 'No downloaded chunks' }, 409);
  const mergedKey = `flexcam/trips/merged/${id}.mp4`;
  // Format from the discovery spike; default 'mp4' (unsupported on Worker → client renders).
  const result = await concatToR2(c.env, mergedKey, manifest.chunks, 'mp4');
  await execute(db, 'UPDATE footage_requests SET merged_r2_key=?, merged_status=? WHERE id=?', result === 'ready' ? mergedKey : null, result, id);
  return c.json({ merged_status: result, merged_r2_key: result === 'ready' ? mergedKey : null });
});

// ── Evidence endpoints ───────────────────────────────────────

flexcam.post('/footage/:id/lock', async (c): Promise<Response> => {
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
  const custody = await query(db, 'SELECT action, actor_user_id, actor_name, reason, detail, session_key, created_at FROM footage_custody_log WHERE footage_request_id=? ORDER BY id', id).catch(() => []);
  const links = await query(db, 'SELECT entity_type, entity_id, linked_by, notes, created_at FROM footage_evidence_links WHERE footage_request_id=?', id).catch(() => []);
  return c.json({ request: req, custody, links });
});

flexcam.post('/footage/:id/links', async (c): Promise<Response> => {
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

flexcam.post('/footage/:id/court-package', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureEvidenceSchema(db);
  const id = Number(c.req.param('id'));
  const req = await queryFirst<{ id: number; evidence_number: string | null; classification: string; preserved_reason: string | null; from_ts: number; to_ts: number }>(
    db, 'SELECT id, evidence_number, classification, preserved_reason, from_ts, to_ts FROM footage_requests WHERE id=?', id).catch(() => null);
  if (!req) return c.json({ error: 'Not found' }, 404);
  const chunks = await query<{ id: number; seq: number; from_ts: number; to_ts: number; bytes: number; sha256: string | null; status: string; r2_key: string | null }>(
    db, 'SELECT id, seq, from_ts, to_ts, bytes, sha256, status, r2_key FROM footage_chunks WHERE request_id=? ORDER BY seq', id).catch(() => []);
  for (const ch of chunks) {
    if (ch.sha256 || ch.status !== 'downloaded' || !ch.r2_key) continue;
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
  const signed = await signTriple(c.env, `flexcam:${req.evidence_number ?? id}`, caseRef ? `${caseRef.entity_type}:${caseRef.entity_id}` : '', payloadHash);
  await logCustody(db, { requestId: id, action: 'exported', actorUserId: c.var.user?.id ?? null, actorName: actorName(c), detail: { payloadHash } });
  return c.json({ manifest, payloadHash, ...signed });
});

// Locked-evidence delete guard: a request flagged as evidence cannot be deleted
// until an admin unlocks it. The blocked attempt is itself recorded to custody.
flexcam.delete('/footage/:id', async (c): Promise<Response> => {
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

export default flexcam;
