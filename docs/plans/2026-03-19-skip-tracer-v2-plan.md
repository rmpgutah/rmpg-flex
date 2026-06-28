# Skip Tracer v2 — Dossier Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-source skip tracer with a multi-source dossier builder that aggregates public records, existing APIs, and OSINT tools into unified person profiles.

**Architecture:** Plugin-based data source system where each provider implements a `DataSource` interface. A resolver cross-references results across sources and builds unified dossier profiles. Frontend is a two-panel dossier builder with smart search and expandable sections.

**Tech Stack:** Express + TypeScript (server), React + Tailwind (client), better-sqlite3, jsPDF, cheerio (scraping)

---

## Phase 1: Core Infrastructure (Tasks 1-5)

### Task 1: Types & Interfaces
- Create: `server/src/routes/skiptracer-v2/types.ts`
- All shared interfaces: SearchQuery, SourceResult, DataSource, DossierProfile, sub-records (AddressRecord, PhoneRecord, CourtRecord, etc.)

### Task 2: Base DataSource Class
- Create: `server/src/routes/skiptracer-v2/sources/base.ts`
- Abstract class with: rate limiting, retry with backoff, result caching, encrypted config helpers
- Uses same AES-256-GCM encryption pattern as existing skiptracer.ts

### Task 3: Database Tables
- Create: `server/src/routes/skiptracer-v2/database.ts`
- Tables: `people_index`, `dossiers`, `skip_tracer_searches_v2`, `scrape_jobs`
- Indexes on name, DOB, full_name for fast lookups

### Task 4: Identity Resolver
- Create: `server/src/routes/skiptracer-v2/resolver.ts`
- Cross-references results from multiple sources
- Matching: exact name+DOB (0.9+), name+address overlap (0.7+), phone/email match (0.6+)
- Levenshtein distance for typo tolerance
- Deduplicates addresses, phones, emails while retaining source attribution

### Task 5: Search Orchestrator Route
- Create: `server/src/routes/skiptracer-v2/index.ts`
- Modify: `server/src/index.ts` (mount at `/api/skiptracer-v2`)
- Endpoints: search, sources list/config, dossier CRUD, history, stats, PDF export
- Search: parallel `Promise.allSettled` across all enabled sources → resolver → audit log

---

## Phase 2: Existing API Adapters (Tasks 6-10)

### Task 6: RapidAPI Adapter
- Create: `server/src/routes/skiptracer-v2/sources/rapidapi.ts`
- Wraps existing skiptracer.ts logic into DataSource interface
- Reads same `skiptracer_api_key` config

### Task 7: Local Database Adapter
- Create: `server/src/routes/skiptracer-v2/sources/localDb.ts`
- Searches `persons` table + `people_index` table
- Free, instant, always enabled

### Task 8: OFAC Adapter
- Create: `server/src/routes/skiptracer-v2/sources/ofac.ts`
- Wraps existing `searchOfacLocal()` → returns watchlist flags

### Task 9: Arrests Adapter
- Create: `server/src/routes/skiptracer-v2/sources/arrests.ts`
- Searches existing `arrest_records` table → maps to custody/court records

### Task 10: MicroBilt Adapter
- Create: `server/src/routes/skiptracer-v2/sources/microbilt.ts`
- Wraps existing MicroBilt DL search → returns identity + DL data

---

## Phase 3: Free API Sources (Tasks 11-14)

### Task 11: CourtListener Source
- Create: `server/src/routes/skiptracer-v2/sources/courtListener.ts`
- API: `https://www.courtlistener.com/api/rest/v4/`
- Auth: Token (free account), Rate limit: 5,000/hour
- Endpoints: `/dockets/?q=name`, `/people/?q=name`

### Task 12: FBI Most Wanted Source
- Create: `server/src/routes/skiptracer-v2/sources/fbiWanted.ts`
- API: `https://api.fbi.gov/@wanted?title=name`
- No auth needed, completely free

### Task 13: FCC ULS Source
- Create: `server/src/routes/skiptracer-v2/sources/fccUls.ts`
- API: `https://data.fcc.gov/api/license-view/basicSearch/getLicenses`
- No auth needed, free

### Task 14: OpenCorporates Source
- Create: `server/src/routes/skiptracer-v2/sources/openCorporates.ts`
- API: `https://api.opencorporates.com/v0.4/officers/search?q=name`
- Free tier: 500 requests/month, no auth

---

## Phase 4: Utah-Specific Scrapers (Tasks 15-19)

