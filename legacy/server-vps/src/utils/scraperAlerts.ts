// ============================================================
// Scraper Alerts
// ============================================================
// Condition-based notifications for scraper health events:
//   - alertCircuitBroken  — fired when a source trips the 15-error threshold
//   - checkParserDrift    — fired when 5 consecutive runs return HTTP 200 + 0 warrants
//   - checkMassFailure    — fired when >30% of enabled sources grade D/F (rate limited)
//
// All functions wrap notification calls in try/catch so an alert
// failure can NEVER disrupt the scraper. Uses the existing
// createNotificationForRoles helper from routes/notifications.
// ============================================================

import { getDb } from '../models/database';
import { createNotificationForRoles } from '../routes/notifications';
import { getHealthSummary } from './scraperMetrics';

// Rate limit mass-failure alerts to at most once per hour
let lastMassFailureAlertAt = 0;
const MASS_FAILURE_COOLDOWN_MS = 60 * 60_000;
const MASS_FAILURE_THRESHOLD = 0.30;

/**
 * Fire a high-priority notification when a scraper trips its circuit breaker.
 * Called from the syncSource error handler after the 15-consecutive-errors
 * threshold is crossed.
 */
export function alertCircuitBroken(sourceKey: string, displayName: string): void {
  try {
    createNotificationForRoles(
      ['admin', 'manager'],
      'system',
      'Warrant Scraper Circuit Broken',
      `${displayName} (${sourceKey}) tripped the circuit breaker after 15 consecutive errors.`,
      'config',
      0,
      'high',
      'warrant_scraper_circuit',
    );
  } catch (e) {
    console.warn('[Scraper Alerts] alertCircuitBroken failed:', (e as Error).message);
  }
}

/**
 * Check the last 5 runs for a source. If ALL returned HTTP 200 AND parsed 0
 * records AND have no error, fire a parser drift alert — the parser is
 * likely broken because the site's HTML structure changed, but the request
 * succeeded so no error was logged.
 */
export function checkParserDrift(sourceKey: string, displayName: string): void {
  try {
    const db = getDb();
    const last5 = db.prepare(`
      SELECT http_status, parsed_count, error_message
      FROM warrant_scraper_runs
      WHERE source_key = ?
      ORDER BY started_at DESC
      LIMIT 5
    `).all(sourceKey) as { http_status: number | null; parsed_count: number; error_message: string | null }[];

    if (last5.length < 5) return;

    const allDrifted = last5.every(r =>
      r.http_status === 200 && r.parsed_count === 0 && !r.error_message
    );

    if (allDrifted) {
      createNotificationForRoles(
        ['admin', 'manager'],
        'system',
        'Warrant Scraper Parser Drift',
        `${displayName} (${sourceKey}) returned HTTP 200 + 0 warrants for 5 consecutive runs. Parser may be broken (site HTML likely changed).`,
        'config',
        0,
        'high',
        'warrant_scraper_drift',
      );
    }
  } catch (e) {
    console.warn('[Scraper Alerts] checkParserDrift failed:', (e as Error).message);
  }
}

/**
 * Fire an alert if more than 30% of enabled sources are in D or F health
 * grade. Rate-limited to once per hour via module-level state.
 * Called from the nightly job.
 */
export function checkMassFailure(): void {
  try {
    if (Date.now() - lastMassFailureAlertAt < MASS_FAILURE_COOLDOWN_MS) return;

    const summary = getHealthSummary();
    if (summary.total === 0) return;

    const failRate = summary.failed / summary.total;
    if (failRate <= MASS_FAILURE_THRESHOLD) return;

    createNotificationForRoles(
      ['admin', 'manager'],
      'system',
      'Warrant Scraper Health Degraded',
      `${summary.failed} of ${summary.total} enabled sources are failing (${Math.round(failRate * 100)}%). Check the Scrapers tab for details.`,
      'config',
      0,
      'high',
      'warrant_scraper_mass_failure',
    );
    lastMassFailureAlertAt = Date.now();
  } catch (e) {
    console.warn('[Scraper Alerts] checkMassFailure failed:', (e as Error).message);
  }
}
