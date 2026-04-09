# Skip Tracer v2 — Dossier Builder Design

**Date**: 2026-03-19
**Status**: Approved

## Overview

Replace the current single-source skip tracer (RapidAPI only) with a comprehensive, multi-source dossier builder that aggregates public records, paid APIs, and OSINT tools into unified person profiles. Zero-cost for most sources, $0.05/lookup for the primary people-data engine.

## Goals

1. Unified multi-source people search across 15+ data sources
2. Dossier builder UI — start with any identifier, build a full person profile
3. Plugin architecture — each data source is independently configurable
4. Local people index — scraped/fetched data accumulates for instant lookups
5. Full audit trail — every search logged with user, timestamp, sources queried
6. PDF export — generate dossier reports matching existing report style
7. Link dossiers to incidents, cases, and calls

## Data Sources

### Primary People-Data Engine
- **Open People Search API** ($0.05/lookup, no subscription)
  - 3.5B+ records: name, address, phone, email, DOB, employer, associates
  - Reverse phone, address, and email lookups
  - REST API with JSON responses

### Free Government Records
- **CourtListener** — Federal/state court records, dockets, opinions (free REST API)
- **FBI Most Wanted** — Wanted persons check (free JSON API)
- **NSOPW.gov** — National sex offender registry (public portal scraper)
- **FCC ULS** — Phone registrant/licensee data (free bulk data + API)
- **OpenCorporates** — Business ownership, officers, agents (free tier API)
- **Utah Courts (XChange)** — State criminal/civil case search (public portal)
- **Salt Lake County Assessor** — Property ownership, addresses (public portal)
- **Utah DPS Sex Offender Registry** — State sex offender search (public portal)
- **Utah Business Search** — Business entity lookup (public portal)
- **Utah DOPL** — Professional license lookup (public portal)

### Existing Integrations (Adapted)
- **RapidAPI Skip Tracing** — People search (existing, migrated as plugin)
- **MicroBilt** — DL records (existing, adapted as plugin)
- **OFAC SDN** — Sanctions screening (existing, adapted as plugin)
- **JailBase Arrests** — Arrest/booking records (existing, adapted as plugin)
- **Local Persons DB** — Internal records (existing, adapted as plugin)

### OSINT Enrichment (Local, No API Cost)
- **Username search** — Cross-platform username matching (100+ platforms)
- **Social media discovery** — Public profile search

## Architecture

### Server Structure
```
server/src/routes/skiptracer-v2/
  index.ts              — Route registration, unified search orchestrator
  types.ts              — Shared TypeScript interfaces
  sources/
    base.ts             — Abstract DataSource class (rate limiting, retry, caching)
    openPeopleSearch.ts — Primary people-data engine ($0.05/lookup)
    courtListener.ts    — Federal court records (free API)
    fbiWanted.ts        — FBI most wanted (free API)
    nsopw.ts            — National sex offender search (scraper)
    fccUls.ts           — FCC phone data (free API)
    openCorporates.ts   — Business records (free API)
    utahCourts.ts       — Utah XChange court search (scraper)
    slcAssessor.ts      — SLC property records (scraper)
    utahSexOffenders.ts — UT DPS registry (scraper)
    utahBusiness.ts     — Utah business entity (scraper)
    utahDOPL.ts         — Professional licenses (scraper)
    usernameSearch.ts   — Cross-platform username check
    socialMedia.ts      — Social profile finder
  adapters/
    rapidapi.ts         — Existing skip trace (adapted)
    microbilt.ts        — Existing DL search (adapted)
    ofac.ts             — Existing OFAC (adapted)
    arrests.ts          — Existing arrest records (adapted)
    localDb.ts          — Local persons table
  resolver.ts           — Identity resolution & deduplication engine
  dossier.ts            — Dossier CRUD, PDF export, linking
  scheduler.ts          — Background scrape job scheduler
```

### DataSource Interface
```typescript
interface SearchQuery {
  name?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  dob?: string;
  ssn_last4?: string;
  username?: string;
}

interface SourceResult {
  source: string;
  sourceType: 'api' | 'scraper' | 'local';
  confidence: number;         // 0-1 how confident this is a match
  fullName?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dob?: string;
  age?: number;
  aliases?: string[];
  addresses?: AddressRecord[];
  phones?: PhoneRecord[];
  emails?: string[];
  socialProfiles?: SocialProfile[];
  associates?: AssociateRecord[];
  courtRecords?: CourtRecord[];
  propertyRecords?: PropertyRecord[];
  licenses?: LicenseRecord[];
  vehicles?: VehicleRecord[];
  sexOffenderStatus?: SexOffenderRecord;
  custodyStatus?: CustodyRecord;
  watchlistFlags?: WatchlistFlag[];
  businessRecords?: BusinessRecord[];
  rawData?: any;
  fetchedAt: string;
}

interface DataSource {
  name: string;
  displayName: string;
  category: 'people' | 'court' | 'property' | 'business' | 'registry' | 'osint';
  costPerLookup: number;       // 0 for free sources
  search(query: SearchQuery): Promise<SourceResult[]>;
  getDetails?(id: string): Promise<SourceResult>;
  isConfigured(): boolean;
  isEnabled(): boolean;
  healthCheck(): Promise<boolean>;
}
```

### Identity Resolver
The resolver cross-references results from multiple sources:
1. Exact name + DOB match → high confidence merge
2. Name + address overlap → medium confidence merge
3. Phone/email match → link as same person
4. Fuzzy name matching (Levenshtein distance) for alias detection
5. Outputs a unified `DossierProfile` with source attribution on every field

### Database Schema

