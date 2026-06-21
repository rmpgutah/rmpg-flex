// src/utils/footage/queueDrainRunner.ts
//
// D1-touching wrapper around the pure helpers in queueDrain.ts. Two passes:
//
//   1. Stale-request sweep — mark 'fulfilling'/'partial' requests with no
//      progress in N hours as 'failed' (zero downloads) or 'partial' (some
//      downloads); flip their leftover 'pending_request'/'requested' chunks to
//      'missing' so the cron's per-tick budget stops being eaten by them.
//
//   2. Duplicate prune — for each request, keep the lowest-seq instance of
//      each source_url; mark the rest 'missing' (NULL r2_key, NULL source_url)
//      so the player timeline stops looping identical bytes.
//
// Both passes are idempotent and bounded — safe to run from a cron tick AND
// from a one-shot admin endpoint without risk of touching evidence-locked
// rows (they're filtered out).

import { getDb, query, queryFirst, execute } from '../db';
import { evaluateStaleRequest, pickDuplicatesToPrune } from './queueDrain';
import type { Bindings } from '../../types';

export interface DrainOptions {
  /** If true, plan the work but do not write. */
  dryRun?: boolean;
  /** Threshold in hours past which a stalled request is bailed out. Default 6. */
  staleHours?: number;
  /** Cap on requests inspected in one pass. Default 50 (cron-safe). */
  limit?: number;
}

export interface DrainResult {
  inspected_requests: number;
  requests_failed: number;
  requests_partialed: number;
  chunks_to_missing: number;
  duplicates_pruned: number;
  dry_run: boolean;
  stale_hours: number;
}

interface RequestRow {
  id: number;
  status: string;
  updated_at: string;
  chunk_count: number;
  chunks_done: number;
  evidence_locked: number | null;
}

interface ChunkRow {
  id: number;
  seq: number;
  source_url: string | null;
  status: string;
  r2_key: string | null;
}

export async function runQueueDrain(env: Bindings, opts: DrainOptions = {}): Promise<DrainResult> {
  const db = getDb(env);
  const dryRun = !!opts.dryRun;
  const staleHours = Number.isFinite(opts.staleHours) ? Math.max(1, opts.staleHours!) : 6;
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, opts.limit!)) : 50;
  const staleThresholdMs = staleHours * 60 * 60 * 1000;
  const nowMs = Date.now(); // new-date-ok

  // Evidence-locked rows are off-limits — even a "stale" locked request is
  // not safe to flip. The column may not exist on every install (Phase-2
  // evidence migration), so COALESCE the missing-column case to 0.
  const reqs = await query<RequestRow>(db,
    `SELECT id, status, updated_at, chunk_count, chunks_done,
            COALESCE(evidence_locked, 0) AS evidence_locked
       FROM footage_requests
      WHERE status IN ('fulfilling','partial')
        AND COALESCE(evidence_locked, 0) = 0
      ORDER BY updated_at ASC
      LIMIT ?`, limit,
  ).catch(() => [] as RequestRow[]);

  let requestsFailed = 0;
  let requestsPartialed = 0;
  let chunksToMissing = 0;
  let duplicatesPruned = 0;

  for (const r of reqs) {
    // SQLite datetime('now') strings are 'YYYY-MM-DD HH:MM:SS' UTC; Date.parse
    // accepts that form (treated as local on some hosts; append Z for UTC).
    const updatedAtMs = Date.parse(r.updated_at.replace(' ', 'T') + 'Z');
    const verdict = evaluateStaleRequest({
      status: r.status, updatedAtMs,
      chunkCount: r.chunk_count, downloadedCount: r.chunks_done,
    }, nowMs, staleThresholdMs);
    if (verdict) {
      if (!dryRun) {
        await execute(db,
          `UPDATE footage_requests SET status=?, updated_at=datetime('now') WHERE id=? AND COALESCE(evidence_locked,0)=0`,
          verdict.next, r.id).catch(() => null);
        // Any leftover non-terminal chunks → missing so the per-tick poll
        // budget stops being burned on them.
        const upd = await execute(db,
          `UPDATE footage_chunks SET status='missing', updated_at=datetime('now')
             WHERE request_id=? AND status IN ('pending_request','requested')`, r.id).catch(() => null);
        chunksToMissing += upd?.meta?.changes ?? 0;
      }
      if (verdict.next === 'failed') requestsFailed++; else requestsPartialed++;
      console.log(`[flexcam-drain] req=${r.id} ${verdict.next} (${verdict.reason})`);
      continue; // a stale request's dupes don't matter; we just nuked its chunks
    }

    // Duplicate prune — only for requests that have downloaded clips.
    if (r.chunks_done > 1) {
      const chs = await query<ChunkRow>(db,
        `SELECT id, seq, source_url, status, r2_key FROM footage_chunks WHERE request_id=? ORDER BY seq`, r.id,
      ).catch(() => [] as ChunkRow[]);
      const { prune } = pickDuplicatesToPrune(chs);
      if (prune.length) {
        duplicatesPruned += prune.length;
        if (!dryRun) {
          // Mark dup chunks missing (player skips), null out r2_key + source_url.
          // We DON'T delete the R2 object — the unique kept chunk shares the
          // same bytes; deleting would orphan the kept row's playback.
          for (const id of prune) {
            await execute(db,
              `UPDATE footage_chunks
                  SET status='missing', r2_key=NULL, source_url=NULL,
                      updated_at=datetime('now')
                WHERE id=?`, id).catch(() => null);
          }
          // Decrement the request's chunks_done so the chunks_done==chunk_count
          // close-query doesn't fire on a stale count.
          await execute(db,
            `UPDATE footage_requests
                SET chunks_done = MAX(0, chunks_done - ?),
                    updated_at=datetime('now')
              WHERE id=?`, prune.length, r.id).catch(() => null);
        }
        console.log(`[flexcam-drain] req=${r.id} pruned ${prune.length} duplicate chunk(s)`);
      }
    }
  }

  return {
    inspected_requests: reqs.length,
    requests_failed: requestsFailed,
    requests_partialed: requestsPartialed,
    chunks_to_missing: chunksToMissing,
    duplicates_pruned: duplicatesPruned,
    dry_run: dryRun,
    stale_hours: staleHours,
  };
}

/** Cron-tick entry. Bounded, idempotent, eats its own errors. Defaults: 6h
 *  stale threshold, 50 requests/tick. Skips when the kill-switch is set
 *  (system_config integrations.flexcam_drain_enabled = 'false'). */
export async function maybeRunQueueDrain(env: Bindings): Promise<DrainResult | null> {
  const db = getDb(env);
  const kill = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_drain_enabled' AND category='integrations' AND is_active=1 LIMIT 1",
  ).catch(() => null);
  if (kill?.config_value === 'false') return null;
  return runQueueDrain(env, {}).catch((e) => {
    console.error('[flexcam-drain] cron failed:', (e as Error).message);
    return null as unknown as DrainResult;
  });
}
