// ============================================================
// CRM Firecrawl API Routes
// ============================================================
// On-demand web intelligence endpoints for the Overwatch CRM.
// Provides health check, web search, page scrape, manual/bulk
// lead import, search history, saved searches, and enrichment
// via the self-hosted Firecrawl instance.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch, firecrawlHealthCheck } from '../utils/firecrawlClient';
import { upsertLead, type LeadUpsertData } from '../utils/leadScraperBase';
import { auditLog } from '../utils/auditLogger';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticate);

// ── GET /firecrawl/status ────────────────────────────────────
// Health check — returns { connected: boolean }

router.get(
  '/firecrawl/status',
  requireRole('admin', 'manager'),
  async (_req: Request, res: Response) => {
    try {
      const connected = await firecrawlHealthCheck();
      res.json({ connected });
    } catch {
      res.json({ connected: false });
    }
  },
);

// ── POST /firecrawl/search ───────────────────────────────────
// Web search via Firecrawl — body: { query, limit? }

router.post(
  '/firecrawl/search',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    const { query, limit } = req.body as { query?: string; limit?: number };

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      res.status(400).json({ error: 'query must be at least 2 characters' });
      return;
    }

    const cappedLimit = Math.min(Math.max(1, limit || 10), 20);

    try {
      const result = await firecrawlSearch({
        query: query.trim(),
        limit: cappedLimit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      auditLog(req, 'SEARCH', 'crm_leads', 0, `Firecrawl search: ${query.trim()} (limit: ${cappedLimit})`);

      // Record search in history
      const userId = (req as any).user?.id;
      if (userId) {
        try {
          const db = getDb();
          db.prepare(
            'INSERT INTO firecrawl_search_history (user_id, query, result_count, created_at) VALUES (?, ?, ?, ?)'
          ).run(userId, query.trim(), (result.data || []).length, localNow());
        } catch (histErr) {
          console.error('[Firecrawl] Failed to record search history:', histErr);
        }
      }

      res.json({ results: result.data || [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Search error:', msg);
      res.status(502).json({ error: 'Firecrawl search failed', detail: msg });
    }
  },
);

// ── POST /firecrawl/scrape ───────────────────────────────────
// Scrape a single URL — body: { url, extract_schema? }

router.post(
  '/firecrawl/scrape',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    const { url, extract_schema } = req.body as {
      url?: string;
      extract_schema?: Record<string, unknown>;
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    try {
      const result = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
        extract: extract_schema ? { schema: extract_schema } : undefined,
      });

      auditLog(req, 'SEARCH', 'crm_leads', 0, `Firecrawl scrape: ${url.trim()}`);

      res.json({ data: result.data || {} });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Scrape error:', msg);
      res.status(502).json({ error: 'Firecrawl scrape failed', detail: msg });
    }
  },
);

// ── POST /firecrawl/import ───────────────────────────────────
// Manually import a lead from Firecrawl results

router.post(
  '/firecrawl/import',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    const body = req.body as Partial<LeadUpsertData> & { business_name?: string };

    if (!body.business_name || typeof body.business_name !== 'string' || !body.business_name.trim()) {
      res.status(400).json({ error: 'business_name is required' });
      return;
    }

    try {
      const leadData: LeadUpsertData = {
        source: 'firecrawl_manual',
        source_id: body.source_id || `fc_${Date.now()}`,
        source_url: body.source_url,
        business_name: body.business_name.trim(),
        industry: body.industry,
        sic_code: body.sic_code,
        business_type: body.business_type,
        contact_name: body.contact_name,
        contact_email: body.contact_email,
        contact_phone: body.contact_phone,
        contact_title: body.contact_title,
        address: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip,
        latitude: body.latitude,
        longitude: body.longitude,
        estimated_value: body.estimated_value,
        permit_number: body.permit_number,
        registration_date: body.registration_date,
        license_number: body.license_number,
        project_type: body.project_type,
        property_size: body.property_size,
        notes: body.notes,
        service_interest: body.service_interest,
      };

      const { inserted, id } = upsertLead(leadData);

      auditLog(req, 'CREATE', 'crm_leads', id, `Created lead from Firecrawl: ${leadData.business_name || 'unknown'}`);

      res.json({ success: true, id, inserted });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Import error:', msg);
      res.status(500).json({ error: 'Failed to import lead', detail: msg });
    }
  },
);

// ── POST /firecrawl/import-bulk ──────────────────────────────
// Bulk import leads from Firecrawl results — body: { results: array }

