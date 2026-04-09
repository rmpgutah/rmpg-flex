# Firecrawl + Overwatch Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 19 custom lead scrapers with a single universal Firecrawl-powered scraper engine, self-hosted on the VPS, plus add an on-demand web intelligence search panel to the Overwatch CRM UI.

**Architecture:** Self-hosted Firecrawl (Docker, port 3002 localhost-only) → universal `firecrawlScraper.ts` reads source configs from `lead_scrape_sources.extra_config` → uses Firecrawl `/v1/scrape` and `/v1/search` APIs → feeds into existing `leadScraperBase.ts` scoring/dedup/logging pipeline. On-demand search exposed via new API routes + `WebIntelPanel.tsx` in the CRM page.

**Tech Stack:** Express, SQLite (better-sqlite3), React + Tailwind (dark theme), Docker, Firecrawl self-hosted API

---

## Task 1: Database Migration — Add `scraper_type` Column

**Files:**
- Modify: `server/src/models/database.ts` (in `migrateSchema()` function, ~line 1376)

**Step 1: Add the migration**

In `migrateSchema()`, add after the existing `addCol` calls:

```typescript
// ── LEAD SCRAPE SOURCES — Firecrawl migration ──
addCol('lead_scrape_sources', 'scraper_type', "TEXT DEFAULT 'legacy'");
```

**Step 2: Verify by restarting server**

Run: `cd server && npx tsx src/index.ts` (or dev mode)
Expected: Server starts, migration runs silently (column added or already exists)

**Step 3: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(overwatch): add scraper_type column to lead_scrape_sources for Firecrawl migration"
```

---

## Task 2: Firecrawl Client Utility

**Files:**
- Create: `server/src/utils/firecrawlClient.ts`

**Step 1: Create the Firecrawl HTTP client**

```typescript
// ============================================================
// Firecrawl Client — HTTP wrapper for self-hosted Firecrawl API
// Connects to localhost:3002 (Docker container on VPS)
// ============================================================

const FIRECRAWL_BASE = process.env.FIRECRAWL_URL || 'http://localhost:3002';
const FIRECRAWL_TIMEOUT = 30_000;

export interface FirecrawlScrapeOptions {
  url: string;
  formats?: ('markdown' | 'html' | 'links')[];
  onlyMainContent?: boolean;
  waitFor?: number;
  includeTags?: string[];
  excludeTags?: string[];
  extract?: {
    schema: Record<string, any>;
    prompt?: string;
  };
}

export interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    extract?: Record<string, any>;
    metadata?: { title?: string; description?: string; sourceURL?: string };
  };
  error?: string;
}

export interface FirecrawlSearchOptions {
  query: string;
  limit?: number;
  scrapeOptions?: {
    formats?: string[];
    onlyMainContent?: boolean;
  };
}

export interface FirecrawlSearchResult {
  success: boolean;
  data?: Array<{
    url: string;
    title?: string;
    description?: string;
    markdown?: string;
  }>;
  error?: string;
}

export async function firecrawlScrape(options: FirecrawlScrapeOptions): Promise<FirecrawlScrapeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: options.url,
        formats: options.formats || ['markdown'],
        onlyMainContent: options.onlyMainContent ?? true,
        waitFor: options.waitFor,
        includeTags: options.includeTags,
        excludeTags: options.excludeTags,
        extract: options.extract,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `Firecrawl HTTP ${res.status}: ${text}` };
    }
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Firecrawl request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function firecrawlSearch(options: FirecrawlSearchOptions): Promise<FirecrawlSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: options.query,
        limit: options.limit || 10,
        scrapeOptions: options.scrapeOptions,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `Firecrawl HTTP ${res.status}: ${text}` };
    }
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Firecrawl search failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function firecrawlHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add server/src/utils/firecrawlClient.ts
git commit -m "feat(overwatch): add Firecrawl HTTP client for self-hosted API"
```

---

## Task 3: Universal Firecrawl Scraper Engine

**Files:**
- Create: `server/src/utils/firecrawlScraper.ts`
- Modify: `server/src/utils/leadScraperBase.ts` (~line 353, `scheduleLeadScrapers`)

**Step 1: Create the universal scraper**

```typescript
// ============================================================
// Firecrawl Universal Scraper
// Config-driven scraper that replaces all 19 legacy scrapers.
// Reads extra_config from lead_scrape_sources, calls Firecrawl API,
// maps results to LeadUpsertData, scores + upserts via leadScraperBase.
// ============================================================

