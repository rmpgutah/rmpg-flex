// src/utils/footage/captureOrchestrator.ts
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch, columnExists } from '../db';
import { getClearPathSource } from './clearpathSource';
import { splitWindow } from './splitWindow';
import { capChunkCount, batchLimit } from './pacing';
import { retentionCutoffMs, isBeyondRequestHorizon } from './retention';
import { assignClipsToChunks } from './assignClips';
import { shouldEarlyAbandon } from './earlyAbandon';
import { validateMp4Header, isDuplicateContent, formatRejectionReason } from './integrity';

const R2_PREFIX = 'flexcam/trips/';
const MAX_DOWNLOADS_PER_RUN = 40;  // download pass cap per cron tick
const MAX_REQUESTS_PER_RUN = 10;   // request pass cap per cron tick — ClearPath rate-limits above ~10/min
const MAX_POLL_ATTEMPTS = 30;      // ~30 cron minutes before an event/auto chunk expires
// Plan C — 720 was a fiction: with the per-chunk poll path it actually meant
// ~75 days of real time (queue starvation throttled each chunk to one poll
// every 2.5 hours). Post-Plan-B + drained queue, polls land roughly per cron
// tick, so 60 attempts ≈ 1 hour of real time — enough for a camera that's
// genuinely uploading to deliver. Combined with the early-abandon guard in
// pollAndDownload (zero clips + ≥10 attempts → fail the whole request fast)
// this is the honest failure-path budget.
const MAX_POLL_ATTEMPTS_ON_DEMAND = 60;
const EARLY_ABANDON_ATTEMPTS = 10; // zero-clips guard threshold
// requestChunk 500s mean ClearPath rejected the request outright (footage unavailable,
// camera offline, etc). Stop after 5 tries — not 720 — so the queue clears fast.
const MAX_REQUEST_ATTEMPTS = 5;
const CHUNK_SECONDS = 40;          // segment length we split a drive into
// Recency horizon for NEW requests: ClearPath only serves on-demand clips for
// recent footage (older windows = off the SD / parked time → ~99% 500). Enqueuing
// them just floods the queue with doomed chunks. Configurable via
// flexcam_request_max_age_days; 0 disables the cap.
const DEFAULT_REQUEST_MAX_AGE_DAYS = 7;

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
  // source_url: the ClearPath signed download URL we pulled bytes from. Used to
  // dedup clips across chunks in the same request — ClearPath returns the same
  // handful of clips to every chunk's poll, so without this guard the same video
  // can land on multiple consecutive segments.
  if (!(await columnExists(db, 'footage_chunks', 'source_url').catch(() => true))) {
    await execute(db, `ALTER TABLE footage_chunks ADD COLUMN source_url TEXT`).catch(() => {});
  }
  // sha256: hex digest of the downloaded bytes — populated inline during
  // download so we can reject duplicate content (re-signed URLs that point
  // at the same underlying file) BEFORE the chunk goes live. The evidence
  // / court-package path also reads this; if absent there it lazy-fills.
  if (!(await columnExists(db, 'footage_chunks', 'sha256').catch(() => true))) {
    await execute(db, `ALTER TABLE footage_chunks ADD COLUMN sha256 TEXT`).catch(() => {});
  }
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

  // Recency cap: skip windows older than the request horizon — ClearPath can't
  // serve on-demand clips that old, so enqueuing them just buries the queue in
  // ~99%-doomed chunks (8.8k 'missing' observed from a month-wide backfill).
  const maxAgeDays = await cfgInt(db, 'flexcam_request_max_age_days', DEFAULT_REQUEST_MAX_AGE_DAYS);
  if (isBeyondRequestHorizon(args.fromTs, Date.now(), maxAgeDays)) return null;

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
  // Batch inserts to avoid sequential round-trips (720 chunks for an 8h window
  // would timeout the Worker with sequential awaits).
  const BATCH_SZ = 500;
  for (let i = 0; i < capped.length; i += BATCH_SZ) {
    await executeBatch(db, capped.slice(i, i + BATCH_SZ).map((h) => ({
      sql: `INSERT INTO footage_chunks (request_id, seq, from_ts, to_ts, channel, status) VALUES (?, ?, ?, ?, ?, 'pending_request')`,
      bindings: [requestId, h.seq, h.fromTs, h.toTs, h.channel],
    })));
  }
  return requestId;
}

