// ============================================================
// Scraper Nightly Job
// ============================================================
// Runs once every 24h: prune old runs, update rolling metrics
// on config table, emit daily health report notification.
// ============================================================

import { getDb } from '../models/database';
import { pruneRuns } from './scraperRunner';
import { getSourceMetrics, getHealthSummary } from './scraperMetrics';
import { checkMassFailure } from './scraperAlerts';

export function runScraperNightly(): void {
  try {
    console.log('[Scraper Nightly] Starting...');

    // 1. Prune old runs (keep last 500 per source)
    const pruned = pruneRuns(500);
    console.log(`[Scraper Nightly] Pruned ${pruned.deleted} old run rows`);

    // 2. Update rolling metrics on config table
    const db = getDb();
    const sources = db.prepare(
      'SELECT source_key FROM warrant_scraper_config WHERE enabled = 1'
    ).all() as { source_key: string }[];

    const update = db.prepare(`
      UPDATE warrant_scraper_config
      SET avg_parse_count = ?, p95_latency_ms = ?
      WHERE source_key = ?
    `);

    for (const s of sources) {
      try {
        const m = getSourceMetrics(s.source_key, 168); // 7 days
        update.run(m.avg_parsed, m.p95_duration_ms, s.source_key);
      } catch (e) {
        console.warn(`[Scraper Nightly] Metrics update failed for ${s.source_key}:`, (e as Error).message);
      }
    }
    console.log(`[Scraper Nightly] Updated metrics for ${sources.length} sources`);

    // 3. Emit daily health report to admin + manager
    try {
      const summary = getHealthSummary();
      const msg = `Warrant scrapers: ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.failed} failed, ${summary.circuit_broken} broken. Last hour: ${summary.last_hour_runs} runs, ${summary.last_hour_inserted} new warrants.`;

      // Lazily import notification helper to avoid circular deps
      import('../routes/notifications').then(({ createNotificationForRoles }) => {
        try {
          createNotificationForRoles(
            ['admin', 'manager'],
            'system',
            'Daily Warrant Scraper Report',
            msg,
            'warrant_scraper_daily',
            0,
            'normal',
          );
        } catch (e) {
          console.warn('[Scraper Nightly] Notification failed:', (e as Error).message);
        }
      }).catch((e) => {
        console.warn('[Scraper Nightly] Failed to load notifications module:', (e as Error).message);
      });

      console.log(`[Scraper Nightly] ${msg}`);
    } catch (e) {
      console.warn('[Scraper Nightly] Health summary failed:', (e as Error).message);
    }

    // 4. Check mass-failure condition (>30% sources in D/F grade).
    // Rate limited to 1/hour via module-level state in scraperAlerts.
    checkMassFailure();
  } catch (err) {
    console.error('[Scraper Nightly] Error:', (err as Error).message);
  }
}