router.post(
  '/firecrawl/import-bulk',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    const { results } = req.body as { results?: Array<Partial<LeadUpsertData> & { business_name?: string }> };

    if (!Array.isArray(results) || results.length === 0) {
      res.status(400).json({ error: 'results must be a non-empty array' });
      return;
    }

    if (results.length > 100) {
      res.status(400).json({ error: 'Maximum 100 leads per bulk import' });
      return;
    }

    const imported: Array<{ id: number; business_name: string; inserted: boolean }> = [];
    const errors: Array<{ index: number; business_name?: string; error: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const item = results[i];

      if (!item.business_name || typeof item.business_name !== 'string' || !item.business_name.trim()) {
        errors.push({ index: i, business_name: item.business_name, error: 'business_name is required' });
        continue;
      }

      try {
        const leadData: LeadUpsertData = {
          source: 'firecrawl_bulk',
          source_id: item.source_id || `fc_bulk_${Date.now()}_${i}`,
          source_url: item.source_url,
          business_name: item.business_name.trim(),
          industry: item.industry,
          sic_code: item.sic_code,
          business_type: item.business_type,
          contact_name: item.contact_name,
          contact_email: item.contact_email,
          contact_phone: item.contact_phone,
          contact_title: item.contact_title,
          address: item.address,
          city: item.city,
          state: item.state,
          zip: item.zip,
          latitude: item.latitude,
          longitude: item.longitude,
          estimated_value: item.estimated_value,
          permit_number: item.permit_number,
          registration_date: item.registration_date,
          license_number: item.license_number,
          project_type: item.project_type,
          property_size: item.property_size,
          notes: item.notes,
          service_interest: item.service_interest,
        };

        const { inserted, id } = upsertLead(leadData);
        imported.push({ id, business_name: leadData.business_name, inserted });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ index: i, business_name: item.business_name, error: msg });
      }
    }

    auditLog(req, 'CREATE', 'crm_leads', 0, `Bulk import: ${imported.length} imported, ${errors.length} errors`);

    res.json({
      success: true,
      imported_count: imported.filter(r => r.inserted).length,
      duplicate_count: imported.filter(r => !r.inserted).length,
      error_count: errors.length,
      imported,
      errors,
    });
  },
);

// ── GET /firecrawl/search-history ────────────────────────────
// Returns last 50 search history entries for the current user

router.get(
  '/firecrawl/search-history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = (_req as any).user?.id;
      const rows = db.prepare(
        'SELECT * FROM firecrawl_search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
      ).all(userId);
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Search history error:', msg);
      res.status(500).json({ error: 'Failed to fetch search history', detail: msg });
    }
  },
);

// ── POST /firecrawl/saved-searches ───────────────────────────
// Create a saved search template

router.post(
  '/firecrawl/saved-searches',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    const { name, query, extract_schema, search_limit } = req.body as {
      name?: string;
      query?: string;
      extract_schema?: Record<string, unknown>;
      search_limit?: number;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const db = getDb();
      const userId = (req as any).user?.id;
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_saved_searches (name, query, extract_schema, search_limit, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(),
        query.trim(),
        extract_schema ? JSON.stringify(extract_schema) : null,
        Math.min(Math.max(1, search_limit || 10), 20),
        userId,
        now,
        now,
      );

      auditLog(req, 'CREATE', 'firecrawl_saved_searches', Number(result.lastInsertRowid), `Saved search: ${name.trim()}`);

      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Save search error:', msg);
      res.status(500).json({ error: 'Failed to save search', detail: msg });
    }
  },
);

// ── GET /firecrawl/saved-searches ────────────────────────────
// List all saved search templates

router.get(
  '/firecrawl/saved-searches',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_saved_searches ORDER BY updated_at DESC'
      ).all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] List saved searches error:', msg);
      res.status(500).json({ error: 'Failed to list saved searches', detail: msg });
    }
  },
);

// ── DELETE /firecrawl/saved-searches/:id ─────────────────────
// Delete a saved search template

router.delete(
  '/firecrawl/saved-searches/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_saved_searches WHERE id = ?').run(id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Saved search not found' });
        return;
      }

      auditLog(req, 'DELETE', 'firecrawl_saved_searches', id, 'Deleted saved search');

      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Delete saved search error:', msg);
      res.status(500).json({ error: 'Failed to delete saved search', detail: msg });
    }
  },
);

// ── GET /firecrawl/enrichment/:leadId ────────────────────────
// Get enrichment status for a lead

router.get(
  '/firecrawl/enrichment/:leadId',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    const leadId = Number(req.params.leadId);
    if (!leadId || isNaN(leadId)) {
      res.status(400).json({ error: 'Invalid leadId' });
      return;
    }

    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM firecrawl_enrichment_queue WHERE lead_id = ?'
      ).get(leadId);

      if (!row) {
        res.json({ status: 'none', lead_id: leadId });
        return;
      }

      res.json(row);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Enrichment status error:', msg);
      res.status(500).json({ error: 'Failed to get enrichment status', detail: msg });
    }
  },
);

// ── POST /firecrawl/enrichment/:leadId/retry ─────────────────
// Reset a failed enrichment job so it can be retried

router.post(
  '/firecrawl/enrichment/:leadId/retry',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    const leadId = Number(req.params.leadId);
    if (!leadId || isNaN(leadId)) {
      res.status(400).json({ error: 'Invalid leadId' });
      return;
    }

    try {
      const db = getDb();
      const existing = db.prepare(
        'SELECT * FROM firecrawl_enrichment_queue WHERE lead_id = ?'
      ).get(leadId) as any;

      if (!existing) {
        res.status(404).json({ error: 'No enrichment job found for this lead' });
        return;
      }

      if (existing.status === 'completed') {
        res.status(400).json({ error: 'Enrichment already completed' });
        return;
      }

      db.prepare(`
        UPDATE firecrawl_enrichment_queue
        SET status = 'pending', attempts = 0, error_message = NULL, completed_at = NULL
        WHERE lead_id = ?
      `).run(leadId);

      // Also reset the lead enrichment_status
      db.prepare(
        "UPDATE crm_leads SET enrichment_status = 'pending', updated_at = ? WHERE id = ?"
      ).run(localNow(), leadId);

      auditLog(req, 'UPDATE', 'firecrawl_enrichment_queue', existing.id, `Retry enrichment for lead ${leadId}`);

      res.json({ success: true, status: 'pending' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Enrichment retry error:', msg);
      res.status(500).json({ error: 'Failed to retry enrichment', detail: msg });
    }
  },
);

export default router;
