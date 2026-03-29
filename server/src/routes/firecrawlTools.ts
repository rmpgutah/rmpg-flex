// ============================================================
// Firecrawl Tools API Routes
// ============================================================
// Advanced Firecrawl-powered endpoints: Open Scouts (web monitoring),
// AI-Ready Website Analyzer, Website Cloner, Brand Monitor,
// Page Comparison, and Workflow Builder.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch } from '../utils/firecrawlClient';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticate);

// ── Table Initialization ─────────────────────────────────────

function initTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_scouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      query TEXT,
      check_interval_hours INTEGER DEFAULT 24,
      notify_email TEXT,
      keywords TEXT,
      status TEXT DEFAULT 'active',
      last_checked_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_scout_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scout_id INTEGER NOT NULL,
      matched INTEGER DEFAULT 0,
      results TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scout_id) REFERENCES firecrawl_scouts(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_ai_ready_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      scores TEXT NOT NULL,
      overall_score REAL NOT NULL,
      recommendations TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_clones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      html_structure TEXT,
      markdown_content TEXT,
      component_tree TEXT,
      styles_summary TEXT,
      links TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_brand_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT NOT NULL,
      keywords TEXT,
      competitor_urls TEXT,
      check_interval_hours INTEGER DEFAULT 24,
      status TEXT DEFAULT 'active',
      last_checked_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_brand_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      url TEXT,
      title TEXT,
      snippet TEXT,
      source TEXT,
      sentiment TEXT,
      found_at TEXT NOT NULL,
      FOREIGN KEY (monitor_id) REFERENCES firecrawl_brand_monitors(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_a TEXT NOT NULL,
      url_b TEXT NOT NULL,
      markdown_a TEXT,
      markdown_b TEXT,
      diff_summary TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steps TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      status TEXT DEFAULT 'running',
      step_results TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES firecrawl_workflows(id) ON DELETE CASCADE
    )
  `);
}

// Initialize tables on module load
try { initTables(); } catch (e) {
  console.error('[FirecrawlTools] Table init deferred — DB may not be ready yet:', (e as Error).message);
}

// Helper to ensure tables exist (called on first request if init failed)
let tablesReady = false;
function ensureTables(): void {
  if (tablesReady) return;
  try { initTables(); tablesReady = true; } catch { /* will retry next request */ }
}

// ═════════════════════════════════════════════════════════════
// 1. Open Scouts — Web monitoring with alerts
// ═════════════════════════════════════════════════════════════

// ── POST /scouts — Create a new scout ────────────────────────

router.post(
  '/scouts',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, url, query, check_interval_hours, notify_email, keywords } = req.body as {
      name?: string; url?: string; query?: string;
      check_interval_hours?: number; notify_email?: string; keywords?: string[];
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_scouts (name, url, query, check_interval_hours, notify_email, keywords, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), url.trim(), query?.trim() || null,
        check_interval_hours || 24, notify_email?.trim() || null,
        keywords ? JSON.stringify(keywords) : null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_scouts', id, `Created scout: ${name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Create scout error:', msg);
      res.status(500).json({ error: 'Failed to create scout', detail: msg });
    }
  },
);

// ── GET /scouts — List all scouts ───────────────────────────

router.get(
  '/scouts',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_scouts ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list scouts', detail: msg });
    }
  },
);

// ── PUT /scouts/:id — Update a scout ────────────────────────

router.put(
  '/scouts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { name, url, query, check_interval_hours, notify_email, keywords, status } = req.body as {
      name?: string; url?: string; query?: string;
      check_interval_hours?: number; notify_email?: string; keywords?: string[]; status?: string;
    };

    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM firecrawl_scouts WHERE id = ?').get(id);
      if (!existing) { res.status(404).json({ error: 'Scout not found' }); return; }

      const now = localNow();
      db.prepare(`
        UPDATE firecrawl_scouts SET
          name = COALESCE(?, name),
          url = COALESCE(?, url),
          query = COALESCE(?, query),
          check_interval_hours = COALESCE(?, check_interval_hours),
          notify_email = COALESCE(?, notify_email),
          keywords = COALESCE(?, keywords),
          status = COALESCE(?, status),
          updated_at = ?
        WHERE id = ?
      `).run(
        name?.trim() || null, url?.trim() || null, query?.trim() || null,
        check_interval_hours || null, notify_email?.trim() || null,
        keywords ? JSON.stringify(keywords) : null, status || null,
        now, id,
      );

      auditLog(req, 'UPDATE', 'firecrawl_scouts', id, `Updated scout ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to update scout', detail: msg });
    }
  },
);

// ── DELETE /scouts/:id — Delete a scout ─────────────────────

router.delete(
  '/scouts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_scouts WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Scout not found' }); return; }

      auditLog(req, 'DELETE', 'firecrawl_scouts', id, `Deleted scout ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete scout', detail: msg });
    }
  },
);

