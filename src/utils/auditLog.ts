// ============================================================
// RMPG Flex — central audit seam (audit_log + analytics lakehouse)
// ============================================================
// The codebase historically inlined `INSERT INTO audit_log (...)` at ~49 sites.
// recordAudit() is the single seam that (1) writes the audit_log row and
// (2) mirrors the event to the flex_events analytics lakehouse, so every
// auditable action becomes queryable history with no per-site analytics code.
//
// Safety:
//  • The INSERT uses ONLY the proven column set (user_id, action, entity_type,
//    entity_id, details, created_at) — NOT ip_address, which isn't guaranteed
//    present on live D1 (see the schema-drift notes in CLAUDE.md). Callers that
//    care about IP fold it into `details`.
//  • The INSERT is wrapped in try/catch and the analytics emit is fire-and-forget
//    (waitUntil) — audit must NEVER break the request it describes. This matches
//    the best-effort stance every inline site already had.
// ============================================================
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, execute } from './db';
import { emitAnalytics, flexEvent } from './analytics';

export interface AuditEntry {
  /** What happened, e.g. 'STATUS_CHANGE' | 'ALPR_VERIFY' | 'welfare_ack'. */
  action: string;
  /** The kind of record acted on, e.g. 'call' | 'alpr_capture' | 'user'. */
  entityType: string;
  /** The record id (number or string), or null/0 for bulk/system actions. */
  entityId?: number | string | null;
  /** Free text or any JSON-serialisable object (stringified). */
  details?: unknown;
  /** Acting user; defaults to the authenticated `c.get('userId')`. */
  actorId?: number | null;
  /** Override the audit_log created_at (ISO/SQL datetime). Defaults to now.
   *  Supports backfilled timeline entries (e.g. dispatch timeline notes). */
  createdAt?: string | null;
}

/** Write an audit_log row AND mirror it to flex_events. Never throws. */
export async function recordAudit(c: Context<Env>, e: AuditEntry): Promise<void> {
  const db = getDb(c.env);
  const actorId = e.actorId ?? (c.get('userId') as number | undefined) ?? null;
  const entityId = e.entityId ?? null;
  const createdAt = e.createdAt ?? null;
  const details = e.details == null
    ? null
    : typeof e.details === 'string' ? e.details : JSON.stringify(e.details);
  try {
    await execute(
      db,
      // COALESCE lets a caller backfill created_at (timeline notes); else now().
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      actorId, e.action, e.entityType, entityId, details, createdAt,
    );
  } catch (err) {
    console.warn('[audit] insert failed:', err instanceof Error ? err.message : String(err));
  }
  emitAnalytics(c, c.env.EVENTS, [flexEvent({
    event_type: 'audit', occurred_at: createdAt ?? new Date().toISOString(),
    actor_id: actorId, entity_type: e.entityType, entity_id: entityId,
    label: e.action, category: 'audit',
    payload: details ? { details: details.slice(0, 2000) } : null,
  })]);
}