import {
  type SourceConfig,
  type ScrapeResult,
  type LeadUpsertData,
  getSourceConfig,
  upsertLead,
  registerScraper,
} from './leadScraperBase';
import { firecrawlScrape, firecrawlSearch } from './firecrawlClient';
import { getDb } from '../models/database';

// ── Config types ──────────────────────────────────────

interface FirecrawlSourceConfig {
  method: 'scrape' | 'search';
  search_query?: string;
  wait_for?: number;
  only_main_content?: boolean;
  include_tags?: string[];
  exclude_tags?: string[];
  extract_schema?: Record<string, any>;
  extract_prompt?: string;
  lead_defaults?: Partial<LeadUpsertData>;
  result_array_path?: string; // JSON path to array of results in extract output
}

function parseExtraConfig(raw: string | null): FirecrawlSourceConfig | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Core scrape function ──────────────────────────────

async function scrapeWithFirecrawl(sourceKey: string): Promise<ScrapeResult> {
  const start = Date.now();
  const config = getSourceConfig(sourceKey);
  if (!config) {
    return { source_key: sourceKey, status: 'error', records_found: 0, records_imported: 0, records_skipped: 0, error_message: 'Source config not found', duration_ms: 0 };
  }

  const extra = parseExtraConfig(config.extra_config);
  if (!extra) {
    return { source_key: sourceKey, status: 'error', records_found: 0, records_imported: 0, records_skipped: 0, error_message: 'Invalid or missing extra_config JSON', duration_ms: Date.now() - start };
  }

  let leads: Partial<LeadUpsertData>[] = [];

  if (extra.method === 'search' && extra.search_query) {
    // ── Search mode ──
    const result = await firecrawlSearch({
      query: extra.search_query,
      limit: 20,
      scrapeOptions: extra.only_main_content !== false ? { formats: ['markdown'], onlyMainContent: true } : undefined,
    });
    if (!result.success || !result.data) {
      return { source_key: sourceKey, status: 'error', records_found: 0, records_imported: 0, records_skipped: 0, error_message: result.error || 'Search returned no data', duration_ms: Date.now() - start };
    }
    // Map search results to leads
    leads = result.data.map(item => ({
      business_name: item.title || 'Unknown',
      source_url: item.url,
      notes: item.description || undefined,
      ...extra.lead_defaults,
    }));
  } else {
    // ── Scrape mode ──
    if (!config.base_url) {
      return { source_key: sourceKey, status: 'error', records_found: 0, records_imported: 0, records_skipped: 0, error_message: 'No base_url configured', duration_ms: Date.now() - start };
    }
    const result = await firecrawlScrape({
      url: config.base_url,
      formats: extra.extract_schema ? ['markdown'] : ['markdown'],
      onlyMainContent: extra.only_main_content ?? true,
      waitFor: extra.wait_for,
      includeTags: extra.include_tags,
      excludeTags: extra.exclude_tags,
      extract: extra.extract_schema ? { schema: extra.extract_schema, prompt: extra.extract_prompt } : undefined,
    });
    if (!result.success || !result.data) {
      return { source_key: sourceKey, status: 'error', records_found: 0, records_imported: 0, records_skipped: 0, error_message: result.error || 'Scrape returned no data', duration_ms: Date.now() - start };
    }

    // If extract was used, parse structured output
    if (result.data.extract) {
      const extracted = result.data.extract;
      const arrayPath = extra.result_array_path || 'businesses';
      const items = Array.isArray(extracted[arrayPath]) ? extracted[arrayPath] : [extracted];
      leads = items.map((item: any) => ({
        business_name: item.name || item.business_name || 'Unknown',
        contact_name: item.contact_name || item.contact || undefined,
        contact_phone: item.phone || item.contact_phone || undefined,
        contact_email: item.email || item.contact_email || undefined,
        address: item.address || undefined,
        city: item.city || undefined,
        state: item.state || undefined,
        zip: item.zip || undefined,
        industry: item.industry || item.type || undefined,
        source_url: config.base_url || undefined,
        ...extra.lead_defaults,
      }));
    }
  }

  // ── Upsert leads ──
  let imported = 0;
  let skipped = 0;
  for (const lead of leads) {
    if (!lead.business_name || lead.business_name === 'Unknown') { skipped++; continue; }
    const data: LeadUpsertData = {
      source: sourceKey,
      source_id: lead.source_url || lead.business_name,
      source_url: lead.source_url,
      business_name: lead.business_name,
      industry: lead.industry,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone,
      address: lead.address,
      city: lead.city,
      state: lead.state || 'UT',
      zip: lead.zip,
      notes: lead.notes,
      service_interest: lead.service_interest,
      ...extra.lead_defaults,
    };
    const result = upsertLead(data);
    if (result.inserted) imported++;
    else skipped++;
  }

  return {
    source_key: sourceKey,
    status: imported > 0 ? 'success' : leads.length > 0 ? 'partial' : 'success',
    records_found: leads.length,
    records_imported: imported,
    records_skipped: skipped,
    duration_ms: Date.now() - start,
  };
}

