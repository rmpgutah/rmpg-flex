// ============================================================
// RMPG Flex — Intel retention sweep (28 CFR Part 23-style).
// Flips disseminated reports past their review_date to 'due_review'
// and raises a deduped anomaly_alert. Naturally idempotent: once a
// report is 'due_review' it no longer matches the active filter.
// ============================================================
import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';

export async function sweepRetention(db: D1Database): Promise<number> {
  let flagged = 0;
  let due: any[] = [];
  try {
    due = await query<any>(db,
      `SELECT id, report_number, title FROM intel_reports
       WHERE retention_status = 'active' AND review_date IS NOT NULL
         AND review_date <= date('now') AND status NOT IN ('rejected','purged')
       LIMIT 200`);
  } catch { return 0; } // table not on this DB yet — no-op
  for (const r of due) {
    try {
      await execute(db,
        `UPDATE intel_reports SET retention_status='due_review', updated_at=datetime('now') WHERE id = ?`, r.id);
      await execute(db,
        `INSERT OR IGNORE INTO anomaly_alerts (alert_type, severity, title, details, dedup_key, created_at, updated_at)
         VALUES ('intel_retention_due', 'low', ?, ?, ?, datetime('now'), datetime('now'))`,
        `Intel review due: ${r.report_number || r.id}`,
        JSON.stringify({ report_id: r.id, title: r.title }),
        `intel_retention:${r.id}`);
      flagged++;
    } catch (e: any) { log.error('[intel-retention] flag failed', { error: e?.message }); }
  }
  return flagged;
}
