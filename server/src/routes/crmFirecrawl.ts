// ============================================================
// CRM Firecrawl API Routes
// ============================================================
// On-demand web intelligence endpoints for the Overwatch CRM.
// Provides health check, web search, page scrape, and manual
// lead import via the self-hosted Firecrawl instance.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch, firecrawlHealthCheck } from '../utils/firecrawlClient';
import { upsertLead, type LeadUpsertData } from '../utils/leadScraperBase';
import { auditLog } from '../utils/auditLogger';

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

      auditLog(req, 'SEARCH' as any, 'crm_leads', 0, `Firecrawl search: ${query.trim()} (limit: ${cappedLimit})`);

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

      auditLog(req, 'SEARCH' as any, 'crm_leads', 0, `Firecrawl scrape: ${url.trim()}`);

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

      auditLog(req, 'CREATE', 'crm_leads', id, null, {
        business_name: leadData.business_name,
        source: 'firecrawl_manual',
      });

      res.json({ success: true, id, inserted });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Firecrawl] Import error:', msg);
      res.status(500).json({ error: 'Failed to import lead', detail: msg });
    }
  },
);

export default router;
