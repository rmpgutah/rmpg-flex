# Firecrawl + Overwatch Integration Design

**Date:** 2026-03-21
**Status:** Approved
**Goal:** Replace 19 custom lead scrapers with a single universal Firecrawl-powered scraper engine, plus add on-demand web intelligence search to the Overwatch CRM UI.

## Problem

Overwatch CRM has 19 bespoke scraper files (`*Scraper.ts`), each with custom fetch/parse logic for a single data source. This is fragile — sites change layouts, anti-bot measures block requests, and JS-rendered pages can't be scraped with basic `fetch()`. Maintaining 19 separate parsers is a growing burden.

## Solution

### 1. Self-Hosted Firecrawl on VPS

Docker Compose service on `194.113.64.90`, port 3002 (localhost only, not internet-exposed):

```yaml
# /opt/firecrawl/docker-compose.yml
services:
  firecrawl:
    image: ghcr.io/firecrawl/firecrawl:latest
    ports:
      - "127.0.0.1:3002:3002"
    restart: unless-stopped
    environment:
      - PORT=3002
      - NUM_WORKERS_PER_QUEUE=2
```

Managed by systemd unit `firecrawl.service`. No API key needed for local access. Unlimited scraping with no credit costs.

### 2. Universal Scraper Engine

**File:** `server/src/utils/firecrawlScraper.ts`

One scraper replaces all 19. It reads source configs from `lead_scrape_sources.extra_config` and uses Firecrawl's API to scrape/search. The existing scoring, dedup, logging, and scheduling pipelines in `leadScraperBase.ts` are reused unchanged.

**Config-driven flow:**
1. Read source config from DB (`lead_scrape_sources`)
2. Call self-hosted Firecrawl API based on `extra_config.method`:
   - `scrape` → `POST http://localhost:3002/v1/scrape` (single page extraction)
   - `search` → `POST http://localhost:3002/v1/search` (web search + extraction)
3. Use Firecrawl's `extract` option with JSON schema for structured output
4. Map extracted fields to `LeadUpsertData` via `extra_config.lead_defaults`
5. Score + upsert via `leadScraperBase.calculateLeadScore()` + `upsertLead()`
6. Log results via `leadScraperBase.logScrapeRun()`

**`extra_config` JSON schema:**
```json
{
  "method": "scrape",
  "wait_for": 3000,
  "only_main_content": true,
  "include_tags": ["table", "article"],
  "extract_schema": {
    "type": "object",
    "properties": {
      "businesses": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "address": { "type": "string" },
            "phone": { "type": "string" },
            "industry": { "type": "string" }
          }
        }
      }
    }
  },
  "lead_defaults": {
    "service_interest": "patrol_service",
    "state": "UT"
  }
}
```

### 3. On-Demand Web Intelligence Search

**UI Component:** `client/src/components/crm/WebIntelPanel.tsx`

New panel in the CRM page for ad-hoc lead research:
- Search bar — officer types a query
- Results display with title, URL, snippet
- "Import as Lead" button on each result
- "Deep Scrape" button to extract full business details
- Matches Overwatch dark theme (panel-beveled, rmpg colors)

**API Endpoints:** `server/src/routes/crmFirecrawl.ts`
- `POST /api/crm/firecrawl/search` — web search via Firecrawl, return results
- `POST /api/crm/firecrawl/scrape` — scrape a specific URL, return extracted data
- `POST /api/crm/firecrawl/import` — import scraped data as a new CRM lead

### 4. Enhanced Scraper Admin Panel

Updates to existing `ScraperAdminPanel.tsx`:
- Firecrawl connection status indicator (green/red LED)
- JSON config editor for `extra_config` field mappings
- "Test Scrape" button — preview results before saving
- Source type toggle (`legacy` / `firecrawl`)

### 5. Database Changes

No new tables. Modifications:
- Add `scraper_type TEXT DEFAULT 'legacy'` column to `lead_scrape_sources`
- `extra_config` (already TEXT) stores Firecrawl config JSON

### 6. Migration Strategy

Gradual — both engines coexist during transition:
1. Add `scraper_type` column, default all existing sources to `'legacy'`
2. Build `firecrawlScraper.ts` alongside existing scrapers
3. Scheduler checks `scraper_type`: dispatches to Firecrawl or legacy engine
4. Migrate sources one-by-one via admin UI (update config, flip type)
5. Once all migrated, remove old `*Scraper.ts` files

### Files

| Action | File | Purpose |
|--------|------|---------|
| Create | `server/src/utils/firecrawlScraper.ts` | Universal Firecrawl scraper engine |
| Create | `server/src/routes/crmFirecrawl.ts` | On-demand search/scrape API routes |
| Create | `client/src/components/crm/WebIntelPanel.tsx` | On-demand search UI panel |
| Modify | `client/src/components/crm/ScraperAdminPanel.tsx` | Firecrawl config editor + status |
| Modify | `server/src/utils/leadScraperBase.ts` | Scheduler dispatches to Firecrawl |
| Modify | `server/src/models/database.ts` | Add `scraper_type` column |
| Modify | `server/src/index.ts` | Mount crmFirecrawl routes |
| Modify | `client/src/pages/CrmPage.tsx` | Add WebIntelPanel tab |
| Create | deploy script additions | Docker Compose for Firecrawl on VPS |

### Security

- Firecrawl binds to `127.0.0.1:3002` only — not internet-accessible
- All CRM routes require JWT auth via `authenticate` middleware
- On-demand search/scrape requires `admin` or `manager` role
- Rate limiting on search endpoint (prevent abuse)
- Audit logging on all scrape/import actions
