// ============================================================
// RMPG Flex — PSO CFS-Close → Process-Server Cross-Link
//
// When a CFS with incident_type='pso_client_request' transitions to a
// terminal status (cleared / closed / cancelled), this helper:
//
//   1. Finds or creates the linked serve_queue row (dedup on call_id).
//   2. Logs a serve_attempts row reflecting the close — disposition code
//      derived from the CFS disposition field via dispositionToCode().
//   3. Updates serve_queue.attempt_count + status based on the code's
//      queueOutcome (served / attempted / failed / pending).
//
// The helper is idempotent: re-running it for the same call won't
// duplicate the attempt log (it checks for a same-disposition row created
// within the last 60 seconds). All writes are best-effort — a failure
// here must NEVER fail the underlying CFS status transition.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute, columnExists } from './db';
import {
  dispositionToCode,
  codeToLegacyResult,
  codeToQueueStatus,
  type QueueStatus,
} from './processServiceCodes';

/** Result returned to the caller — surfaced in the status response payload. */
export interface PsoCrosslinkResult {
  queueId: number | null;
  queueCreated: boolean;
  attemptId: number | null;
  attemptNumber: number | null;
  dispositionCode: string | null;
  queueStatus: QueueStatus | null;
  /** True when the helper short-circuited because the call wasn't PSO. */
  skipped: boolean;
  /** Reason for skip ("not_pso", "non_terminal_status", "no_disposition", ...). */
  skipReason?: string;
}

const TERMINAL_STATUSES = new Set(['cleared', 'closed', 'cancelled']);

/**
 * Mirror a PSO CFS close into the Process Server queue. Fire-and-forget —
 * callers should `await` but wrap in try/catch and never let an error here
 * break the call transition itself.
 */