/** Cron pass 1: fire vendor requests for 'pending_request' chunks, bounded per run.
 *  Advances each to 'requested' with its vendor media id so the download pass picks
 *  it up. Best-effort per chunk — a vendor error increments the attempt counter so
 *  the chunk eventually expires rather than clogging the queue forever. */
export async function runRequestPass(env: Bindings): Promise<{ requested: number; expired: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return { requested: 0, expired: 0 };
  const limit = batchLimit(await cfgInt(db, 'flexcam_requests_per_run', MAX_REQUESTS_PER_RUN), MAX_REQUESTS_PER_RUN);
  const pend = await query<{ id: number; from_ts: number; to_ts: number; channel: string; asset_id: number; attempts: number; reason: string }>(db,
    `SELECT ch.id, ch.from_ts, ch.to_ts, ch.channel, rq.asset_id, ch.attempts, rq.reason
       FROM footage_chunks ch JOIN footage_requests rq ON rq.id = ch.request_id
      WHERE ch.status='pending_request' ORDER BY ch.request_id, ch.seq LIMIT ?`, limit).catch(() => []);
  let requested = 0, expired = 0, consecutiveErrors = 0;
  const requestErrors: string[] = [];
  for (const ch of pend) {
    try {
      const vendorId = await source.requestChunk(ch.asset_id, ch.from_ts, ch.to_ts, ch.channel);
      await execute(db, `UPDATE footage_chunks SET status='requested', vendor_media_id=?, attempts=0, updated_at=datetime('now') WHERE id=?`, vendorId, ch.id);
      requested++;
      consecutiveErrors = 0;
    } catch (e) {
      const msg = (e as Error).message;
      requestErrors.push(msg);
      consecutiveErrors++;
      if (ch.attempts + 1 >= MAX_REQUEST_ATTEMPTS) {
        await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
        expired++;
      } else {
        await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
      }
      if (consecutiveErrors >= 3) break;
    }
  }
  if (requestErrors.length) {
    // Log once per run (not once per chunk) — 500s are expected when the camera is offline
    const sample = requestErrors[0];
    console.log(`[flexcam] requestChunk: ${requestErrors.length} failed (${sample})`);
  }
  return { requested, expired };
}

/** Cron tick: poll 'requested' chunks; download 'available' ones into R2.
 *
 *  Per-request flow (replaces the prior per-chunk poll): for each request that
 *  has pending chunks in this batch, ask the source for EVERY available clip
 *  in the request's full window ONCE, then greedy-assign clips to chunks via
 *  assignClipsToChunks. This eliminates the dedup-starvation that left 5800+
 *  chunks stuck — sibling chunks polling the same window used to race for the
 *  same handful of clips, with only the first winning. Now every returned
 *  clip lands on its best-matching unassigned chunk in one pass.
 *
 *  Chunks not matched THIS tick either bump attempts (will retry) or expire
 *  to 'missing' if past the cap. Per-request URL dedup against D1 is preserved
 *  (filter candidates by source_url) so re-pulls don't repeat past downloads. */
