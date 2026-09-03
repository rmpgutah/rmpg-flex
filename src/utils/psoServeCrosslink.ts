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
import { queryFirst, query, queryInChunks, execute, columnExists } from './db';
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
const TERMINAL_QUEUE_STATUSES = new Set(['served', 'failed', 'cancelled', 'skipped', 'archived', 'unable']);
const MAX_CHAIN_WALK = 24;

function asPositiveId(value: unknown): number | null {
  const n = Number(value);
  return n && Number.isFinite(n) ? n : null;
}

/**
 * All CFS ids in a return-visit family: walk parent_call_id to the root,
 * then collect every child that points at any id already in the set.
 * Redispatch stores parent_call_id on the ROOT (flat chain), but this also
 * handles a linked-list of parents.
 */
export async function collectCallChainIds(
  db: D1Database,
  callId: number | string,
): Promise<number[]> {
  const start = asPositiveId(callId);
  if (!start) return [];

  const seen = new Set<number>([start]);
  let current: number | null = start;
  for (let i = 0; i < MAX_CHAIN_WALK && current; i++) {
    const ext = await queryFirst<{ parent_call_id: number | null }>(
      db, 'SELECT parent_call_id FROM calls_for_service_ext WHERE id = ?', current,
    ).catch(() => null);
    const parent = asPositiveId(ext?.parent_call_id);
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    current = parent;
  }

  let frontier = [...seen];
  for (let guard = 0; guard < MAX_CHAIN_WALK && frontier.length; guard++) {
    const children = await queryInChunks<{ id: number }>(
      db,
      frontier,
      (ph) => `SELECT id FROM calls_for_service_ext WHERE parent_call_id IN (${ph})`,
    ).catch(() => [] as { id: number }[]);
    const next: number[] = [];
    for (const row of children) {
      const cid = asPositiveId(row.id);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      next.push(cid);
    }
    frontier = next;
  }

  return [...seen];
}

/**
 * Find the linked serve_queue row for a call ID.
 * Searches the whole return-visit chain so a job whose call_id was moved
 * onto the latest visit still resolves from the original CFS (and vice versa).
 */
export async function findServeJobForCall(
  db: D1Database,
  callId: number | string,
): Promise<Record<string, any> | null> {
  const numId = asPositiveId(callId);
  if (!numId) return null;

  const direct = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM serve_queue WHERE call_id = ?', numId,
  );
  if (direct) return direct;

  const ids = await collectCallChainIds(db, numId);
  if (ids.length === 0) return null;
  const jobs = await queryInChunks<Record<string, any>>(
    db,
    ids,
    (ph) => `SELECT * FROM serve_queue WHERE call_id IN (${ph}) ORDER BY id ASC`,
  ).catch(() => [] as Record<string, any>[]);
  if (!jobs.length) return null;
  return jobs.find((j) => asPositiveId(j.call_id) === numId) || jobs[0];
}

export interface ServeJobRelinkResult {
  queueId: number | null;
  relinked: boolean;
  created: boolean;
}

/**
 * Point the existing Process Server job at a new return-visit CFS.
 * Never inserts a second serve_queue row when a job already exists on the chain.
 * If the chain has no job yet (PSO-only, never intaken), seeds one so Process
 * Server still sees the active visit.
 */
