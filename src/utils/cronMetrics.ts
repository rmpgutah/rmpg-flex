// ============================================================
// RMPG Flex — Cron sweep monitoring + dashboard metrics
// ============================================================
// Tracks per-sweep execution times, error counts, success rates
// for the per-minute and per-4-hour cron handlers. Powers admin
// dashboard tiles + anomaly detection when a sweep hangs/fails.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from './db';

export interface CronSweepMetric {
  sweep_name: string;
  last_run_at: string;
  duration_ms: number;
  items_processed: number;
  items_alerted: number;
  error: string | null;
  error_count_today: number;
  success_rate_pct: number;
}

// Record a completed sweep with metrics
export async function recordCronSweep(
  db: D1Database,
  sweepName: string,
  durationMs: number,
  itemsProcessed: number,
  itemsAlerted: number = 0,
  error: string | null = null,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO cron_sweep_metrics
         (sweep_name, last_run_at, duration_ms, items_processed, items_alerted, error)
       VALUES (?, datetime('now','localtime'), ?, ?, ?, ?)`,
      sweepName,
      durationMs,
      itemsProcessed,
      itemsAlerted,
      error,
    );
  } catch (err) {
    // Metrics table may not exist — don't fail the actual sweep
    console.warn(`[cron-metrics] failed to record ${sweepName}:`, (err as Error).message);
  }
}

// Get dashboard summary for a sweep
export async function getCronSweepSummary(
  db: D1Database,
  sweepName: string,
): Promise<CronSweepMetric | null> {
  try {
    const result = await queryFirst<any>(
      db,
      `SELECT sweep_name, last_run_at, duration_ms, items_processed, items_alerted,
              error, 
              (SELECT COUNT(*) FROM cron_sweep_metrics WHERE sweep_name = ? AND error IS NOT NULL AND last_run_at > datetime('now','-1 day')) AS error_count_today,
              ROUND(100.0 * (SELECT COUNT(*) FROM cron_sweep_metrics WHERE sweep_name = ? AND error IS NULL AND last_run_at > datetime('now','-7 days')) / 
                    GREATEST((SELECT COUNT(*) FROM cron_sweep_metrics WHERE sweep_name = ? AND last_run_at > datetime('now','-7 days')), 1)) AS success_rate_pct
       FROM cron_sweep_metrics
       WHERE sweep_name = ?
       ORDER BY last_run_at DESC
       LIMIT 1`,
      sweepName, sweepName, sweepName, sweepName,
    );
    return result ?? null;
  } catch {
    return null;
  }
}

// Get all sweep summaries (admin dashboard)
export async function getAllCronSweepSummaries(
  db: D1Database,
): Promise<CronSweepMetric[]> {
  try {
    const results = await queryFirst<any>(
      db,
      `SELECT DISTINCT sweep_name FROM cron_sweep_metrics WHERE last_run_at > datetime('now','-1 day')`,
    );
    
    if (!results) return [];
    
    const summaries: CronSweepMetric[] = [];
    // Fetch summary for each unique sweep
    const sweeps = new Set<string>();
    const rows = await db.prepare(
      `SELECT DISTINCT sweep_name FROM cron_sweep_metrics WHERE last_run_at > datetime('now','-1 day')`
    ).all<{ sweep_name: string }>();
    
    for (const row of rows.results) {
      const summary = await getCronSweepSummary(db, row.sweep_name);
      if (summary) summaries.push(summary);
    }
    return summaries;
  } catch {
    return [];
  }
}

// Initialize metrics table (idempotent)
export async function ensureCronMetricsSchema(db: D1Database): Promise<void> {
  try {
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS cron_sweep_metrics (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sweep_name TEXT NOT NULL,
         last_run_at TEXT NOT NULL,
         duration_ms INTEGER,
         items_processed INTEGER DEFAULT 0,
         items_alerted INTEGER DEFAULT 0,
         error TEXT,
         created_at TEXT DEFAULT datetime('now','localtime'),
         
         CHECK (duration_ms >= 0),
         CHECK (items_processed >= 0)
       )`,
    );
    
    // Index for fast dashboard queries
    await execute(
      db,
      `CREATE INDEX IF NOT EXISTS idx_cron_sweep_name_date 
       ON cron_sweep_metrics(sweep_name, last_run_at DESC)`,
    ).catch(() => {});
    
    console.log('[cron-metrics] schema ensured');
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('already exists')) {
      console.error('[cron-metrics] schema creation failed:', err);
    }
  }
}