export async function pollAndDownload(env: Bindings): Promise<{ downloaded: number; missing: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return { downloaded: 0, missing: 0 };

  const pending = await query<{ id: number; request_id: number; seq: number; from_ts: number; to_ts: number;
    channel: string; vendor_media_id: string | null; asset_id: number; cpg_device_id: string | null; attempts: number; reason: string }>(db,
    `SELECT ch.id, ch.request_id, ch.seq, ch.from_ts, ch.to_ts, ch.channel, ch.vendor_media_id, ch.attempts,
            rq.asset_id, rq.cpg_device_id, rq.reason
     FROM footage_chunks ch JOIN footage_requests rq ON rq.id = ch.request_id
     WHERE ch.status = 'requested' ORDER BY ch.request_id DESC, ch.seq ASC LIMIT ?`, MAX_DOWNLOADS_PER_RUN).catch(() => []);

  // Group pending chunks by request — one listRequestWindow call per group.
  type PendingChunk = (typeof pending)[number];
  const byRequest = new Map<number, PendingChunk[]>();
  for (const ch of pending) {
    const arr = byRequest.get(ch.request_id);
    if (arr) arr.push(ch);
    else byRequest.set(ch.request_id, [ch]);
  }

  let downloaded = 0, missing = 0;
  for (const [requestId, chunks] of byRequest) {
    // Request metadata — needed for the window query + max-attempts policy.
    // (Every chunk in the group shares these but we only need to read once.)
    const rq = chunks[0]; // chunks all share asset_id / reason via the JOIN
    const maxAttempts = rq.reason === 'on_demand' ? MAX_POLL_ATTEMPTS_ON_DEMAND : MAX_POLL_ATTEMPTS;

    // Window bounds = min(from_ts) .. max(to_ts) over THIS request's pending
    // chunks (which already cover the relevant slice — listRequestWindow adds
    // its own ±SLOP_MS on top).
    const winFrom = Math.min(...chunks.map((c) => c.from_ts));
    const winTo   = Math.max(...chunks.map((c) => c.to_ts));

    // URLs already claimed by other chunks in this request (DB-persisted from
    // earlier ticks). Drop these from candidates so we don't re-download.
    const claimedRows = await query<{ source_url: string | null }>(db,
      `SELECT source_url FROM footage_chunks WHERE request_id=? AND source_url IS NOT NULL`, requestId).catch(() => []);
    const claimedSet = new Set(claimedRows.map((r) => r.source_url!).filter(Boolean));

    // One listMedia call for the whole window (vs N per chunk). On error,
    // bump all this request's chunks' attempts and move on — don't let a
    // transient vendor error mark every chunk missing in one tick.
    const all = await source.listRequestWindow(rq.asset_id, winFrom, winTo).catch((e) => {
      console.log(`[flexcam-poll] req=${requestId} listRequestWindow failed: ${(e as Error).message}`);
      return [];
    });
    const candidates = all.filter((c) => !claimedSet.has(c.accessUrl));

    // Early-abandon — if the vendor returned ZERO clips for this request's
    // window AND any chunk has been polling long enough to credibly conclude
    // the camera isn't going to deliver, fail-fast all remaining chunks.
    // Saves the cron's per-tick poll budget from grinding on chronic
    // no-uploads for the full MAX_POLL_ATTEMPTS_ON_DEMAND × N chunks.
    const maxChunkAttempts = Math.max(0, ...chunks.map((c) => c.attempts ?? 0));
    if (shouldEarlyAbandon({ clipCount: all.length, maxChunkAttempts, threshold: EARLY_ABANDON_ATTEMPTS })) {
      for (const ch of chunks) {
        await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id).catch(() => null);
        missing++;
      }
      console.log(`[flexcam-poll] req=${requestId} early-abandon: 0 clips after ${maxChunkAttempts} attempts (${chunks.length} chunk(s) → missing)`);
      continue;
    }

    // Greedy-assign — one clip → one chunk, closest by midpoint, channel-aware.
    const assignments = assignClipsToChunks(
      candidates,
      chunks.map((c) => ({ id: c.id, from_ts: c.from_ts, to_ts: c.to_ts, channel: c.channel })),
      { slopMs: 120_000 },
    );

    for (const ch of chunks) {
      const assigned = assignments.get(ch.id);
      if (assigned) {
        const key = `${R2_PREFIX}${ch.asset_id}/${ch.request_id}/${ch.seq}_${ch.channel}.mp4`;
        const resp = await fetch(assigned.accessUrl, { signal: AbortSignal.timeout(5 * 60_000) });
        if (resp.ok) {
          // Plan D — buffer the response so we can validate, hash, and dedup
          // BEFORE writing to R2. Memory: one ~6MB chunk in flight at a time
          // (sequential loop) → well under the 128MB isolate budget.
          const ab = await resp.arrayBuffer().catch(() => null);
          if (!ab || ab.byteLength === 0) {
            if (ch.attempts + 1 >= maxAttempts) {
              await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
              missing++;
            } else {
              await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
            }
            continue;
          }
          const byteArr = new Uint8Array(ab);

          // Integrity check 1 — must look like a real MP4 (ftyp at offset 4).
          // Catches JSON/HTML error bodies served as binary, truncated heads,
          // anything that wouldn't decode in <video>.
          if (!validateMp4Header(byteArr)) {
            console.log(`[flexcam-integrity] req=${ch.request_id} seq=${ch.seq} rejected: ${formatRejectionReason('not_mp4')}`);
            // Treat as a failed download attempt — don't store, bump or expire.
            if (ch.attempts + 1 >= maxAttempts) {
              await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
              missing++;
            } else {
              await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
            }
            continue;
          }

          // Integrity check 2 — sha256 content dedup. URL-level dedup misses
          // re-signed signed-URLs that point at the same underlying file;
          // content-hash catches them. We compare against all other downloaded
          // chunks IN THIS REQUEST — cross-request dedup would corrupt the
          // legitimate case of two trips through the same intersection.
          const digest = await crypto.subtle.digest('SHA-256', ab);
          const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
          const existingShaRows = await query<{ sha256: string }>(db,
            `SELECT sha256 FROM footage_chunks WHERE request_id=? AND status='downloaded' AND sha256 IS NOT NULL`,
            ch.request_id).catch(() => [] as Array<{ sha256: string }>);
          const existingShas = existingShaRows.map((r) => r.sha256);
          if (isDuplicateContent(sha, existingShas)) {
            console.log(`[flexcam-integrity] req=${ch.request_id} seq=${ch.seq} rejected: ${formatRejectionReason('duplicate_content')}`);
            // Mark missing — the content is already stored under another seq.
            // Don't touch R2 (the kept chunk owns the bytes).
            await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
            missing++;
            continue;
          }

          // Validated + unique → persist.
          const ct = 'video/mp4';
          const put = await env.UPLOADS.put(key, byteArr, { httpMetadata: { contentType: ct } });
          const bytes = put?.size ?? byteArr.length;
          const alpr = ch.channel === 'inside' ? 'skipped' : 'pending';
          await execute(db, `UPDATE footage_chunks SET status='downloaded', r2_key=?, source_url=?, content_type=?, bytes=?, sha256=?, alpr_status=?, updated_at=datetime('now') WHERE id=?`,
            key, assigned.accessUrl, ct, bytes, sha, alpr, ch.id);
          // NOTE: stateless-cron two-step write — a Worker eviction between R2 put and this update can re-download + double-count chunks_done (informational only; R2 put is idempotent by key). Accepted, same as clearpathSync.
          await execute(db, `UPDATE footage_requests SET chunks_done = chunks_done + 1, bytes = bytes + ?, updated_at=datetime('now') WHERE id=?`, bytes, ch.request_id);
          downloaded++;
          if (alpr === 'pending') {
            try {
              if (assigned.thumbnailUrl) {
                // Free Workers-AI ALPR on the segment's still — no Roboflow credits,
                // no in-Worker video decode. The video chunk itself stays unscanned.
                const tr = await fetch(assigned.thumbnailUrl, { signal: AbortSignal.timeout(30_000) });
                if (tr.ok) {
                  const stillBytes = new Uint8Array(await tr.arrayBuffer());
                  const { alprFootageStillCloudflare } = await import('./footageAlpr');
                  await alprFootageStillCloudflare(env, db, ch.id, stillBytes, ch.cpg_device_id);
                }
              } else {
                // No still — try the chunk object (no-ops on video; reads image chunks).
                const { alprFootageChunk } = await import('./footageAlpr');
                await alprFootageChunk(env, db, ch.id, key, ch.cpg_device_id);
              }
              await execute(db, `UPDATE footage_chunks SET alpr_status='done' WHERE id=?`, ch.id);
            } catch (e) { console.error('[flexcam-alpr] failed:', (e as Error).message); }
          }
        } else if (ch.attempts + 1 >= maxAttempts) {
          await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
          missing++;
        } else {
          await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
        }
      } else if (ch.attempts + 1 >= maxAttempts) {
        // No clip available in this tick AND past the cap → give up.
        await execute(db, `UPDATE footage_chunks SET status='missing', updated_at=datetime('now') WHERE id=?`, ch.id);
        missing++;
      } else {
        await execute(db, `UPDATE footage_chunks SET attempts = attempts + 1, updated_at=datetime('now') WHERE id=?`, ch.id);
      }
    }
  }

  // Close any request whose chunks are all resolved (none still pending or
  // requested). Verdict policy (mirrors src/utils/footage/closeStatus.ts —
  // tested in tests/footageCloseStatus.test.ts):
  //   chunks_done == 0  AND  any missing → 'failed'   (Plan E — honest)
  //   chunks_done > 0   AND  any missing → 'partial'
  //   otherwise                           → 'complete'
  // Idempotent; catches requests whose last chunk resolved on an earlier tick
  // (not just this batch). IMPORTANT: block on BOTH 'pending_request' AND
  // 'requested' — if requestChunk failed for every chunk in a tick they stay
  // 'pending_request', and without this guard the close query would fire
  // immediately and mark the request 'complete' with zero clips downloaded.
  await execute(db, `
    UPDATE footage_requests
    SET status = CASE
          WHEN COALESCE(chunks_done,0) <= 0
               AND EXISTS (SELECT 1 FROM footage_chunks WHERE request_id = footage_requests.id AND status = 'missing')
            THEN 'failed'
          WHEN EXISTS (SELECT 1 FROM footage_chunks WHERE request_id = footage_requests.id AND status = 'missing')
            THEN 'partial'
          ELSE 'complete'
        END,
        updated_at = datetime('now')
    WHERE status IN ('queued','fulfilling')
      AND NOT EXISTS (
        SELECT 1 FROM footage_chunks
        WHERE request_id = footage_requests.id AND status IN ('pending_request','requested')
      )`).catch(() => {});
  return { downloaded, missing };
}