// ── POST /scouts/:id/run — Manually trigger a scout check ───

router.post(
  '/scouts/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const scout = db.prepare('SELECT * FROM firecrawl_scouts WHERE id = ?').get(id) as any;
      if (!scout) { res.status(404).json({ error: 'Scout not found' }); return; }

      const now = localNow();
      let results: any[] = [];
      let matched = 0;
      let error: string | null = null;

      try {
        const keywords: string[] = scout.keywords ? JSON.parse(scout.keywords) : [];

        if (scout.query) {
          // Use search for query-based scouts
          const searchResult = await firecrawlSearch({
            query: scout.query,
            limit: 10,
            scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
          });
          results = searchResult.data || [];
        } else {
          // Scrape the URL directly
          const scrapeResult = await firecrawlScrape({
            url: scout.url,
            formats: ['markdown'],
            onlyMainContent: true,
          });
          results = scrapeResult.data ? [scrapeResult.data] : [];
        }

        // Check for keyword matches
        if (keywords.length > 0) {
          const content = JSON.stringify(results).toLowerCase();
          matched = keywords.filter(kw => content.includes(kw.toLowerCase())).length;
        } else {
          matched = results.length;
        }
      } catch (runErr: unknown) {
        error = runErr instanceof Error ? runErr.message : String(runErr);
      }

      // Store run
      const runResult = db.prepare(`
        INSERT INTO firecrawl_scout_runs (scout_id, matched, results, error, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, matched, JSON.stringify(results), error, now);

      // Update last_checked_at
      db.prepare('UPDATE firecrawl_scouts SET last_checked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);

      auditLog(req, 'EXECUTE', 'firecrawl_scouts', id, `Scout run: ${matched} matches`);

      res.json({
        success: true,
        run_id: Number(runResult.lastInsertRowid),
        matched,
        result_count: results.length,
        error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Scout run error:', msg);
      res.status(500).json({ error: 'Failed to run scout', detail: msg });
    }
  },
);

// ── GET /scouts/:id/runs — Get recent runs for a scout ──────

router.get(
  '/scouts/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_scout_runs WHERE scout_id = ? ORDER BY created_at DESC LIMIT 50'
      ).all(id);
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get scout runs', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 2. AI-Ready Website Analyzer
// ═════════════════════════════════════════════════════════════

function analyzeAiReadiness(html: string, markdown: string, url: string): {
  scores: Record<string, number>;
  overall_score: number;
  recommendations: string[];
} {
  const scores: Record<string, number> = {
    structured_data: 0,
    semantic_html: 0,
    content_quality: 0,
    performance: 0,
    api_availability: 0,
    mobile_friendly: 0,
    accessibility: 0,
    security: 0,
  };
  const recommendations: string[] = [];
  const lowerHtml = (html || '').toLowerCase();
  const lowerMd = (markdown || '').toLowerCase();
  const combined = lowerHtml + ' ' + lowerMd;

  // Structured Data (JSON-LD, schema.org, microdata)
  if (lowerHtml.includes('application/ld+json')) scores.structured_data += 40;
  if (combined.includes('schema.org')) scores.structured_data += 30;
  if (lowerHtml.includes('itemscope') || lowerHtml.includes('itemprop')) scores.structured_data += 20;
  if (lowerHtml.includes('og:')) scores.structured_data += 10;
  scores.structured_data = Math.min(scores.structured_data, 100);
  if (scores.structured_data < 50) recommendations.push('Add JSON-LD structured data (schema.org) for better AI discoverability');

  // Semantic HTML (header hierarchy, semantic tags)
  if (lowerHtml.includes('<header')) scores.semantic_html += 15;
  if (lowerHtml.includes('<nav')) scores.semantic_html += 15;
  if (lowerHtml.includes('<main')) scores.semantic_html += 15;
  if (lowerHtml.includes('<article')) scores.semantic_html += 15;
  if (lowerHtml.includes('<footer')) scores.semantic_html += 10;
  if (lowerHtml.includes('aria-label')) scores.semantic_html += 15;
  if (lowerHtml.includes('<h1')) scores.semantic_html += 15;
  scores.semantic_html = Math.min(scores.semantic_html, 100);
  if (scores.semantic_html < 50) recommendations.push('Use semantic HTML5 elements (header, nav, main, article, footer)');

  // Content Quality (meta descriptions, alt text, headings)
  if (lowerHtml.includes('meta') && lowerHtml.includes('description')) scores.content_quality += 25;
  if (lowerHtml.includes('alt="') || lowerHtml.includes("alt='")) scores.content_quality += 25;
  if (lowerHtml.includes('<title')) scores.content_quality += 20;
  if (lowerHtml.includes('canonical')) scores.content_quality += 15;
  if (markdown && markdown.length > 500) scores.content_quality += 15;
  scores.content_quality = Math.min(scores.content_quality, 100);
  if (scores.content_quality < 50) recommendations.push('Add meta descriptions, image alt text, and canonical URLs');

  // Performance (page size heuristic)
  const pageSize = (html || '').length;
  if (pageSize < 100_000) scores.performance = 100;
  else if (pageSize < 300_000) scores.performance = 70;
  else if (pageSize < 500_000) scores.performance = 40;
  else scores.performance = 20;
  if (lowerHtml.includes('loading="lazy"')) scores.performance = Math.min(scores.performance + 10, 100);
  if (scores.performance < 50) recommendations.push('Reduce page size and implement lazy loading');

  // API Availability
  if (combined.includes('/api/') || combined.includes('/api.')) scores.api_availability += 40;
  if (combined.includes('openapi') || combined.includes('swagger')) scores.api_availability += 30;
  if (combined.includes('graphql')) scores.api_availability += 20;
  if (combined.includes('rest') && combined.includes('api')) scores.api_availability += 10;
  scores.api_availability = Math.min(scores.api_availability, 100);
  if (scores.api_availability < 30) recommendations.push('Consider exposing a public API or OpenAPI specification');

  // Mobile Friendly
  if (lowerHtml.includes('viewport')) scores.mobile_friendly += 40;
  if (lowerHtml.includes('responsive') || lowerHtml.includes('media')) scores.mobile_friendly += 20;
  if (lowerHtml.includes('@media')) scores.mobile_friendly += 20;
  if (lowerHtml.includes('mobile')) scores.mobile_friendly += 20;
  scores.mobile_friendly = Math.min(scores.mobile_friendly, 100);
  if (scores.mobile_friendly < 50) recommendations.push('Add viewport meta tag and responsive design');

  // Accessibility
  if (lowerHtml.includes('aria-')) scores.accessibility += 30;
  if (lowerHtml.includes('role="')) scores.accessibility += 20;
  if (lowerHtml.includes('lang="') || lowerHtml.includes("lang='")) scores.accessibility += 20;
  if (lowerHtml.includes('tabindex')) scores.accessibility += 15;
  if (lowerHtml.includes('<label')) scores.accessibility += 15;
  scores.accessibility = Math.min(scores.accessibility, 100);
  if (scores.accessibility < 50) recommendations.push('Improve accessibility: add ARIA attributes, lang tag, and form labels');

  // Security
  if (url.startsWith('https')) scores.security += 50;
  if (lowerHtml.includes('content-security-policy') || lowerHtml.includes('csp')) scores.security += 25;
  if (lowerHtml.includes('strict-transport-security')) scores.security += 25;
  scores.security = Math.min(scores.security, 100);
  if (scores.security < 50) recommendations.push('Ensure HTTPS and add security headers (CSP, HSTS)');

  const values = Object.values(scores);
  const overall_score = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return { scores, overall_score, recommendations };
}

// ── POST /ai-ready — Analyze a website for AI readiness ─────

router.post(
  '/ai-ready',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: false,
      });

      if (!scrapeResult.success || !scrapeResult.data) {
        res.status(502).json({ error: 'Failed to scrape URL', detail: scrapeResult.error });
        return;
      }

      const { scores, overall_score, recommendations } = analyzeAiReadiness(
        scrapeResult.data.html || scrapeResult.data.rawHtml || '',
        scrapeResult.data.markdown || '',
        url.trim(),
      );

      // Store scan
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_ai_ready_scans (url, scores, overall_score, recommendations, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(),
        JSON.stringify(scores),
        overall_score,
        JSON.stringify(recommendations),
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      auditLog(req, 'CREATE', 'firecrawl_ai_ready_scans', Number(result.lastInsertRowid), `AI-ready scan: ${url.trim()} (score: ${overall_score})`);

      res.json({ url: url.trim(), scores, overall_score, recommendations });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] AI-ready scan error:', msg);
      res.status(502).json({ error: 'AI-ready scan failed', detail: msg });
    }
  },
);

// ── GET /ai-ready/history — Get past AI-ready scans ─────────

router.get(
  '/ai-ready/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_ai_ready_scans ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get scan history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 3. Website Cloner / Open Lovable
// ═════════════════════════════════════════════════════════════

// ── POST /clone — Clone a website's structure ───────────────

router.post(
  '/clone',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html', 'links'],
        onlyMainContent: false,
      });

      if (!scrapeResult.success || !scrapeResult.data) {
        res.status(502).json({ error: 'Failed to scrape URL', detail: scrapeResult.error });
        return;
      }

      const data = scrapeResult.data;
      const title = (data.metadata as any)?.title || url.trim();

      // Build a simple component tree from HTML structure
      const htmlContent = data.html || '';
      const tagPattern = /<(header|nav|main|section|article|aside|footer|div|form|table|ul|ol)[\s>]/gi;
      const tags: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = tagPattern.exec(htmlContent)) !== null) {
        tags.push(match[1].toLowerCase());
      }
      const componentTree = [...new Set(tags)];

      // Extract a styles summary (count of inline styles, class usage)
      const classCount = (htmlContent.match(/class="/g) || []).length;
      const styleCount = (htmlContent.match(/style="/g) || []).length;
      const stylesSummary = `${classCount} class attributes, ${styleCount} inline styles`;

      // Store clone
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_clones (url, title, html_structure, markdown_content, component_tree, styles_summary, links, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), title,
        htmlContent.substring(0, 500_000), // limit stored HTML
        (data.markdown || '').substring(0, 500_000),
        JSON.stringify(componentTree),
        stylesSummary,
        JSON.stringify(data.links || []),
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_clones', id, `Cloned: ${url.trim()}`);

      res.json({
        id, url: url.trim(), title,
        html_structure: htmlContent.substring(0, 50_000), // return a trimmed version
        component_tree: componentTree,
        styles_summary: stylesSummary,
        links: data.links || [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Clone error:', msg);
      res.status(502).json({ error: 'Clone failed', detail: msg });
    }
  },
);

// ── GET /clones — List past clones ──────────────────────────

router.get(
  '/clones',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id, url, title, component_tree, styles_summary, created_by, created_at FROM firecrawl_clones ORDER BY created_at DESC LIMIT 100'
      ).all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list clones', detail: msg });
    }
  },
);

// ── GET /clones/:id — Get a specific clone ──────────────────

router.get(
  '/clones/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_clones WHERE id = ?').get(id);
      if (!row) { res.status(404).json({ error: 'Clone not found' }); return; }
      res.json(row);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get clone', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 4. Brand Monitor / FireGEO
// ═════════════════════════════════════════════════════════════

// ── POST /brand-monitor — Start monitoring a brand ──────────

router.post(
  '/brand-monitor',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { brand_name, keywords, competitor_urls, check_interval_hours } = req.body as {
      brand_name?: string; keywords?: string[]; competitor_urls?: string[]; check_interval_hours?: number;
    };

    if (!brand_name || typeof brand_name !== 'string' || !brand_name.trim()) {
      res.status(400).json({ error: 'brand_name is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_brand_monitors (brand_name, keywords, competitor_urls, check_interval_hours, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        brand_name.trim(),
        keywords ? JSON.stringify(keywords) : null,
        competitor_urls ? JSON.stringify(competitor_urls) : null,
        check_interval_hours || 24,
        (req as any).user?.id || (req as any).user?.userId,
        now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_brand_monitors', id, `Brand monitor: ${brand_name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create brand monitor', detail: msg });
    }
  },
);

