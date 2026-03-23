// ============================================================
// CRM Competitor Monitor — URL Change Detection Routes
// ============================================================
// Monitors competitor / target URLs for content changes using
// Firecrawl scraping and SHA-256 content hashing. Provides
// endpoints for managing monitored URLs, viewing change history,
// triggering manual checks, and acknowledging changes.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape } from '../utils/firecrawlClient';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';
import { createHash } from 'crypto';

const router = Router();
router.use(authenticate);
const requireCrmRole = requireRole('admin', 'manager');

// ── GET / ────────────────────────────────────────────────────
// List all monitored URLs with unacknowledged change count

router.get(
  '/',
  requireCrmRole,
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          m.*,
          COALESCE(c.unack_count, 0) AS unacknowledged_changes
        FROM firecrawl_monitored_urls m
        LEFT JOIN (
          SELECT monitored_url_id, COUNT(*) AS unack_count
          FROM firecrawl_url_changes
          WHERE acknowledged = 0
          GROUP BY monitored_url_id
        ) c ON c.monitored_url_id = m.id
        ORDER BY m.created_at DESC
      `).all();

      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] List error:', msg);
      res.status(500).json({ error: 'Failed to list monitored URLs', detail: msg });
    }
  },
);

// ── POST / ───────────────────────────────────────────────────
// Add a URL to monitor — body: { url, label?, check_interval_minutes? }

router.post(
  '/',
  requireCrmRole,
  (req: Request, res: Response) => {
    const { url, label, check_interval_minutes } = req.body as {
      url?: string;
      label?: string;
      check_interval_minutes?: number;
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required', code: 'URL_IS_REQUIRED' });
      return;
    }

    // Basic URL format validation
    try {
      new URL(url.trim());
    } catch {
      res.status(400).json({ error: 'Invalid URL format', code: 'INVALID_URL_FORMAT' });
      return;
    }

    const interval = Math.max(5, Math.min(check_interval_minutes || 60, 10080)); // 5 min to 7 days

    try {
      const db = getDb();
      const now = localNow();
      const userId = (req as any).user?.id;

      const result = db.prepare(`
        INSERT INTO firecrawl_monitored_urls (url, label, check_interval_minutes, is_enabled, consecutive_failures, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?, ?)
      `).run(url.trim(), label?.trim() || null, interval, userId, now, now);

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_monitored_urls', id, `Added monitored URL: ${url.trim()}`);

      res.json({ success: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Add error:', msg);
      res.status(500).json({ error: 'Failed to add monitored URL', detail: msg });
    }
  },
);

// ── PUT /:id ─────────────────────────────────────────────────
// Update label, check_interval_minutes, is_enabled

router.put(
  '/:id',
  requireCrmRole,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    const { label, check_interval_minutes, is_enabled } = req.body as {
      label?: string;
      check_interval_minutes?: number;
      is_enabled?: boolean | number;
    };

    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM firecrawl_monitored_urls WHERE id = ?').get(id);
      if (!existing) {
        res.status(404).json({ error: 'Monitored URL not found', code: 'MONITORED_URL_NOT_FOUND' });
        return;
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (label !== undefined) {
        updates.push('label = ?');
        values.push(label?.trim() || null);
      }
      if (check_interval_minutes !== undefined) {
        const interval = Math.max(5, Math.min(check_interval_minutes, 10080));
        updates.push('check_interval_minutes = ?');
        values.push(interval);
      }
      if (is_enabled !== undefined) {
        updates.push('is_enabled = ?');
        values.push(is_enabled ? 1 : 0);
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
        return;
      }

      updates.push('updated_at = ?');
      values.push(localNow());
      values.push(id);

      db.prepare(`UPDATE firecrawl_monitored_urls SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      auditLog(req, 'UPDATE', 'firecrawl_monitored_urls', id, `Updated monitored URL`);

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Update error:', msg);
      res.status(500).json({ error: 'Failed to update monitored URL', detail: msg });
    }
  },
);

// ── DELETE /:id ──────────────────────────────────────────────
// Remove monitored URL + cascade changes

router.delete(
  '/:id',
  requireCrmRole,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    try {
      const db = getDb();
      const existing = db.prepare('SELECT url FROM firecrawl_monitored_urls WHERE id = ?').get(id) as { url: string } | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Monitored URL not found', code: 'MONITORED_URL_NOT_FOUND' });
        return;
      }

      // Cascade: delete change history first
      db.prepare('DELETE FROM firecrawl_url_changes WHERE monitored_url_id = ?').run(id);
      db.prepare('DELETE FROM firecrawl_monitored_urls WHERE id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_monitored_urls', id, `Deleted monitored URL: ${existing.url}`);

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Delete error:', msg);
      res.status(500).json({ error: 'Failed to delete monitored URL', detail: msg });
    }
  },
);