// ── Auto-register all Firecrawl sources ──────────────

export function registerFirecrawlScrapers(): void {
  const db = getDb();
  const sources = db.prepare("SELECT source_key FROM lead_scrape_sources WHERE scraper_type = 'firecrawl'").all() as { source_key: string }[];
  for (const { source_key } of sources) {
    registerScraper(source_key, () => scrapeWithFirecrawl(source_key));
  }
  if (sources.length > 0) {
    console.log(`[Firecrawl] Registered ${sources.length} Firecrawl-powered scraper(s)`);
  }
}
```

**Step 2: Update scheduler to load Firecrawl scrapers**

In `server/src/index.ts`, after the line `scheduleLeadScrapers();` (~line 791), add:

```typescript
import { registerFirecrawlScrapers } from './utils/firecrawlScraper';
// ... in the startup block, BEFORE scheduleLeadScrapers():
registerFirecrawlScrapers();
```

**Step 3: Commit**

```bash
git add server/src/utils/firecrawlScraper.ts server/src/index.ts
git commit -m "feat(overwatch): universal Firecrawl scraper engine with config-driven extraction"
```

---

## Task 4: On-Demand Search/Scrape API Routes

**Files:**
- Create: `server/src/routes/crmFirecrawl.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create the API routes**

```typescript
// ============================================================
// CRM Firecrawl Routes — On-demand web intelligence search
// POST /api/crm/firecrawl/search  — web search
// POST /api/crm/firecrawl/scrape  — scrape specific URL
// POST /api/crm/firecrawl/import  — import result as lead
// GET  /api/crm/firecrawl/status  — Firecrawl health check
// ============================================================

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch, firecrawlHealthCheck } from '../utils/firecrawlClient';
import { upsertLead, type LeadUpsertData } from '../utils/leadScraperBase';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticate);

// Health check
router.get('/firecrawl/status', requireRole(['admin', 'manager']), async (_req, res) => {
  const healthy = await firecrawlHealthCheck();
  res.json({ connected: healthy });
});

// Web search
router.post('/firecrawl/search', requireRole(['admin', 'manager']), async (req, res) => {
  const { query, limit } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }
  const result = await firecrawlSearch({ query: query.trim(), limit: Math.min(limit || 10, 20) });
  if (!result.success) {
    return res.status(502).json({ error: result.error || 'Firecrawl search failed' });
  }
  auditLog(req, 'SEARCH', 'firecrawl', null, null, { query });
  res.json({ results: result.data || [] });
});

// Scrape specific URL
router.post('/firecrawl/scrape', requireRole(['admin', 'manager']), async (req, res) => {
  const { url, extract_schema } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }
  const result = await firecrawlScrape({
    url,
    formats: ['markdown'],
    onlyMainContent: true,
    extract: extract_schema ? { schema: extract_schema } : undefined,
  });
  if (!result.success) {
    return res.status(502).json({ error: result.error || 'Firecrawl scrape failed' });
  }
  auditLog(req, 'SCRAPE', 'firecrawl', null, null, { url });
  res.json({ data: result.data });
});

// Import scraped data as a CRM lead
router.post('/firecrawl/import', requireRole(['admin', 'manager']), async (req, res) => {
  const { business_name, contact_name, contact_phone, contact_email, address, city, state, zip, industry, source_url, notes, service_interest } = req.body;
  if (!business_name) {
    return res.status(400).json({ error: 'business_name is required' });
  }
  const leadData: LeadUpsertData = {
    source: 'firecrawl_manual',
    source_id: source_url || business_name,
    source_url,
    business_name,
    contact_name,
    contact_phone,
    contact_email,
    address,
    city,
    state: state || 'UT',
    zip,
    industry,
    notes,
    service_interest,
  };
  const result = upsertLead(leadData);
  auditLog(req, 'CREATE', 'crm_leads', result.id, null, leadData);
  res.json({ success: true, id: result.id, inserted: result.inserted });
});

export default router;
```

**Step 2: Mount in index.ts**