```sql
-- Scraped/fetched people index (accumulated data store)
CREATE TABLE IF NOT EXISTS people_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  middle_name TEXT,
  full_name TEXT NOT NULL,
  dob TEXT,
  age INTEGER,
  aliases TEXT,                -- JSON array
  addresses TEXT,              -- JSON array of AddressRecord
  phones TEXT,                 -- JSON array of PhoneRecord
  emails TEXT,                 -- JSON array
  social_profiles TEXT,        -- JSON array of SocialProfile
  associates TEXT,             -- JSON array of AssociateRecord
  court_records TEXT,          -- JSON array of CourtRecord
  property_records TEXT,       -- JSON array of PropertyRecord
  licenses TEXT,               -- JSON array of LicenseRecord
  vehicles TEXT,               -- JSON array of VehicleRecord
  business_records TEXT,       -- JSON array of BusinessRecord
  sex_offender_status TEXT,    -- JSON
  custody_status TEXT,         -- JSON
  watchlist_flags TEXT,        -- JSON array of WatchlistFlag
  sources TEXT NOT NULL,       -- JSON array of source names
  confidence_score REAL,       -- 0-1 overall identity confidence
  last_updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_people_index_name ON people_index(last_name, first_name);
CREATE INDEX idx_people_index_fullname ON people_index(full_name);
CREATE INDEX idx_people_index_dob ON people_index(dob);

-- Saved dossiers (investigations)
CREATE TABLE IF NOT EXISTS dossiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_name TEXT NOT NULL,
  people_index_id INTEGER REFERENCES people_index(id),
  profile_snapshot TEXT NOT NULL,    -- Full profile JSON at time of save
  notes TEXT,
  tags TEXT,                         -- JSON array of tags
  linked_incident_id INTEGER,
  linked_case_id INTEGER,
  linked_call_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  is_archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Search audit log
CREATE TABLE IF NOT EXISTS skip_tracer_searches_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_type TEXT NOT NULL,          -- 'name', 'phone', 'email', 'address', 'auto'
  query_params TEXT NOT NULL,         -- JSON of search parameters
  sources_queried TEXT,               -- JSON array of sources that were hit
  sources_responded TEXT,             -- JSON array of sources that returned data
  total_results INTEGER DEFAULT 0,
  dossier_id INTEGER REFERENCES dossiers(id),
  searched_by INTEGER REFERENCES users(id),
  cost_total REAL DEFAULT 0,          -- Total API costs for this search
  duration_ms INTEGER,                -- How long the search took
  created_at TEXT DEFAULT (datetime('now'))
);

-- Scrape/fetch job tracking
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  query_params TEXT,
  status TEXT DEFAULT 'pending',    -- pending, running, completed, failed
  results_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Source configuration (encrypted, in system_config)
-- Keys: skipv2_{source_name}_enabled, skipv2_{source_name}_config
```

## Frontend Design

### Page: SkipTracerPage (replaces existing)

**Layout**: Two-panel dossier builder

#### Left Panel — Search & Results
- **Smart search bar** at top: auto-detects input type
  - Typed a name → name search
  - Typed 10 digits → phone search
  - Typed @ → email search
  - Typed numbers + street keywords → address search
- **Source toggle chips** below search: enable/disable specific sources per search
- **Results list**: compact person cards with name, age, city/state, source badges
- **Search history** tab: recent searches with quick re-run

#### Right Panel — Dossier View
- **Header**: Person name, photo (if available), age range, aliases
  - Action buttons: "Save Dossier", "Export PDF", "Link to Case", "Add to Local DB"
- **Expandable sections** (loaded on-demand when expanded):
  1. **Identity** — Full name, DOB, SSN-last4, DL, aliases, physical description
  2. **Addresses** — Current + historical, mapped on mini-map, property ownership
  3. **Phone Numbers** — Current + historical, carrier, type (cell/landline/VoIP)
  4. **Email & Online** — Emails, social media profiles, usernames
  5. **Associates & Relatives** — Known connections (clickable → open their dossier)
  6. **Vehicles** — Registered vehicles, plate, VIN
  7. **Court & Criminal** — Court filings, arrests, warrants
  8. **Business & Employment** — Business ownership, officer roles, employer info
  9. **Financial** — Bankruptcies, liens, judgments
  10. **Registries & Watchlists** — OFAC, sex offender, FBI wanted

Each section shows:
- **Source badges** indicating which API/scraper provided each data point
- **Confidence indicator** (high/medium/low)
- **Fetched date** — how fresh the data is
- **"Refresh" button** — re-query that specific source

### Design Language
- Matches Spillman Flex dark theme (#141e2b surfaces, #1a5a9e brand blue)
- Beveled panels, LED status indicators for each source
- 2px border-radius (flat retro console)
- Monospace font for data fields (phone numbers, case numbers, addresses)
- Source badges color-coded by category (blue=people, green=court, amber=property, etc.)

## Security & Compliance
- All searches audited with user ID and timestamp
- Rate limiting: 30 searches per 5-minute window per user
- API credentials AES-256-GCM encrypted (same pattern as existing)
- Role-based access: admin, manager, supervisor, officer can search; dispatcher view-only
- Cost tracking per user and per source
- Scraper rate limits respect target site ToS (polite delays between requests)

## PDF Export
- Uses jsPDF (existing pattern)
- Cover page with RMPG Flex branding, subject photo, case reference
- Sections match the dossier view
- Source attribution on every data point
- "Generated by" footer with officer name and timestamp

## Cost Estimate
- Open People Search: ~$2.50/day at 50 searches/day
- All other sources: $0
- Monthly estimate: ~$75 for moderate usage