export async function crossLinkPsoCloseToServe(
  db: D1Database,
  callId: number | string,
  options: { actorUserId?: number | null } = {},
): Promise<PsoCrosslinkResult> {
  const empty: PsoCrosslinkResult = {
    queueId: null, queueCreated: false, attemptId: null, attemptNumber: null,
    dispositionCode: null, queueStatus: null, skipped: true,
  };

  const call = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM calls_for_service WHERE id = ?', callId,
  );
  if (!call) return { ...empty, skipReason: 'call_not_found' };
  if (call.incident_type !== 'pso_client_request') return { ...empty, skipReason: 'not_pso' };
  if (!TERMINAL_STATUSES.has(String(call.status))) return { ...empty, skipReason: 'non_terminal_status' };

  // Ext row carries the PSO/process-service fields that overflow past the
  // 100-col cap on calls_for_service. Read both and merge for the seed data.
  const ext = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', callId,
  ).catch(() => null);
  const merged: Record<string, any> = { ...(call || {}), ...(ext || {}) };

  // Disposition → structured code. Both must be present; if there's no
  // disposition we have nothing to log on the attempts side.
  const disposition = (merged.disposition || '').trim();
  if (!disposition) return { ...empty, skipReason: 'no_disposition' };
  const code = dispositionToCode(disposition) || 'PS/00.99';
  const legacyResult = codeToLegacyResult(code);
  const queueOutcome = codeToQueueStatus(code);

  // ── Step 1: find or create the serve_queue row ──────────────────────
  let queueRow = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM serve_queue WHERE call_id = ?', callId,
  );
  let queueCreated = false;
  if (!queueRow) {
    // Seed from the call. Address / lat / lng are the load-bearing pieces;
    // recipient name, document type, court case all come from the PSO ext
    // fields when present, with sensible fallbacks otherwise.
    const recipientName = merged.process_served_to || merged.pso_requestor_name || 'Recipient on file';
    const recipientAddress = merged.process_served_address || merged.location_address || merged.location || null;
    const documentType = merged.process_service_type || merged.pso_service_type || 'Legal Documents';
    const clientName = merged.client_name || merged.pso_requestor_name || null;
    const caseNumber = merged.process_case_number || null;

    const ins = await execute(
      db,
      `INSERT INTO serve_queue (
         call_id, officer_id, created_by, recipient_name, recipient_address,
         recipient_lat, recipient_lng, document_type, case_number, client_name,
         priority, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'pending', ?, datetime('now','localtime'), datetime('now','localtime'))`,
      callId, merged.officer_id ?? options.actorUserId ?? null, options.actorUserId ?? null,
      recipientName, recipientAddress,
      merged.latitude ?? null, merged.longitude ?? null,
      documentType, caseNumber, clientName,
      `Auto-created from CFS ${merged.call_number || `#${callId}`} on close (${code})`,
    );
    queueCreated = true;
    queueRow = await queryFirst<Record<string, any>>(
      db, 'SELECT * FROM serve_queue WHERE id = ?', ins.meta.last_row_id,
    );
  }
  if (!queueRow) return { ...empty, skipReason: 'queue_seed_failed' };

  // ── Step 2: idempotency guard ───────────────────────────────────────
  // If a same-code attempt was already logged for this queue within the
  // last 60 seconds, skip — likely a double-firing close handler.
  const dupe = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM serve_attempts
       WHERE serve_queue_id = ?
         AND result = ?
         AND attempt_at >= datetime('now', '-60 seconds')
       ORDER BY id DESC LIMIT 1`,
    queueRow.id, legacyResult,
  ).catch(() => null);
  if (dupe) {
    return {
      queueId: Number(queueRow.id),
      queueCreated,
      attemptId: dupe.id,
      attemptNumber: null,
      dispositionCode: code,
      queueStatus: queueOutcome,
      skipped: true,
      skipReason: 'duplicate_within_60s',
    };
  }

  // ── Step 3: log the attempt ─────────────────────────────────────────
  const nextNum = (Number(queueRow.attempt_count) || 0) + 1;
  const hasDispositionCol = await columnExists(db, 'serve_attempts', 'disposition_code');
  const notes = `[CFS ${merged.call_number || `#${callId}`} auto-close] ${disposition}`;
  const ins = hasDispositionCol
    ? await execute(
        db,
        `INSERT INTO serve_attempts (
           serve_queue_id, attempt_number, officer_id, result, disposition_code,
           latitude, longitude, notes, attempt_type
         ) VALUES (?,?,?,?,?, ?,?,?,?)`,
        queueRow.id, nextNum, merged.officer_id ?? options.actorUserId ?? null, legacyResult, code,
        merged.latitude ?? null, merged.longitude ?? null, notes,
        queueOutcome === 'served' ? 'personal' : 'failed',
      )
    : await execute(
        db,
        `INSERT INTO serve_attempts (
           serve_queue_id, attempt_number, officer_id, result,
           latitude, longitude, notes, attempt_type
         ) VALUES (?,?,?,?, ?,?,?,?)`,
        queueRow.id, nextNum, merged.officer_id ?? options.actorUserId ?? null, legacyResult,
        merged.latitude ?? null, merged.longitude ?? null, notes,
        queueOutcome === 'served' ? 'personal' : 'failed',
      );

  // ── Step 4: update the queue's attempt counter + status ─────────────
  // Mirror the logic from serve.ts logAttempt's queue update so the queue
  // stays consistent with the attempt history. The structured code wins.
  let newStatus = String(queueRow.status || 'pending');
  if (queueOutcome === 'served' || queueOutcome === 'failed') newStatus = queueOutcome;
  else if (queueOutcome === 'pending') newStatus = 'pending';
  else newStatus = nextNum >= (Number(queueRow.max_attempts) || 3) ? 'failed' : 'attempted';

  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    nextNum, newStatus, queueRow.id,
  );

  return {
    queueId: Number(queueRow.id),
    queueCreated,
    attemptId: Number(ins.meta.last_row_id),
    attemptNumber: nextNum,
    dispositionCode: code,
    queueStatus: queueOutcome,
    skipped: false,
  };
}