// ── GET /:id/changes ─────────────────────────────────────────
// Get change history for a monitored URL — ?limit=20

router.get(
  '/:id/changes',
  requireCrmRole,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);

    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM firecrawl_url_changes
        WHERE monitored_url_id = ?
        ORDER BY detected_at DESC
        LIMIT ?
      `).all(id, limit);

      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Changes error:', msg);
      res.status(500).json({ error: 'Failed to get change history', detail: msg });
    }
  },
);

// ── POST /:id/check-now ─────────────────────────────────────
// Trigger immediate check for a monitored URL

router.post(
  '/:id/check-now',
  requireCrmRole,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    try {
      const db = getDb();
      const monitored = db.prepare('SELECT * FROM firecrawl_monitored_urls WHERE id = ?').get(id) as any;
      if (!monitored) {
        res.status(404).json({ error: 'Monitored URL not found', code: 'MONITORED_URL_NOT_FOUND' });
        return;
      }

      // Scrape the URL
      const result = await firecrawlScrape({
        url: monitored.url,
        formats: ['markdown'],
        onlyMainContent: true,
      });

      if (!result.success || !result.data?.markdown) {
        res.status(502).json({ error: 'Scrape failed', detail: result.error || 'No content returned' });
        return;
      }

      const markdown = result.data.markdown;
      const contentHash = createHash('sha256').update(markdown).digest('hex');
      const now = localNow();
      const truncatedContent = markdown.slice(0, 50_000);

      let changeDetected = false;
      let changeId: number | null = null;

      if (monitored.last_content_hash && contentHash !== monitored.last_content_hash) {
        changeDetected = true;

        // Determine significance based on content length difference
        const oldLen = (monitored.last_content || '').length || 1;
        const diff = Math.abs(markdown.length - oldLen) / oldLen;
        const significance = diff > 0.2 ? 'major' : diff > 0.05 ? 'moderate' : 'minor';

        const changeResult = db.prepare(`
          INSERT INTO firecrawl_url_changes (monitored_url_id, old_hash, new_hash, significance, content_snapshot, acknowledged, detected_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).run(id, monitored.last_content_hash, contentHash, significance, truncatedContent, now);

        changeId = Number(changeResult.lastInsertRowid);

        broadcast('admin', 'competitor:change_detected', {
          monitored_url_id: id,
          url: monitored.url,
          label: monitored.label,
          significance,
          change_id: changeId,
          detected_at: now,
        });
      }

      // Update monitored URL record
      db.prepare(`
        UPDATE firecrawl_monitored_urls
        SET last_check_at = ?, last_content_hash = ?, last_content = ?, consecutive_failures = 0, updated_at = ?
        WHERE id = ?
      `).run(now, contentHash, truncatedContent, now, id);

      auditLog(req, 'UPDATE', 'firecrawl_monitored_urls', id, `Manual check: ${changeDetected ? 'change detected' : 'no change'}`);

      res.json({
        success: true,
        change_detected: changeDetected,
        change_id: changeId,
        content_hash: contentHash,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Check-now error:', msg);
      res.status(502).json({ error: 'Check failed', detail: msg });
    }
  },
);

// ── POST /changes/:changeId/acknowledge ──────────────────────
// Set acknowledged = 1 for a change

router.post(
  '/changes/:changeId/acknowledge',
  requireCrmRole,
  (req: Request, res: Response) => {
    const changeId = Number(req.params.changeId);
    if (!changeId || isNaN(changeId)) {
      res.status(400).json({ error: 'Invalid changeId', code: 'INVALID_CHANGEID' });
      return;
    }

    try {
      const db = getDb();
      const result = db.prepare(
        'UPDATE firecrawl_url_changes SET acknowledged = 1 WHERE id = ?'
      ).run(changeId);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Change not found', code: 'CHANGE_NOT_FOUND' });
        return;
      }

      auditLog(req, 'UPDATE', 'firecrawl_url_changes', changeId, 'Acknowledged change');

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CompetitorMonitor] Acknowledge error:', msg);
      res.status(500).json({ error: 'Failed to acknowledge change', detail: msg });
    }
  },
);

export default router;