export async function relinkServeJobForRedispatch(
  db: D1Database,
  previousCallId: number,
  newCallId: number,
  newCallNumber?: string | null,
): Promise<ServeJobRelinkResult> {
  const prev = asPositiveId(previousCallId);
  const next = asPositiveId(newCallId);
  if (!prev || !next) return { queueId: null, relinked: false, created: false };

  const existing = await findServeJobForCall(db, prev);
  if (existing) {
    const extra = `[Return visit ${newCallNumber || `CFS ${next}`}]`;
    const prevNotes = String(existing.notes || '').trim();
    const notes = (prevNotes.includes(extra) ? prevNotes : (prevNotes ? `${prevNotes}\n${extra}` : extra)).slice(0, 4000);
    const priorStatus = String(existing.status || 'pending');
    const reopen = TERMINAL_QUEUE_STATUSES.has(priorStatus)
      ? ((Number(existing.attempt_count) || 0) > 0 ? 'attempted' : 'pending')
      : priorStatus;
    try {
      await execute(
        db,
        `UPDATE serve_queue SET call_id = ?, status = ?, closed_at = NULL, notes = ?, updated_at = datetime('now') WHERE id = ?`,
        next, reopen, notes, existing.id,
      );
    } catch {
      await execute(
        db,
        `UPDATE serve_queue SET call_id = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
        next, reopen, notes, existing.id,
      );
    }
    return { queueId: Number(existing.id), relinked: true, created: false };
  }

  return { queueId: null, relinked: false, created: false };
}

/**
 * After undoing a pending return visit, move the Process Server job back onto
 * the remaining CFS. Never DELETE the original job — a prior implementation
 * deleted `serve_queue WHERE call_id = child`, which destroyed the job after
 * relink. Legacy duplicate rows (job on both child and restore target) drop
 * only the child copy.
 */
export async function restoreServeJobAfterUndoRedispatch(
  db: D1Database,
  childCallId: number,
  restoreCallId: number,
): Promise<{ queueId: number | null; restored: boolean; deletedDuplicate: boolean }> {
  const childId = asPositiveId(childCallId);
  const restoreId = asPositiveId(restoreCallId);
  if (!childId || !restoreId) return { queueId: null, restored: false, deletedDuplicate: false };

  const onChild = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM serve_queue WHERE call_id = ? ORDER BY id ASC LIMIT 1', childId,
  );
  if (!onChild) return { queueId: null, restored: false, deletedDuplicate: false };

  const onRestore = await queryFirst<Record<string, any>>(
    db, 'SELECT * FROM serve_queue WHERE call_id = ? ORDER BY id ASC LIMIT 1', restoreId,
  );
  if (onRestore && Number(onRestore.id) !== Number(onChild.id)) {
    await execute(db, 'DELETE FROM serve_queue WHERE id = ?', onChild.id);
    return { queueId: Number(onRestore.id), restored: false, deletedDuplicate: true };
  }

  await execute(
    db,
    `UPDATE serve_queue SET call_id = ?, updated_at = datetime('now') WHERE id = ?`,
    restoreId, onChild.id,
  );
  return { queueId: Number(onChild.id), restored: true, deletedDuplicate: false };
}

/** Latest remaining CFS in a return-visit family, excluding an undone child. */
export async function findRestoreCallIdForUndoRedispatch(
  db: D1Database,
  childCallId: number,
  rootCallId: number,
): Promise<number> {
  const childId = asPositiveId(childCallId);
  const rootId = asPositiveId(rootCallId);
  if (!rootId) return childId || 0;
  const row = await queryFirst<{ id: number }>(
    db,
    `SELECT c.id FROM calls_for_service c
     LEFT JOIN calls_for_service_ext e ON e.id = c.id
     WHERE c.id != ? AND (c.id = ? OR e.parent_call_id = ?)
     ORDER BY COALESCE(c.pso_attempt_number, 0) DESC, c.id DESC
     LIMIT 1`,
    childId ?? 0, rootId, rootId,
  ).catch(() => null);
  return asPositiveId(row?.id) || rootId;
}

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
  const PSO_TYPES = new Set(['pso_client_request', 'process_service', 'civil_paper_service']);
  if (!PSO_TYPES.has(call.incident_type)) return { ...empty, skipReason: 'not_pso' };
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
  // Resolves parent_call_id so reattempts stay linked to the SAME Job ID!
  let queueRow = await findServeJobForCall(db, callId);
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
         client_id, priority, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'pending', ?, datetime('now'), datetime('now'))`,
      callId, merged.officer_id ?? options.actorUserId ?? null, options.actorUserId ?? null,
      recipientName, recipientAddress,
      merged.latitude ?? null, merged.longitude ?? null,
      documentType, caseNumber, clientName,
      merged.client_id ?? null,
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
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
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