// ── GET /brand-monitors — List all brand monitors ───────────

router.get(
  '/brand-monitors',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_brand_monitors ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list brand monitors', detail: msg });
    }
  },
);

// ── POST /brand-monitor/:id/scan — Manually scan ────────────

router.post(
  '/brand-monitor/:id/scan',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const monitor = db.prepare('SELECT * FROM firecrawl_brand_monitors WHERE id = ?').get(id) as any;
      if (!monitor) { res.status(404).json({ error: 'Brand monitor not found' }); return; }

      const now = localNow();
      const keywords: string[] = monitor.keywords ? JSON.parse(monitor.keywords) : [];
      const searchQuery = [monitor.brand_name, ...keywords].join(' ');

      // Search for brand mentions
      const searchResult = await firecrawlSearch({
        query: searchQuery,
        limit: 15,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const mentions: Array<{ url: string; title: string; snippet: string; source: string }> = [];

      for (const item of (searchResult.data || [])) {
        const snippet = (item.markdown || item.description || '').substring(0, 500);
        const mention = {
          url: item.url,
          title: item.title || '',
          snippet,
          source: 'web_search',
        };
        mentions.push(mention);

        // Store mention
        db.prepare(`
          INSERT INTO firecrawl_brand_mentions (monitor_id, url, title, snippet, source, found_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, mention.url, mention.title, mention.snippet, mention.source, now);
      }

      // Also scrape competitor URLs if configured
      const competitorUrls: string[] = monitor.competitor_urls ? JSON.parse(monitor.competitor_urls) : [];
      for (const compUrl of competitorUrls) {
        try {
          const scrapeResult = await firecrawlScrape({
            url: compUrl,
            formats: ['markdown'],
            onlyMainContent: true,
          });
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            const brandLower = monitor.brand_name.toLowerCase();
            if (scrapeResult.data.markdown.toLowerCase().includes(brandLower)) {
              const mention = {
                url: compUrl,
                title: (scrapeResult.data.metadata as any)?.title || compUrl,
                snippet: scrapeResult.data.markdown.substring(0, 500),
                source: 'competitor_site',
              };
              mentions.push(mention);
              db.prepare(`
                INSERT INTO firecrawl_brand_mentions (monitor_id, url, title, snippet, source, found_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(id, mention.url, mention.title, mention.snippet, mention.source, now);
            }
          }
        } catch { /* skip failed competitor scrapes */ }
      }

      // Update last_checked_at
      db.prepare('UPDATE firecrawl_brand_monitors SET last_checked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);

      auditLog(req, 'EXECUTE', 'firecrawl_brand_monitors', id, `Brand scan: ${mentions.length} mentions found`);

      res.json({ success: true, mention_count: mentions.length, mentions });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Brand scan error:', msg);
      res.status(502).json({ error: 'Brand scan failed', detail: msg });
    }
  },
);

