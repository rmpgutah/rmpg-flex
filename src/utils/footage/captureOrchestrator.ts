// src/utils/footage/captureOrchestrator.ts
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute } from '../db';
import { detectGaps } from './splitWindow';
import { getClearPathSource } from './clearpathSource';
import type { ChunkRow } from './types';

const R2_PREFIX = 'flexcam/trips/';
const MAX_DOWNLOADS_PER_RUN = 40;
const MAX_POLL_ATTEMPTS = 30;      // ~30 cron minutes before a chunk is 'missing'
const DEFAULT_CHUNK_CAP = 90;      // 60 min at 40s/chunk

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

  const dup = await queryFirst<{ id: number }>(db,
    `SELECT id FROM footage_requests WHERE asset_id=? AND from_ts=? AND to_ts=? AND reason=? LIMIT 1`,
    args.assetId, args.fromTs, args.toTs, args.reason).catch(() => null);
  if (dup) return dup.id;

  const channels = args.channels?.length ? args.channels : ['outside'];
  const handles = await source.requestWindow(args.assetId, args.fromTs, args.toTs, channels)
    .catch((e) => { console.error('[flexcam] requestWindow failed:', (e as Error).message); return []; });
  if (!handles.length) return null;
  const capped = handles.slice(0, DEFAULT_CHUNK_CAP);

  const r = await execute(db, `INSERT INTO footage_requests
    (source, asset_id, cpg_device_id, unit_id, trip_id, call_id, from_ts, to_ts, reason, status, chunk_count, title, created_by)
    VALUES ('clearpathgps', ?, ?, ?, ?, ?, ?, ?, ?, 'fulfilling', ?, ?, ?)`,
    args.assetId, args.cpgDeviceId ?? null, args.unitId ?? null, args.tripId ?? null, args.callId ?? null,
    args.fromTs, args.toTs, args.reason, capped.length, args.title ?? null, args.createdBy ?? null);
  const requestId = Number(r.meta.last_row_id);

  for (const h of capped) {
    await execute(db, `INSERT INTO footage_chunks
      (request_id, seq, from_ts, to_ts, channel, vendor_media_id, status) VALUES (?, ?, ?, ?, ?, ?, 'requested')`,
      requestId, h.seq, h.fromTs, h.toTs, h.channel, h.vendorId);
  }
  return requestId;
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
  const touched = new Set<number>();
  for (const ch of pending) {
    touched.add(ch.request_id);
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
        await execute(db, `UPDATE footage_requests SET chunks_done = chunks_done + 1, bytes = bytes + ?, updated_at=datetime('now') WHERE id=?`, bytes, ch.request_id);
        downloaded++;
        if (alpr === 'pending') {
          try {
            const { alprFootageChunk } = await import('./footageAlpr');
            await alprFootageChunk(env, db, ch.id, key, ch.cpg_device_id);
            await execute(db, `UPDATE footage_chunks SET alpr_status='done' WHERE id=?`, ch.id);
          } catch (e) { console.error('[flexcam-alpr] failed:', (e as Error).message); }
        }
      }
    } else if (st.state === 'missing' || ch.attempts + 1 >= MAX_POLL_ATTEMPTS) {
      await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
      missing++;
    } else {
      await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
    }
  }

  for (const reqId of touched) {
    const rows = await query<ChunkRow>(db, `SELECT seq, status, r2_key FROM footage_chunks WHERE request_id=?`, reqId).catch(() => []);
    if (!rows.length) continue;
    const open = rows.some((r) => r.status === 'requested');
    if (open) continue;
    const status = detectGaps(rows).length ? 'partial' : 'complete';
    await execute(db, `UPDATE footage_requests SET status=?, updated_at=datetime('now') WHERE id=?`, status, reqId);
  }
  return { downloaded, missing };
}

/** Per-minute cron entry, throttled by a config flag. */
export async function maybeRunFootagePoll(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
  if (enabled?.config_value !== 'true') return;
  const r = await pollAndDownload(env);
  if (r.downloaded || r.missing) console.log(`[flexcam] downloaded=${r.downloaded} missing=${r.missing}`);
}
