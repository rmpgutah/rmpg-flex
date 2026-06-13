// ============================================================
// RMPG Flex — overdue-on-foot safety sweep (per-minute cron)
// ============================================================
// Finds units that have been on foot past the threshold without
// returning to their vehicle, raises an officer-safety alert via
// AlertHub, and marks the unit alerted (re-armed on the next
// ON_FOOT transition by runOnFootTransition).

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { emitAlert } from './alertHub';

export const ON_FOOT_OVERDUE_MS = 5 * 60_000;

export interface OnFootRow {
  id: number;
  call_sign: string;
  officer_name: string | null;
  on_foot_since: string | null; // UTC 'YYYY-MM-DD HH:MM:SS'
  on_foot_alerted: number;
  latitude: number | null;
  longitude: number | null;
}

/** Pure: which rows are overdue as of nowMs. */
export function findOverdueOnFoot(rows: OnFootRow[], nowMs: number, thresholdMs = ON_FOOT_OVERDUE_MS): OnFootRow[] {
  return rows.filter((r) => {
    if (r.on_foot_alerted) return false;
    if (!r.on_foot_since) return false;
    const t = Date.parse(r.on_foot_since.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return false;
    return nowMs - t >= thresholdMs;
  });
}

interface SweepEnv { ALERT_HUB?: DurableObjectNamespace }

export async function sweepOnFootOverdue(db: D1Database, env: SweepEnv): Promise<number> {
  const rows = await query<OnFootRow>(db, `
    SELECT u.id, u.call_sign, usr.full_name AS officer_name,
           u.on_foot_since, u.on_foot_alerted, u.latitude, u.longitude
    FROM units u LEFT JOIN users usr ON usr.id = u.officer_id
    WHERE u.on_foot = 1 AND u.on_foot_alerted = 0`);
  const overdue = findOverdueOnFoot(rows, Date.now());
  for (const r of overdue) {
    const mins = Math.round((Date.now() - Date.parse(r.on_foot_since!.replace(' ', 'T') + 'Z')) / 60_000);
    await emitAlert(env, 'officer_on_foot_overdue', {
      action: 'on_foot_overdue',
      call_sign: r.call_sign,
      officer_name: r.officer_name,
      minutes: mins,
      on_foot_since: r.on_foot_since,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    await execute(db, 'UPDATE units SET on_foot_alerted = 1 WHERE id = ?', r.id);
  }
  return overdue.length;
}
