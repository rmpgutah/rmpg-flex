// src/utils/footage/captureOrchestrator.ts
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute, columnExists } from '../db';
import { getClearPathSource } from './clearpathSource';
import { splitWindow } from './splitWindow';
import { capChunkCount, batchLimit } from './pacing';
import { retentionCutoffMs } from './retention';

const R2_PREFIX = 'flexcam/trips/';
const MAX_DOWNLOADS_PER_RUN = 40;  // download pass cap per cron tick
const MAX_REQUESTS_PER_RUN = 30;   // request pass cap per cron tick (vendor subrequest safety)
const MAX_POLL_ATTEMPTS = 30;      // ~30 cron minutes before a chunk is 'missing'
const CHUNK_SECONDS = 40;          // segment length we split a drive into

/** Read an integer config from system_config (category integrations); def on absent/NaN. */
async function cfgInt(db: D1Database, key: string, def: number): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key=? AND category='integrations' AND is_active=1 LIMIT 1", key).catch(() => null);
  const n = Number(row?.config_value);
  return Number.isFinite(n) ? n : def;
}

let schemaReady = false;
export async function ensureFootageSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL DEFAULT 'clearpathgps',
    asset_id INTEGER NOT NULL, cpg_device_id TEXT, unit_id INTEGER, trip_id TEXT, call_id INTEGER,
    from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', chunk_count INTEGER DEFAULT 0, chunks_done INTEGER DEFAULT 0,
    bytes INTEGER DEFAULT 0, merged_r2_key TEXT, merged_status TEXT, title TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL, channel TEXT NOT NULL DEFAULT 'outside',
    vendor_media_id TEXT, r2_key TEXT, content_type TEXT, bytes INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'requested', alpr_status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_footage_chunks_req ON footage_chunks(request_id, seq)`);
  schemaReady = true;
}

export interface EnqueueArgs {
  assetId: number; unitId?: number | null; cpgDeviceId?: string | null;
  tripId?: string | null; callId?: number | null;
  fromTs: number; toTs: number; reason: 'trip_auto' | 'on_demand' | 'critical_event';
  channels?: string[]; title?: string | null; createdBy?: number | null;
}

/** Create a request + its chunk rows + fire the vendor requests. Idempotent on
 *  (asset, from, to, reason). Returns the request id (or existing one). */
export async function enqueueFootage(env: Bindings, args: EnqueueArgs): Promise<number | null> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return null;

  // Idempotency is a non-atomic check-then-insert (TOCTOU); acceptable for the once-per-minute single-isolate cron + low API-route call volume.
  const dup = await queryFirst<{ id: number }>(db,
    `SELECT id FROM footage_requests WHERE asset_id=? AND from_ts=? AND to_ts=? AND reason=? LIMIT 1`,
    args.assetId, args.fromTs, args.toTs, args.reason).catch(() => null);
  if (dup) return dup.id;

  const channels = args.channels?.length ? args.channels : ['outside'];
  // Build the chunk plan WITHOUT firing vendor requests — the cron paces those
  // (runRequestPass), so a multi-hour drive can't blow the Worker subrequest limit.
  const maxChunks = await cfgInt(db, 'flexcam_max_chunks_per_request', 0); // 0 = unlimited
  const planned: Array<{ seq: number; fromTs: number; toTs: number; channel: string }> = [];
  for (const channel of channels) {
    for (const c of splitWindow(args.fromTs, args.toTs, CHUNK_SECONDS)) {
      planned.push({ seq: planned.length, fromTs: c.fromTs, toTs: c.toTs, channel });
    }
  }
  const capped = planned.slice(0, capChunkCount(planned.length, maxChunks));
  if (!capped.length) return null;

  const r = await execute(db, `INSERT INTO footage_requests
    (source, asset_id, cpg_device_id, unit_id, trip_id, call_id, from_ts, to_ts, reason, status, chunk_count, title, created_by)
    VALUES ('clearpathgps', ?, ?, ?, ?, ?, ?, ?, ?, 'fulfilling', ?, ?, ?)`,
    args.assetId, args.cpgDeviceId ?? null, args.unitId ?? null, args.tripId ?? null, args.callId ?? null,
    args.fromTs, args.toTs, args.reason, capped.length, args.title ?? null, args.createdBy ?? null);
  const requestId = Number(r.meta.last_row_id);

  // Chunks start in 'pending_request'; the cron's request pass fires the vendor
  // call and advances them to 'requested', then the download pass pulls them.
  for (const h of capped) {
    await execute(db, `INSERT INTO footage_chunks
      (request_id, seq, from_ts, to_ts, channel, status) VALUES (?, ?, ?, ?, ?, 'pending_request')`,
      requestId, h.seq, h.fromTs, h.toTs, h.channel);
  }
  return requestId;
}

/** Cron pass 1: fire vendor requests for 'pending_request' chunks, bounded per run.
 *  Advances each to 'requested' with its vendor media id so the download pass picks
 *  it up. Best-effort per chunk — a vendor error leaves the chunk pending for retry. */
export async function runRequestPass(env: Bindings): Promise<{ requested: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return { requested: 0 };
  const limit = batchLimit(await cfgInt(db, 'flexcam_requests_per_run', MAX_REQUESTS_PER_RUN), MAX_REQUESTS_PER_RUN);
  const pend = await query<{ id: number; from_ts: number; to_ts: number; channel: string; asset_id: number }>(db,
    `SELECT ch.id, ch.from_ts, ch.to_ts, ch.channel, rq.asset_id
       FROM footage_chunks ch JOIN footage_requests rq ON rq.id = ch.request_id
      WHERE ch.status='pending_request' ORDER BY ch.request_id, ch.seq LIMIT ?`, limit).catch(() => []);
  let requested = 0;
  for (const ch of pend) {
    try {
      const vendorId = await source.requestChunk(ch.asset_id, ch.from_ts, ch.to_ts, ch.channel);
      await execute(db, `UPDATE footage_chunks SET status='requested', vendor_media_id=?, updated_at=datetime('now') WHERE id=?`, vendorId, ch.id);
      requested++;
    } catch (e) { console.error('[flexcam] requestChunk failed:', (e as Error).message); }
  }
  return { requested };
}

/** Cron tick: poll 'requested' chunks; download 'available' ones into R2. */
export async function pollAndDownload(env: Bindings): Promise<{ downloaded: number; missing: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return { downloaded: 0, missing: 0 };

  const pending = await query<{ id: number; request_id: number; seq: number; from_ts: number; to_ts: number;
    channel: string; vendor_media_id: string | null; asset_id: number; cpg_device_id: string | null; attempts: number }>(db,
    `SELECT ch.id, ch.request_id, ch.seq, ch.from_ts, ch.to_ts, ch.channel, ch.vendor_media_id, ch.attempts,
            rq.asset_id, rq.cpg_device_id
     FROM footage_chunks ch JOIN footage_requests rq ON rq.id = ch.request_id
     WHERE ch.status = 'requested' ORDER BY ch.request_id, ch.seq LIMIT ?`, MAX_DOWNLOADS_PER_RUN).catch(() => []);

  let downloaded = 0, missing = 0;
  for (const ch of pending) {
    const st = await source.pollChunk(ch.asset_id, {
      seq: ch.seq, vendorId: ch.vendor_media_id, fromTs: ch.from_ts, toTs: ch.to_ts, channel: ch.channel,
    }).catch(() => ({ state: 'requested' as const }));

    if (st.state === 'available' && st.accessUrl) {
      const key = `${R2_PREFIX}${ch.asset_id}/${ch.request_id}/${ch.seq}_${ch.channel}.mp4`;
      const resp = await fetch(st.accessUrl, { signal: AbortSignal.timeout(5 * 60_000) });
      if (resp.ok && resp.body) {
        const ct = st.contentType || resp.headers.get('content-type') || 'video/mp4';
        const put = await env.UPLOADS.put(key, resp.body, { httpMetadata: { contentType: ct } });
        const bytes = put?.size ?? parseInt(resp.headers.get('content-length') || '0', 10);
        const alpr = ch.channel === 'inside' ? 'skipped' : 'pending';
        await execute(db, `UPDATE footage_chunks SET status='downloaded', r2_key=?, content_type=?, bytes=?, alpr_status=?, updated_at=datetime('now') WHERE id=?`,
          key, ct, bytes, alpr, ch.id);
        // NOTE: stateless-cron two-step write — a Worker eviction between R2 put and this update can re-download + double-count chunks_done (informational only; R2 put is idempotent by key). Accepted, same as clearpathSync.
        await execute(db, `UPDATE footage_requests SET chunks_done = chunks_done + 1, bytes = bytes + ?, updated_at=datetime('now') WHERE id=?`, bytes, ch.request_id);
        downloaded++;
        if (alpr === 'pending') {
          try {
            const { alprFootageChunk } = await import('./footageAlpr');
            await alprFootageChunk(env, db, ch.id, key, ch.cpg_device_id);
            await execute(db, `UPDATE footage_chunks SET alpr_status='done' WHERE id=?`, ch.id);
          } catch (e) { console.error('[flexcam-alpr] failed:', (e as Error).message); }
        }
      } else if (ch.attempts + 1 >= MAX_POLL_ATTEMPTS) {
        await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
        missing++;
      } else {
        await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
      }
    } else if (st.state === 'missing' || ch.attempts + 1 >= MAX_POLL_ATTEMPTS) {
      await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
      missing++;
    } else {
      await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
    }
  }

  // Close any request whose chunks are all resolved (none still 'requested').
  // 'partial' if any chunk is 'missing', else 'complete'. Idempotent; catches
  // requests whose last chunk resolved on an earlier tick (not just this batch).
  await execute(db, `
    UPDATE footage_requests
    SET status = CASE WHEN EXISTS (
          SELECT 1 FROM footage_chunks WHERE request_id = footage_requests.id AND status = 'missing'
        ) THEN 'partial' ELSE 'complete' END,
        updated_at = datetime('now')
    WHERE status IN ('queued','fulfilling')
      AND NOT EXISTS (SELECT 1 FROM footage_chunks WHERE request_id = footage_requests.id AND status = 'requested')`).catch(() => {});
  return { downloaded, missing };
}

/** Per-minute cron entry, throttled by a config flag. */
export async function maybeRunFootagePoll(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
  if (enabled?.config_value !== 'true') return;
  const req = await runRequestPass(env);
  const r = await pollAndDownload(env);
  if (req.requested || r.downloaded || r.missing) console.log(`[flexcam] requested=${req.requested} downloaded=${r.downloaded} missing=${r.missing}`);
}

const DEFAULT_RETENTION_DAYS = 120; // 4 months
const PURGE_BATCH = 50;             // requests purged per cron run

/** Delete R2 objects + rows for footage_requests past the retention window that
 *  are NOT locked as evidence. Batched per run; best-effort per object. Returns
 *  counts. footage_retention_days config overrides the 120-day default; 0 = keep
 *  forever (no-op). Evidence-locked footage is never purged. */
export async function purgeExpiredFootage(env: Bindings, nowMs = Date.now()): Promise<{ purged: number; objects: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const days = await cfgInt(db, 'footage_retention_days', DEFAULT_RETENTION_DAYS);
  const cutoff = retentionCutoffMs(nowMs, days);
  if (cutoff == null) return { purged: 0, objects: 0 };                                // keep forever
  const cutoffIso = new Date(cutoff).toISOString().replace('T', ' ').slice(0, 19);    // new-date-ok (epoch number)

  // evidence_locked is a Phase-2 column that may not exist on live → guard it.
  const locked = await columnExists(db, 'footage_requests', 'evidence_locked').catch(() => false);
  const lockClause = locked ? 'AND COALESCE(evidence_locked,0)=0' : '';
  const due = await query<{ id: number; merged_r2_key: string | null }>(db,
    `SELECT id, merged_r2_key FROM footage_requests WHERE created_at < ? ${lockClause} ORDER BY id LIMIT ?`,
    cutoffIso, PURGE_BATCH).catch(() => []);

  let purged = 0, objects = 0;
  for (const req of due) {
    const chunks = await query<{ r2_key: string | null }>(db, 'SELECT r2_key FROM footage_chunks WHERE request_id=?', req.id).catch(() => []);
    for (const ch of chunks) {
      if (ch.r2_key) { try { await env.UPLOADS.delete(ch.r2_key); objects++; } catch { /* best-effort */ } }
    }
    if (req.merged_r2_key) { try { await env.UPLOADS.delete(req.merged_r2_key); objects++; } catch { /* */ } }
    await execute(db, 'DELETE FROM footage_chunks WHERE request_id=?', req.id).catch(() => {});
    await execute(db, 'DELETE FROM footage_requests WHERE id=?', req.id).catch(() => {});
    purged++;
  }
  return { purged, objects };
}
