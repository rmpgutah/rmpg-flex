// ============================================================
// RMPG Flex — Serve intake warrant + watchlist cross-check
// ============================================================
// Queries the internal warrants table and intel_watchlist for
// the person being served. On any hit: supervisor notifications
// + live emitAlert so dispatch consoles see the warning.
//
// Uses personId (from commitIntake CommitResult) when available
// for an exact FK match. Falls back to a name-join search when
// personId is null (e.g. duplicate-skip path).
//
// Called fire-and-forget from serveIntakeRecords.ts via a route's
// executionCtx.waitUntil() so it never blocks the intake response.
// Idempotent: a second call for the same queue_id is a no-op once
// serve_queue.intake_screened_at is set.
// ============================================================

import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';

export interface IntakeCheckResult {
  warrant_hits: number;
  watchlist_hits: number;
  skipped: boolean;
}

export async function serveIntakeWarrantCheck(
  env: Bindings,
  serveQueueId: number,
  recipientName: string,
  personId: number | null,
): Promise<IntakeCheckResult> {
  const db = env.DB;
  const result: IntakeCheckResult = { warrant_hits: 0, watchlist_hits: 0, skipped: false };

  try {
    // Idempotency: skip if we already screened this intake.
    const already = await queryFirst<{ intake_screened_at: string | null }>(
      db,
      'SELECT intake_screened_at FROM serve_queue WHERE id = ?',
      serveQueueId,
    ).catch(() => null);
    if (already?.intake_screened_at) return { ...result, skipped: true };

    // Warrant check: prefer person_id FK; fall back to name JOIN.
    let warrants: { id: number; warrant_number: string | null; charge: string | null }[] = [];
    if (personId) {
      warrants = await query<{ id: number; warrant_number: string | null; charge: string | null }>(
        db,
        `SELECT id, warrant_number, charge FROM warrants
          WHERE person_id = ? AND status NOT IN ('served','recalled','expired','cancelled')
          LIMIT 5`,
        personId,
      ).catch(() => []);
    }
    if (!warrants.length && recipientName.trim().length > 2) {
      // Name JOIN through persons: both last_name match and best-effort full match.
      warrants = await query<{ id: number; warrant_number: string | null; charge: string | null }>(
        db,
        `SELECT w.id, w.warrant_number, w.charge
           FROM warrants w
           JOIN persons p ON p.id = w.person_id
          WHERE (LOWER(p.last_name) LIKE LOWER(?) OR LOWER(p.full_name) LIKE LOWER(?))
            AND w.status NOT IN ('served','recalled','expired','cancelled')
          LIMIT 5`,
        `%${recipientName.split(' ').pop()?.replace(/%/g, '') ?? ''}%`,
        `%${recipientName.replace(/%/g, '')}%`,
      ).catch(() => []);
    }

    // Watchlist check via person_id FK only (watchlist uses entity_id not name).
    let watchlistHits: { id: number; entity_type: string; reason: string | null }[] = [];
    if (personId) {
      watchlistHits = await query<{ id: number; entity_type: string; reason: string | null }>(
        db,
        `SELECT id, entity_type, reason FROM intel_watchlist
          WHERE entity_type = 'person' AND entity_id = ? AND active = 1
          LIMIT 5`,
        personId,
      ).catch(() => []);
    }

    result.warrant_hits = warrants.length;
    result.watchlist_hits = watchlistHits.length;

    // Mark screened regardless of hits so we don't re-run on every status change.
    await execute(db,
      "UPDATE serve_queue SET intake_screened_at = datetime('now','localtime') WHERE id = ?",
      serveQueueId,
    ).catch(() => {});

    if (!warrants.length && !watchlistHits.length) return result;

    // Build hit summary for notifications.
    const parts: string[] = [];
    if (warrants.length) parts.push(`${warrants.length} active warrant(s)`);
    if (watchlistHits.length) parts.push(`${watchlistHits.length} watchlist entry(s)`);
    const hitSummary = parts.join(' + ');

    const firstCharge = warrants[0]?.charge ?? watchlistHits[0]?.reason ?? null;
    const chargeNote = firstCharge ? ` [${firstCharge}]` : '';

    // Notify supervisors.
    const supervisors = await query<{ id: number }>(
      db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') LIMIT 50",
    ).catch(() => []);

    for (const sup of supervisors) {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('serve_intake_hit', 'high', 'Serve intake — record hit', ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
        `${recipientName} has ${hitSummary}${chargeNote} — Job #${serveQueueId}`,
        serveQueueId, sup.id,
      );
    }

    await emitAlert(env, 'serve_intake_hit', {
      action: 'serve_intake_hit',
      queueId: serveQueueId,
      personId,
      recipientName,
      warrantHits: warrants.length,
      watchlistHits: watchlistHits.length,
      hitSummary,
      firstCharge,
      message: `Serve intake: ${recipientName} has ${hitSummary}${chargeNote} — Job #${serveQueueId}`,
    });
  } catch (err: any) {
    console.error(`[serve-intake-check] job ${serveQueueId}:`, err?.message);
  }

  return result;
}
