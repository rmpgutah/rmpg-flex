// ============================================================
// RMPG Flex — Serve Queue Completion → CFS Reverse Sync
//
// When a serve_queue job reaches a terminal outcome (served/failed),
// propagate the result back to the originating calls_for_service row.
//
// This mirrors the forward cross-link in psoServeCrosslink.ts (CFS
// close → serve_queue) — together they form a bidirectional bridge
// between the Dispatch and Process Server modules:
//
//   CFS close → psoServeCrosslink → serve_queue created/updated
//   serve_queue terminal → reversePsoSync → CFS PSO fields updated
//
// Fire-and-forget — callers should `await` but wrap in try/catch
// and never let an error here break the serve status update itself.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';

/** Result returned to the caller — surfaced in the serve response payload. */
export interface ReversePsoSyncResult {
  /** True when the CFS row was actually updated. */
  synced: boolean;
  /** The call_id on the serve_queue row (null if no call linked). */
  callId: number | null;
  /** The serve_queue row that triggered the sync. */
  serveQueueId: number;
  /** The serve_queue.status that was evaluated. */
  status: string | null;
  /** Reason the sync was skipped ("no_call_id", "non_terminal_status", …). */
  skipReason?: string;
}

/** serve_queue statuses that trigger a reverse write-back to CFS. */
const SYNC_TERMINAL = new Set(['served', 'failed']);

/**
 * Write serve job completion data back to the originating CFS call.
 *
 * Updates the overflow table `calls_for_service_ext` (safe from the
 * 100-column cap on the base table) with:
 *   - process_service_result, process_served_at
 *   - process_attempts, process_served_to, process_served_address
 *
 * Also mirrors key fields to the base `calls_for_service` table for
 * quick access in list queries and dashboard aggregations.
 */
export async function syncServeCompletionToCfs(
  db: D1Database,
  queueId: number | string,
  _options: { actorUserId?: number | null } = {},
): Promise<ReversePsoSyncResult> {
  // ── Step 1: load the queue row ────────────────────────────
  const queue = await db.prepare('SELECT * FROM serve_queue WHERE id = ?')
    .bind(Number(queueId))
    .first<Record<string, any>>();

  if (!queue) {
    return { synced: false, callId: null, serveQueueId: Number(queueId), status: null, skipReason: 'queue_not_found' };
  }

  // ── Step 2: skip if no call_id (standalone serve job) ─────
  if (!queue.call_id) {
    return { synced: false, callId: null, serveQueueId: Number(queueId), status: queue.status, skipReason: 'no_call_id' };
  }

  // ── Step 3: only sync terminal outcomes ───────────────────
  if (!SYNC_TERMINAL.has(queue.status)) {
    return { synced: false, callId: queue.call_id, serveQueueId: Number(queueId), status: queue.status, skipReason: 'non_terminal_status' };
  }

  // ── Step 4: verify the originating call still exists ──────
  const call = await db.prepare('SELECT id FROM calls_for_service WHERE id = ?')
    .bind(queue.call_id)
    .first<{ id: number }>();
  if (!call) {
    return { synced: false, callId: queue.call_id, serveQueueId: Number(queueId), status: queue.status, skipReason: 'call_not_found' };
  }

  // ── Step 5: update calls_for_service_ext (overflow table) ─
  // Safe from the 100-column cap on the base table.
  const resultLabel = queue.status === 'served' ? 'Served' : 'Failed';
  // Use the queue's own closed_at (stamped write-once at completion) rather
  // than wall-clock now — a fire-and-forget sync can run well after the event.
  const servedAt: string = queue.closed_at || queue.updated_at || new Date().toISOString();

  // Ext rows are created lazily — older calls may have no row yet.
  // Ensure one exists before the UPDATE so the write never silently no-ops.
  await db.prepare('INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)')
    .bind(queue.call_id)
    .run();

  await db.prepare(
    `UPDATE calls_for_service_ext SET
       process_service_result = ?,
       process_served_at = ?,
       process_attempts = ?,
       process_served_to = ?,
       process_served_address = ?
     WHERE id = ?`,
  ).bind(
    resultLabel,
    servedAt,
    queue.attempt_count ?? 0,
    queue.recipient_name ?? null,
    queue.recipient_address ?? null,
    queue.call_id,
  ).run();

  // ── Step 6: update base calls_for_service ─────────────────
  // Only fields that exist on the base table — avoids ALTER on
  // the near-cap table. The ext table carries the full detail.
  // Also transition the CFS status to cleared/closed so the dispatch
  // board reflects the serve outcome without manual dispatcher action.
  const cfsStatus = queue.status === 'served' ? 'cleared' : 'closed';
  const cfsDisposition = queue.status === 'served' ? 'Served' : 'Service Failed';
  await db.prepare(
    `UPDATE calls_for_service SET
       process_served_to = ?,
       process_served_address = ?,
       process_attempts = ?,
       status = CASE WHEN status IN ('pending','dispatched','enroute','onscene','on_hold') THEN ? ELSE status END,
       disposition = CASE WHEN disposition IS NULL OR disposition = '' THEN ? ELSE disposition END,
       cleared_at = CASE WHEN cleared_at IS NULL AND ? = 'cleared' THEN datetime('now') ELSE cleared_at END,
       closed_at = CASE WHEN closed_at IS NULL AND ? = 'closed' THEN datetime('now') ELSE closed_at END
     WHERE id = ?`,
  ).bind(
    queue.recipient_name ?? null,
    queue.recipient_address ?? null,
    queue.attempt_count ?? 0,
    cfsStatus,
    cfsDisposition,
    cfsStatus,
    cfsStatus,
    queue.call_id,
  ).run();

  return {
    synced: true,
    callId: queue.call_id,
    serveQueueId: Number(queueId),
    status: queue.status,
  };
}
