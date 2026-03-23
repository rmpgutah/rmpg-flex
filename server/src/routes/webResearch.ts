// ============================================================
// Web Research API Routes
// ============================================================
// On-demand web research endpoints for officers and above.
// Provides health check, web search, page scrape, and result
// management (CRUD) via the self-hosted Firecrawl instance.
// Results can be linked to incidents, persons, or cases.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch, firecrawlHealthCheck } from '../utils/firecrawlClient';
import { auditLog } from '../utils/auditLogger';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticate);

const requireOfficerRole = requireRole('admin', 'manager', 'supervisor', 'officer');

// ── GET /status ─────────────────────────────────────────────
// Health check — returns { connected: boolean }

router.get(
  '/status',
  requireOfficerRole,
  async (_req: Request, res: Response) => {
    try {
      const connected = await firecrawlHealthCheck();
      res.json({ connected });
    } catch {
      res.json({ connected: false });
    }
  },
);

// ── POST /search ────────────────────────────────────────────
// Web search via Firecrawl — body: { query, limit? }
// Stores each result in web_research_results (result_type='search')

router.post(
  '/search',
  requireOfficerRole,
  async (req: Request, res: Response) => {
    const { query, limit } = req.body as { query?: string; limit?: number };

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      res.status(400).json({ error: 'query must be at least 2 characters', code: 'QUERY_MUST_BE_AT' });
      return;
    }

    const cappedLimit = Math.min(Math.max(1, limit || 10), 20);

    try {
      const result = await firecrawlSearch({
        query: query.trim(),
        limit: cappedLimit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const userId = (req as any).user?.id;
      const db = getDb();
      const now = localNow();
      const savedIds: number[] = [];

      // Store each search result
      for (const item of result.data || []) {
        try {
          const insertResult = db.prepare(`
            INSERT INTO web_research_results (user_id, result_type, query, url, title, description, content, metadata, created_at)
            VALUES (?, 'search', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            userId,
            query.trim(),
            item.url || null,
            item.title || null,
            item.description || null,
            item.markdown || null,
            item.metadata ? JSON.stringify(item.metadata) : null,
            now,
          );
          savedIds.push(Number(insertResult.lastInsertRowid));
        } catch (insertErr) {
          console.error('[WebResearch] Failed to save search result:', insertErr);
        }
      }

      auditLog(req, 'SEARCH', 'web_research_results', 0, `Web research search: ${query.trim()} (limit: ${cappedLimit}, saved: ${savedIds.length})`);

      res.json({ results: result.data || [], savedIds });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WebResearch] Search error:', msg);
      res.status(502).json({ error: 'Web research search failed', detail: msg });
    }
  },
);

// ── POST /scrape ────────────────────────────────────────────
// Scrape a single URL — body: { url, extract_schema? }
// Stores result in web_research_results (result_type='scrape')

router.post(
  '/scrape',
  requireOfficerRole,
  async (req: Request, res: Response) => {
    const { url, extract_schema } = req.body as {
      url?: string;
      extract_schema?: Record<string, unknown>;
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required', code: 'URL_IS_REQUIRED' });
      return;
    }

    try {
      const result = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
        extract: extract_schema ? { schema: extract_schema } : undefined,
      });

      const userId = (req as any).user?.id;
      const db = getDb();
      const now = localNow();
      let savedId: number | null = null;

      try {
        const data = result.data || {};
        const insertResult = db.prepare(`
          INSERT INTO web_research_results (user_id, result_type, url, title, content, metadata, created_at)
          VALUES (?, 'scrape', ?, ?, ?, ?, ?)
        `).run(
          userId,
          url.trim(),
          (data.metadata as any)?.title || null,
          data.markdown || null,
          data.metadata ? JSON.stringify(data.metadata) : null,
          now,
        );
        savedId = Number(insertResult.lastInsertRowid);
      } catch (insertErr) {
        console.error('[WebResearch] Failed to save scrape result:', insertErr);
      }

      auditLog(req, 'SEARCH', 'web_research_results', savedId || 0, `Web research scrape: ${url.trim()}`);

      res.json({ data: result.data || {}, savedId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WebResearch] Scrape error:', msg);
      res.status(502).json({ error: 'Web research scrape failed', detail: msg });
    }
  },
);

// ── GET /results ────────────────────────────────────────────
// List current user's research results with optional filters

router.get(
  '/results',
  requireOfficerRole,
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = (req as any).user?.id;
      const { linked_incident_id, linked_person_id, linked_case_id, limit } = req.query as {
        linked_incident_id?: string;
        linked_person_id?: string;
        linked_case_id?: string;
        limit?: string;
      };

      const cappedLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

      let sql = 'SELECT * FROM web_research_results WHERE user_id = ?';
      const params: (string | number)[] = [userId];

      if (linked_incident_id) {
        sql += ' AND linked_incident_id = ?';
        params.push(Number(linked_incident_id));
      }
      if (linked_person_id) {
        sql += ' AND linked_person_id = ?';
        params.push(Number(linked_person_id));
      }
      if (linked_case_id) {
        sql += ' AND linked_case_id = ?';
        params.push(Number(linked_case_id));
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(cappedLimit);

      const rows = db.prepare(sql).all(...params);
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WebResearch] List results error:', msg);
      res.status(500).json({ error: 'Failed to fetch research results', detail: msg });
    }
  },
);

// ── PUT /results/:id ────────────────────────────────────────
// Update notes or linked entity IDs on a research result

router.put(
  '/results/:id',
  requireOfficerRole,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    try {
      const db = getDb();
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;

      // Verify ownership or admin
      const existing = db.prepare('SELECT * FROM web_research_results WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Result not found', code: 'RESULT_NOT_FOUND' });
        return;
      }
      if (existing.user_id !== userId && userRole !== 'admin') {
        res.status(403).json({ error: 'Not authorized to update this result', code: 'NOT_AUTHORIZED_TO_UPDATE' });
        return;
      }

      const { notes, linked_incident_id, linked_person_id, linked_case_id } = req.body as {
        notes?: string;
        linked_incident_id?: number | null;
        linked_person_id?: number | null;
        linked_case_id?: number | null;
      };

      db.prepare(`
        UPDATE web_research_results
        SET notes = COALESCE(?, notes),
            linked_incident_id = COALESCE(?, linked_incident_id),
            linked_person_id = COALESCE(?, linked_person_id),
            linked_case_id = COALESCE(?, linked_case_id)
        WHERE id = ?
      `).run(
        notes !== undefined ? notes : null,
        linked_incident_id !== undefined ? linked_incident_id : null,
        linked_person_id !== undefined ? linked_person_id : null,
        linked_case_id !== undefined ? linked_case_id : null,
        id,
      );

      auditLog(req, 'UPDATE', 'web_research_results', id, `Updated research result`);

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WebResearch] Update result error:', msg);
      res.status(500).json({ error: 'Failed to update result', detail: msg });
    }
  },
);

// ── DELETE /results/:id ─────────────────────────────────────
// Delete a research result

router.delete(
  '/results/:id',
  requireOfficerRole,
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }

    try {
      const db = getDb();
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;

      // Verify ownership or admin
      const existing = db.prepare('SELECT * FROM web_research_results WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Result not found', code: 'RESULT_NOT_FOUND' });
        return;
      }
      if (existing.user_id !== userId && userRole !== 'admin') {
        res.status(403).json({ error: 'Not authorized to delete this result', code: 'NOT_AUTHORIZED_TO_DELETE' });
        return;
      }

      db.prepare('DELETE FROM web_research_results WHERE id = ?').run(id);

      auditLog(req, 'DELETE', 'web_research_results', id, 'Deleted research result');

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WebResearch] Delete result error:', msg);
      res.status(500).json({ error: 'Failed to delete result', detail: msg });
    }
  },
);

export default router;
