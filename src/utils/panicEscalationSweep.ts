// ============================================================
// Panic Alert Escalation Sweep
// ============================================================
// src/routes/dispatch/panic.ts's own header comment flags this as a
// known gap: the `escalation_level` column exists but nothing ever
// advanced it or re-broadcast an unacknowledged panic alert — an
// officer's duress button goes silent after the first broadcast if no
// dispatcher acknowledges it. Runs off the existing per-minute cron
// (simpler than a new Durable Object Alarm the original comment
// suggested, and this infra is already proven for other sweeps).
//
// Escalation: every full minute an active, unacknowledged alert stays
// unacknowledged, bump escalation_level by 1 and re-broadcast with
// increasing urgency in the message. Idempotent per-run (only touches
// rows still status='active'), so a missed/delayed cron tick just
// catches up next minute with no double-counting risk beyond the
// normal 1-level-per-minute cadence.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { sendToUser, broadcastAll } from '../routes/ws';

interface ActivePanicRow {
  id: number;
  user_id: number;
  location_address: string | null;
  escalation_level: number;
  created_at: string;
}

export async function sweepPanicEscalation(db: D1Database): Promise<{ escalated: number }> {
  const rows = await query<ActivePanicRow>(db,
    `SELECT id, user_id, location_address, escalation_level, created_at
     FROM panic_alerts WHERE status = 'active'`);

  if (rows.length === 0) return { escalated: 0 };

  const targets = await query<{ id: number }>(db,
    `SELECT id FROM users WHERE role IN ('dispatcher','supervisor','manager','admin') AND status = 'active'`);

  let escalated = 0;
  for (const row of rows) {
    const nextLevel = row.escalation_level + 1;
    await execute(db,
      `UPDATE panic_alerts SET escalation_level = ?, updated_at = datetime('now') WHERE id = ? AND status = 'active'`,
      nextLevel, row.id);

    const minutesUnacked = Math.max(1, Math.round((Date.now() - Date.parse(row.created_at)) / 60000));
    const payload = {
      action: 'panic_escalated',
      panic_id: row.id,
      escalation_level: nextLevel,
      minutes_unacknowledged: minutesUnacked,
      location_address: row.location_address,
    };
    broadcastAll('panic_alert', payload);
    for (const t of targets) sendToUser(t.id, 'panic_alert', payload);
    escalated++;
  }
  return { escalated };
}