### Task 15: Utah Courts (XChange) Scraper
- Create: `server/src/routes/skiptracer-v2/sources/utahCourts.ts`
- Target: `https://www.utcourts.gov/xchange/` public case search
- Uses cheerio for HTML parsing, 2-second polite delay

### Task 16: Salt Lake County Assessor Scraper
- Create: `server/src/routes/skiptracer-v2/sources/slcAssessor.ts`
- Searches by owner name → property records, addresses, assessed values

### Task 17: NSOPW (National Sex Offender) Source
- Create: `server/src/routes/skiptracer-v2/sources/nsopw.ts`
- Target: `https://www.nsopw.gov/` search
- Returns offender details, offenses, addresses

### Task 18: Utah Business Entity Search
- Create: `server/src/routes/skiptracer-v2/sources/utahBusiness.ts`
- Target: `https://secure.utah.gov/bes/`
- Business ownership, officer/agent roles

### Task 19: Utah DOPL (Professional Licenses)
- Create: `server/src/routes/skiptracer-v2/sources/utahDOPL.ts`
- License verification: type, status, dates

---

## Phase 5: OSINT + Registry (Tasks 20-21)

### Task 20: Username Search Source
- Create: `server/src/routes/skiptracer-v2/sources/usernameSearch.ts`
- Checks username across: Facebook, Instagram, X, LinkedIn, TikTok, Reddit, GitHub, Pinterest, YouTube
- Method: HEAD/GET request to `platform.com/username`, check 200 vs 404
- Rate limited to avoid blocks

### Task 21: Source Registry
- Create: `server/src/routes/skiptracer-v2/sources/registry.ts`
- Central registry: `getAllSources()`, `getEnabledSources()`, `getSourceByName()`

---

## Phase 6: Frontend — Dossier Builder (Tasks 22-24)

### Task 22: Dossier Builder Page
- Create: `client/src/pages/skiptracer/SkipTracerV2Page.tsx`
- Modify: router config (add route), MenuBar.tsx (add nav entry under Records)
- Two-panel layout:
  - Left: Smart search bar (auto-detects name/phone/email/address), source toggles, result cards
  - Right: Dossier view with expandable sections (Identity, Addresses, Phones, Email/Social, Associates, Court, Property, Business, Registries)
- Spillman Flex dark theme, source badges, confidence indicators, copy-to-clipboard

### Task 23: Dossier PDF Export
- Modify: `server/src/routes/skiptracer-v2/index.ts` (PDF endpoint)
- jsPDF: cover page with RMPG branding, sections matching dossier view, source attribution

### Task 24: Admin Configuration Panel
- Modify: `client/src/pages/AdminPage.tsx` (add Skip Tracer V2 section)
- Source toggles, API key inputs, health checks, usage stats

---

## Phase 7: Integration & Polish (Tasks 25-27)

### Task 25: Wire Up Navigation
- Point "Skip Tracer" menu item to V2 page
- Keep old route as fallback at `/api/skiptracer`

### Task 26: People Index Background Sync
- Create: `server/src/routes/skiptracer-v2/scheduler.ts`
- After each search, save results to `people_index` for future instant lookups

### Task 27: Build, Test & Deploy
- Test each source via `/api/skiptracer-v2/sources`
- Test unified search, dossier save/load/export, PDF, admin config
- Build: `cd client && npx vite build`
- Deploy: `bash deploy/deploy.sh`
- Verify: `curl -sf https://rmpgutah.us/api/health`

---

## GitHub OSINT Tools to Integrate

These are vetted, safe open-source tools/libraries to reference or adapt code from:

| Tool | GitHub | Purpose | Safety |
|------|--------|---------|--------|
| **sherlock** | `sherlock-project/sherlock` | Username search across 400+ social networks | Well-maintained, 50k+ stars |
| **maigret** | `soxoj/maigret` | Username enumeration across 2500+ sites | Active, 10k+ stars |
| **social-analyzer** | `qeeqbox/social-analyzer` | Social media profile finder | 11k+ stars |
| **holehe** | `megadose/holehe` | Check if email is used on various sites | 7k+ stars |
| **theHarvester** | `laramies/theHarvester` | Email, subdomain, name gathering from public sources | 12k+ stars, Kali Linux included |
| **Maltego CE** | Open source transforms | Entity relationship graphing | Industry standard |

These projects provide the URL patterns and detection logic for username/email searches. We adapt their platform lists and detection methods rather than running them as subprocesses.
