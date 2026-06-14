// src/routes/flexcam.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { ensureFootageSchema, enqueueFootage } from '../utils/footage/captureOrchestrator';
import { buildManifest, concatToR2 } from '../utils/footage/concat';

const flexcam = new Hono<Env>();

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

export default flexcam;
