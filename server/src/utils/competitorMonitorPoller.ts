// ============================================================
// Competitor Monitor Poller — Background URL Change Detection
// ============================================================
// Runs on a 5-minute interval, checking monitored URLs that are
// due for a content scrape. Uses Firecrawl to fetch page content
// and SHA-256 hashing to detect changes. Broadcasts real-time
// notifications when changes are detected.
// ============================================================

import { getDb } from '../models/database';
import { firecrawlScrape } from './firecrawlClient';
import { broadcast } from './websocket';
import { localNow } from './timeUtils';
import { createHash } from 'crypto';

const POLL_INTERVAL_MS = 300_000; // 5 minutes
const MAX_CONTENT_LENGTH = 50_000; // Truncate stored content to 50KB
const MAX_CONSECUTIVE_FAILURES = 5;

let pollerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Check a single monitored URL for content changes.
 */
async function checkUrl(row: any): Promise<void> {
  const db = getDb();
  const now = localNow();

  try {
    const result = await firecrawlScrape({
      url: row.url,
      formats: ['markdown'],
      onlyMainContent: true,
    });

    if (!result.success || !result.data?.markdown) {
      // Scrape failed — increment failure count
      db.prepare(`
        UPDATE firecrawl_monitored_urls
        SET consecutive_failures = consecutive_failures + 1, last_check_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, row.id);
      console.warn(`[CompetitorPoller] Scrape failed for ${row.url}: ${result.error || 'no content'}`);
      return;
    }

    const markdown = result.data.markdown;
    const contentHash = createHash('sha256').update(markdown).digest('hex');
    const truncatedContent = markdown.slice(0, MAX_CONTENT_LENGTH);

    // Check if content changed
    if (row.last_content_hash && contentHash !== row.last_content_hash) {
      // Determine significance based on content length difference
      const oldLen = (row.last_content || '').length || 1;
      const diff = Math.abs(markdown.length - oldLen) / oldLen;
      const significance = diff > 0.2 ? 'major' : diff > 0.05 ? 'moderate' : 'minor';

      const changeResult = db.prepare(`
        INSERT INTO firecrawl_url_changes (monitored_url_id, old_hash, new_hash, significance, content_snapshot, acknowledged, detected_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(row.id, row.last_content_hash, contentHash, significance, truncatedContent, now);

      const changeId = Number(changeResult.lastInsertRowid);

      broadcast('competitor:change_detected', {
        monitored_url_id: row.id,
        url: row.url,
        label: row.label,
        significance,
        change_id: changeId,
        detected_at: now,
      });

      console.log(`[CompetitorPoller] Change detected (${significance}) for ${row.url}`);
    }

    // Update monitored URL: reset failures, store content and hash
    db.prepare(`
      UPDATE firecrawl_monitored_urls
      SET last_check_at = ?, last_content_hash = ?, last_content = ?, consecutive_failures = 0, updated_at = ?
      WHERE id = ?
    `).run(now, contentHash, truncatedContent, now, row.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CompetitorPoller] Error checking ${row.url}:`, msg);

    db.prepare(`
      UPDATE firecrawl_monitored_urls
      SET consecutive_failures = consecutive_failures + 1, last_check_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, row.id);
  }
}

/**
 * Single poll tick — find all due URLs and check them.
 */
async function pollTick(): Promise<void> {
  try {
    const db = getDb();

    // Find enabled URLs that are due for a check:
    // - Never checked (last_check_at IS NULL)
    // - Or overdue by their check_interval_minutes
    // - And not circuit-broken (consecutive_failures < 5)
    const dueUrls = db.prepare(`
      SELECT * FROM firecrawl_monitored_urls
      WHERE is_enabled = 1
        AND consecutive_failures < ?
        AND (
          last_check_at IS NULL
          OR datetime(last_check_at, '+' || check_interval_minutes || ' minutes') <= datetime(?)
        )
    `).all(MAX_CONSECUTIVE_FAILURES, localNow()) as any[];

    if (dueUrls.length === 0) return;

    console.log(`[CompetitorPoller] Checking ${dueUrls.length} URL(s)`);

    for (const row of dueUrls) {
      await checkUrl(row);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CompetitorPoller] Poll tick error:', msg);
  }
}

/**
 * Start the competitor monitor background poller.
 * Runs every 5 minutes. Uses timer.unref() so it doesn't block shutdown.
 */
export function startCompetitorPoller(): void {
  if (pollerHandle) {
    console.warn('[CompetitorPoller] Already running');
    return;
  }

  console.log('[CompetitorPoller] Starting (interval: 5 minutes)');

  // Run first tick after a short delay to let the server finish starting
  const startupDelay = setTimeout(() => {
    pollTick().catch(err => console.error('[CompetitorPoller] Initial tick error:', err));
  }, 10_000);
  if (startupDelay.unref) startupDelay.unref();

  pollerHandle = setInterval(() => {
    pollTick().catch(err => console.error('[CompetitorPoller] Tick error:', err));
  }, POLL_INTERVAL_MS);

  if (pollerHandle.unref) pollerHandle.unref();
}

/**
 * Stop the competitor monitor background poller.
 */
export function stopCompetitorPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
    console.log('[CompetitorPoller] Stopped');
  }
}