After the existing CRM route mounts (~line 485):
```typescript
import crmFirecrawlRoutes from './routes/crmFirecrawl';
// ...
app.use('/api/crm', crmFirecrawlRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/crmFirecrawl.ts server/src/index.ts
git commit -m "feat(overwatch): on-demand Firecrawl search/scrape/import API routes"
```

---

## Task 5: Web Intelligence Search Panel (Frontend)

**Files:**
- Create: `client/src/components/crm/WebIntelPanel.tsx`
- Modify: `client/src/pages/CrmPage.tsx` (~line 48, type + ~line 423 rendering)

**Step 1: Create WebIntelPanel component**

Build a panel with:
- Search input (text, submit button)
- Results list (title, URL, snippet, "Import as Lead" button per result)
- Deep scrape modal (click URL → scrape full page → show extracted data → import)
- Firecrawl connection status LED in panel header
- Dark theme: `panel-beveled bg-surface-base`, `text-rmpg-*` colors, `rounded-sm`

Component should:
- Call `POST /api/crm/firecrawl/search` on search submit
- Call `POST /api/crm/firecrawl/scrape` for deep scrape
- Call `POST /api/crm/firecrawl/import` for import
- Show loading spinner during operations
- Toast on success/error
- Disable search button while loading

**Step 2: Add "Web Intel" section to CrmPage**

In `CrmPage.tsx`:
- Add `'webintel'` to the `CrmSection` type (line 48)
- Add nav item in the section list with `Globe` icon
- Add render block: `{activeSection === 'webintel' && <WebIntelPanel />}`
- Import `WebIntelPanel` at top

**Step 3: Commit**

```bash
git add client/src/components/crm/WebIntelPanel.tsx client/src/pages/CrmPage.tsx
git commit -m "feat(overwatch): Web Intelligence search panel in CRM UI"
```

---

## Task 6: Enhanced Scraper Admin Panel

**Files:**
- Modify: `client/src/components/crm/ScraperAdminPanel.tsx`

**Step 1: Add Firecrawl status + type toggle**

Enhancements:
- Add Firecrawl connection status LED at top (calls `GET /api/crm/firecrawl/status`)
- Add `scraper_type` badge on each source row (`legacy` gray, `firecrawl` blue)
- Add "Test Scrape" button that calls `POST /api/crm/scrape-sources/:key/poll` and shows preview
- Add `extra_config` JSON editor (textarea with JSON validation) for Firecrawl sources

**Step 2: Commit**

```bash
git add client/src/components/crm/ScraperAdminPanel.tsx
git commit -m "feat(overwatch): enhance ScraperAdminPanel with Firecrawl config editor + status"
```

---

## Task 7: Docker Compose for Self-Hosted Firecrawl

**Files:**
- Create: `deploy/firecrawl/docker-compose.yml`
- Create: `deploy/firecrawl/setup.sh`

**Step 1: Create Docker Compose file**

```yaml
version: "3.9"
services:
  firecrawl:
    image: ghcr.io/firecrawl/firecrawl:latest
    ports:
      - "127.0.0.1:3002:3002"
    restart: unless-stopped
    environment:
      - PORT=3002
      - NUM_WORKERS_PER_QUEUE=2
    volumes:
      - firecrawl-data:/data
volumes:
  firecrawl-data:
```

**Step 2: Create setup script**

```bash
#!/bin/bash
# deploy/firecrawl/setup.sh — Install and start Firecrawl on VPS
set -e
echo "Installing Firecrawl self-hosted..."
mkdir -p /opt/firecrawl
cp docker-compose.yml /opt/firecrawl/
cd /opt/firecrawl
docker compose pull
docker compose up -d
echo "Firecrawl running on localhost:3002"
# Verify
curl -sf http://localhost:3002/v1/health && echo " — Health check OK" || echo " — Health check FAILED"
```

**Step 3: Commit**

```bash
git add deploy/firecrawl/
git commit -m "feat(overwatch): Docker Compose setup for self-hosted Firecrawl on VPS"
```

---

## Task 8: Integration Test + Verification

**Step 1: Type-check**

```bash
cd client && npx tsc --noEmit --skipLibCheck
```

**Step 2: Build**

```bash
cd client && npx vite build
```

**Step 3: Manual verification**

- Start dev server, navigate to `/crm`
- Verify "Web Intel" tab appears in CRM navigation
- Verify Scraper Admin panel shows Firecrawl status LED
- Verify search panel renders correctly (won't return results without Firecrawl running)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(overwatch): Firecrawl integration complete — universal scraper + web intel search"
```
