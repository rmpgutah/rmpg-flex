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
// Escalation cadence: level N means N full minutes unacknowledged —
// gated on elapsed time (not just "still active on this tick") so a
// brand-new alert isn't escalated on its very first cron pass. Capped
// at MAX_ESCALATION_LEVEL so a stuck/orphaned row doesn't re-broadcast
// forever with an ever-growing level and alert-fatigue dispatchers.
// Sent only to on-duty dispatch/command roles via sendToUser —
// broadcastAll would both duplicate the message to those same users
// AND blast it to every connected client (field officers, the officer
// in duress), which isn't the intent of a dispatcher/supervisor re-alert.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { sendToUser } from '../routes/ws';
import { emitAlert } from './alertHub';
import { parseD1TimestampMs } from './fleetio/sync';

const MAX_ESCALATION_LEVEL = 10;

interface ActivePanicRow {
  id: number;
  user_id: number;
  location_address: string | null;
  escalation_level: number;
  created_at: string;
}

export async function sweepPanicEscalation(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ escalated: number }> {
  const rows = await query<ActivePanicRow>(db,
    `SELECT id, user_id, location_address, escalation_level, created_at
     FROM panic_alerts WHERE status = 'active'`);

  if (rows.length === 0) return { escalated: 0 };

  const targets = await query<{ id: number }>(db,
    `SELECT id FROM users WHERE role IN ('dispatcher','supervisor','manager','admin') AND status = 'active'`);

  let escalated = 0;
  for (const row of rows) {
    if (row.escalation_level >= MAX_ESCALATION_LEVEL) continue;
    // created_at is a zone-less D1 datetime('now') (UTC); Date.parse reads it
    // as LOCAL time, skewing the age on any non-UTC host — use parseD1TimestampMs.
    const createdMs = parseD1TimestampMs(row.created_at);
    if (createdMs == null) continue;
    const minutesUnacked = Math.floor((Date.now() - createdMs) / 60000);
    // Level N corresponds to N minutes unacknowledged — only escalate once
    // a full additional minute has elapsed since the last level bump.
    if (minutesUnacked <= row.escalation_level) continue;

    const nextLevel = row.escalation_level + 1;
    await execute(db,
      `UPDATE panic_alerts SET escalation_level = MAX(escalation_level, ?), updated_at = datetime('now') WHERE id = ? AND status = 'active'`,
      nextLevel, row.id);

    const payload = {
      action: 'panic_escalated',
      panic_id: row.id,
      escalation_level: nextLevel,
      minutes_unacknowledged: minutesUnacked,
      location_address: row.location_address,
    };
    for (const t of targets) sendToUser(t.id, 'panic_alert', payload);
    // sendToUser only reaches sockets in THIS isolate — a cron isolate has
    // none, so the re-alert was invisible. AlertHubDO is the cross-isolate
    // fan-out every connected console/MDT actually hears.
    if (env) await emitAlert(env, 'panic_alert', payload);
    escalated++;
  }
  return { escalated };
}