/** Detect footage_requests where the chunk rows in DB are fewer than chunk_count
 *  (truncated by a Worker timeout mid-insert) and create the missing pending_request rows.
 *  Safe to run every cron tick — INSERT OR IGNORE skips already-existing seqs. */
export async function resumeTruncatedRequests(env: Bindings): Promise<{ resumed: number; added: number }> {
  const db = getDb(env);
  const truncated = await query<{ id: number; from_ts: number; to_ts: number; chunk_count: number; actual: number }>(db, `
    SELECT rq.id, rq.from_ts, rq.to_ts, rq.chunk_count, COUNT(ch.id) AS actual
    FROM footage_requests rq
    LEFT JOIN footage_chunks ch ON ch.request_id = rq.id
    WHERE rq.status IN ('fulfilling','partial') AND rq.chunk_count > 0
    GROUP BY rq.id HAVING actual < rq.chunk_count LIMIT 5`,
  ).catch(() => []);
  if (!truncated.length) return { resumed: 0, added: 0 };

  let resumed = 0, added = 0;
  for (const rq of truncated) {
    const existingSeqs = new Set(
      (await query<{ seq: number }>(db, 'SELECT seq FROM footage_chunks WHERE request_id=?', rq.id).catch(() => []))
        .map((r) => r.seq),
    );
    // Reconstruct the channel list from existing chunks (mirrors enqueueFootage ordering).
    const chRows = await query<{ channel: string }>(db,
      'SELECT DISTINCT channel FROM footage_chunks WHERE request_id=?', rq.id).catch(() => []);
    const channels = chRows.map((r) => r.channel);
    if (!channels.length) channels.push('outside');

    const planned: Array<{ seq: number; fromTs: number; toTs: number; channel: string }> = [];
    for (const ch of channels) {
      for (const c of splitWindow(rq.from_ts, rq.to_ts, CHUNK_SECONDS)) {
        planned.push({ seq: planned.length, fromTs: c.fromTs, toTs: c.toTs, channel: ch });
      }
    }
    const missing = planned.filter((p) => !existingSeqs.has(p.seq));
    if (!missing.length) continue;

    // Re-open so the close-query in pollAndDownload doesn't immediately re-close it.
    await execute(db, `UPDATE footage_requests SET status='fulfilling', chunk_count=?, updated_at=datetime('now') WHERE id=?`,
      planned.length, rq.id).catch(() => {});

    const BATCH_SZ = 500;
    for (let i = 0; i < missing.length; i += BATCH_SZ) {
      await executeBatch(db, missing.slice(i, i + BATCH_SZ).map((h) => ({
        sql: `INSERT OR IGNORE INTO footage_chunks (request_id, seq, from_ts, to_ts, channel, status) VALUES (?, ?, ?, ?, ?, 'pending_request')`,
        bindings: [rq.id, h.seq, h.fromTs, h.toTs, h.channel],
      }))).catch(() => {});
      added += missing.slice(i, i + BATCH_SZ).length;
    }
    console.log(`[flexcam] resumed request ${rq.id}: added ${missing.length} missing chunks`);
    resumed++;
  }
  return { resumed, added };
}

/** Per-minute cron entry, throttled by a config flag. */
export async function maybeRunFootagePoll(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
  if (enabled?.config_value !== 'true') return;
  const req = await runRequestPass(env);
  const r = await pollAndDownload(env);
  if (req.requested || req.expired || r.downloaded || r.missing)
    console.log(`[flexcam] requested=${req.requested} expired_pending=${req.expired} downloaded=${r.downloaded} missing=${r.missing}`);
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