// ── GET /brand-monitor/:id/mentions — Get mentions ──────────

router.get(
  '/brand-monitor/:id/mentions',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_brand_mentions WHERE monitor_id = ? ORDER BY found_at DESC LIMIT 100'
      ).all(id);
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get mentions', detail: msg });
    }
  },
);

// ── DELETE /brand-monitors/:id — Delete a monitor ───────────

router.delete(
  '/brand-monitors/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_brand_monitors WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Brand monitor not found' }); return; }

      // Also delete related mentions
      db.prepare('DELETE FROM firecrawl_brand_mentions WHERE monitor_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_brand_monitors', id, `Deleted brand monitor ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete brand monitor', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 5. Page Comparison / Migrator
// ═════════════════════════════════════════════════════════════

// ── POST /compare — Compare two URLs ────────────────────────

router.post(
  '/compare',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url_a, url_b } = req.body as { url_a?: string; url_b?: string };

    if (!url_a || typeof url_a !== 'string' || !url_a.trim()) {
      res.status(400).json({ error: 'url_a is required' }); return;
    }
    if (!url_b || typeof url_b !== 'string' || !url_b.trim()) {
      res.status(400).json({ error: 'url_b is required' }); return;
    }

    try {
      // Scrape both URLs in parallel
      const [resultA, resultB] = await Promise.all([
        firecrawlScrape({ url: url_a.trim(), formats: ['markdown'], onlyMainContent: true }),
        firecrawlScrape({ url: url_b.trim(), formats: ['markdown'], onlyMainContent: true }),
      ]);

      if (!resultA.success || !resultA.data) {
        res.status(502).json({ error: `Failed to scrape url_a: ${resultA.error}` }); return;
      }
      if (!resultB.success || !resultB.data) {
        res.status(502).json({ error: `Failed to scrape url_b: ${resultB.error}` }); return;
      }

      const markdownA = resultA.data.markdown || '';
      const markdownB = resultB.data.markdown || '';

      // Simple diff summary
      const linesA = markdownA.split('\n').filter(l => l.trim());
      const linesB = markdownB.split('\n').filter(l => l.trim());
      const setA = new Set(linesA);
      const setB = new Set(linesB);
      const onlyInA = linesA.filter(l => !setB.has(l)).length;
      const onlyInB = linesB.filter(l => !setA.has(l)).length;
      const common = linesA.filter(l => setB.has(l)).length;

      const diffSummary = `Page A: ${linesA.length} lines, Page B: ${linesB.length} lines. Common: ${common}, Only in A: ${onlyInA}, Only in B: ${onlyInB}`;

      // Store comparison
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_comparisons (url_a, url_b, markdown_a, markdown_b, diff_summary, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        url_a.trim(), url_b.trim(),
        markdownA.substring(0, 500_000),
        markdownB.substring(0, 500_000),
        diffSummary,
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_comparisons', id, `Compared: ${url_a.trim()} vs ${url_b.trim()}`);

      res.json({
        id, url_a: url_a.trim(), url_b: url_b.trim(),
        markdown_a: markdownA, markdown_b: markdownB,
        diff_summary: diffSummary,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Compare error:', msg);
      res.status(502).json({ error: 'Comparison failed', detail: msg });
    }
  },
);

// ── GET /comparisons — List past comparisons ────────────────

router.get(
  '/comparisons',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id, url_a, url_b, diff_summary, created_by, created_at FROM firecrawl_comparisons ORDER BY created_at DESC LIMIT 100'
      ).all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list comparisons', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 6. Workflow Builder
// ═════════════════════════════════════════════════════════════

// ── POST /workflows — Create a scraping workflow ────────────

router.post(
  '/workflows',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, steps } = req.body as {
      name?: string;
      steps?: Array<{ type: 'scrape' | 'search' | 'extract'; url?: string; query?: string; extract_schema?: Record<string, unknown> }>;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps must be a non-empty array' }); return;
    }

    // Validate steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!['scrape', 'search', 'extract'].includes(step.type)) {
        res.status(400).json({ error: `Step ${i}: type must be scrape, search, or extract` }); return;
      }
      if (step.type === 'scrape' && !step.url) {
        res.status(400).json({ error: `Step ${i}: url required for scrape step` }); return;
      }
      if (step.type === 'search' && !step.query) {
        res.status(400).json({ error: `Step ${i}: query required for search step` }); return;
      }
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_workflows (name, steps, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name.trim(), JSON.stringify(steps),
        (req as any).user?.id || (req as any).user?.userId,
        now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_workflows', id, `Created workflow: ${name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create workflow', detail: msg });
    }
  },
);

// ── GET /workflows — List workflows ─────────────────────────

router.get(
  '/workflows',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_workflows ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list workflows', detail: msg });
    }
  },
);

// ── GET /workflows/:id — Get a workflow ─────────────────────

router.get(
  '/workflows/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_workflows WHERE id = ?').get(id);
      if (!row) { res.status(404).json({ error: 'Workflow not found' }); return; }
      res.json(row);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get workflow', detail: msg });
    }
  },
);

// ── POST /workflows/:id/run — Execute a workflow ────────────

router.post(
  '/workflows/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const workflow = db.prepare('SELECT * FROM firecrawl_workflows WHERE id = ?').get(id) as any;
      if (!workflow) { res.status(404).json({ error: 'Workflow not found' }); return; }

      const steps: Array<{ type: string; url?: string; query?: string; extract_schema?: Record<string, unknown> }> = JSON.parse(workflow.steps);
      const now = localNow();

      // Create run record
      const runResult = db.prepare(`
        INSERT INTO firecrawl_workflow_runs (workflow_id, status, step_results, started_at)
        VALUES (?, 'running', '[]', ?)
      `).run(id, now);
      const runId = Number(runResult.lastInsertRowid);

      const stepResults: Array<{ step: number; type: string; success: boolean; data?: any; error?: string }> = [];
      let previousOutput: any = null;
      let runError: string | null = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          if (step.type === 'scrape') {
            // Use URL from step, or from previous output if available
            const targetUrl = step.url || (previousOutput?.url) || (previousOutput?.data?.[0]?.url);
            if (!targetUrl) {
              stepResults.push({ step: i, type: step.type, success: false, error: 'No URL available for scrape step' });
              continue;
            }
            const result = await firecrawlScrape({
              url: targetUrl,
              formats: ['markdown', 'html'],
              onlyMainContent: true,
              extract: step.extract_schema ? { schema: step.extract_schema } : undefined,
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          } else if (step.type === 'search') {
            const searchQuery = step.query || '';
            const result = await firecrawlSearch({
              query: searchQuery,
              limit: 10,
              scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          } else if (step.type === 'extract') {
            // Extract uses scrape with an extraction schema on the previous URL
            const targetUrl = step.url || (previousOutput?.data?.metadata?.sourceURL) || (previousOutput?.data?.[0]?.url);
            if (!targetUrl) {
              stepResults.push({ step: i, type: step.type, success: false, error: 'No URL available for extract step' });
              continue;
            }
            const result = await firecrawlScrape({
              url: targetUrl,
              formats: ['markdown'],
              onlyMainContent: true,
              extract: step.extract_schema ? { schema: step.extract_schema } : { prompt: 'Extract all key information from this page' },
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          }
        } catch (stepErr: unknown) {
          const stepMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
          stepResults.push({ step: i, type: step.type, success: false, error: stepMsg });
          runError = `Step ${i} failed: ${stepMsg}`;
          break; // Stop workflow on error
        }
      }

      const completedAt = localNow();
      const finalStatus = runError ? 'failed' : 'completed';

      db.prepare(`
        UPDATE firecrawl_workflow_runs SET status = ?, step_results = ?, error = ?, completed_at = ?
        WHERE id = ?
      `).run(finalStatus, JSON.stringify(stepResults), runError, completedAt, runId);

      auditLog(req, 'EXECUTE', 'firecrawl_workflows', id, `Workflow run ${runId}: ${finalStatus}`);

      res.json({
        success: !runError,
        run_id: runId,
        status: finalStatus,
        step_results: stepResults,
        error: runError,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Workflow run error:', msg);
      res.status(500).json({ error: 'Workflow execution failed', detail: msg });
    }
  },
);

// ── GET /workflows/:id/runs — Get workflow run history ──────

router.get(
  '/workflows/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50'
      ).all(id);
      res.json(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get workflow runs', detail: msg });
    }
  },
);

// ── DELETE /workflows/:id — Delete a workflow ───────────────

router.delete(
  '/workflows/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_workflows WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Workflow not found' }); return; }

      // Also delete related runs
      db.prepare('DELETE FROM firecrawl_workflow_runs WHERE workflow_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_workflows', id, `Deleted workflow ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete workflow', detail: msg });
    }
  },
);

export default router;
