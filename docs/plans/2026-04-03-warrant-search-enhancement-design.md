# Warrant Search Enhancement Design

**Date**: 2026-04-03
**Approach**: Option B — Enhanced Existing Tabs + Unified Search Bar

## Overview

Upgrade the warrant system across 4 areas while preserving the existing 5-tab layout that officers already know. Each enhancement is additive and independently useful.

## 1. Unified Cross-Source Search

Replace the "UTAH SEARCH" tab with a "SEARCH ALL" tab that queries local DB, Utah state API, and multi-state scraped sources simultaneously.

### Search Form
- First Name, Last Name, DOB fields
- Warrant Number, Court/Jurisdiction, Source dropdowns
- Collapsible "Advanced Filters": date range, offense level, charge keyword, status, type
- Typeahead on name fields (debounced 300ms, queries local persons table)

### New API Endpoint
```
POST /api/warrants/search-all
Body: { firstName?, lastName?, dob?, warrantNumber?, court?,
        source?, offenseLevel?, status?, type?, chargeKeyword?,
        dateFrom?, dateTo? }
Returns: { local: Warrant[], utah: UtahWarrantResult[],
           scraped: ScrapedWarrant[], meta: { duration, sources } }
```

Fans out to:
1. Local `warrants` table (SQL with filters)
2. Utah API live search (or cache if blocked) via existing `searchUtahWarrantsLive`/`searchUtahWarrantsCache`
3. `scraped_warrants` table (SQL with filters)

### Results Display
- Grouped by source with count badges
- Click any result opens detail panel
- "Import to Local" button on external results
- Session-persisted search history

## 2. Watch List Upgrade

### Rich Person Cards
Each flagged person displayed as an expandable card showing:
- Photo (from `persons.photo_url`)
- Physical description (gender, race, height, weight, hair, eyes)
- Last known address
- All associated warrants listed inline (local + external)
- Action buttons: Search All, Print Sheet, View Record, View Calls, Run Check

### Priority Sorting
- Grouped by highest severity: felony > misdemeanor > infraction > civil
- Within groups, sorted by newest warrant date
- Sort controls: severity, recency, source

### Server Enhancement
Enhance `GET /api/warrants/utah-search/auto-poll-status` to include:
- Person physical descriptions (from `persons` table join)
- Full warrant details per person (not just counts)
- Last known location data

### Embedded Map
- Google Maps panel below sort controls showing markers for flagged persons with known locations
- Reuses existing `googleMapsLoader.ts` + dark style
- Click marker scrolls to person card
- Collapsible (toggle button)

## 3. Print / PDF Generation

All PDFs use existing `jsPDF` infrastructure in `recordPdfGenerator.ts`.

### 3a. Enhanced Individual Warrant Sheet
Upgrade existing warrant PDF to add:
- Subject photo in upper-right corner
- Physical description block
- QR code linking to warrant detail URL
- Service attempt history
- RMPG seal + "WARRANT — LAW ENFORCEMENT USE ONLY" header

### 3b. BOLO Packet Generator
New toolbar button on Watch List tab:
- 2-3 subjects per page sorted by severity
- Each subject: photo, physical description, all active warrants, last known address
- Pre-generation filter: severity level, source, date range
- RMPG header + "BE ON THE LOOKOUT" branding

### 3c. Warrant Summary Report
New "Export Report" on Dashboard tab:
- Date range picker before generation
- Stats: totals by status, severity, type, source, top courts
- Scan activity summary
- New endpoint: `GET /api/warrants/summary-report?from=&to=`
- Single-page PDF for supervisor review

## 4. Internal Integration

### 4a. Warrant Detail → Other Modules
Clickable links in warrant detail panel:
- Subject name → `/records?tab=persons&personId=X`
- "View Linked Calls" → `/dispatch?personId=X`
- "View Arrests" → `/records?tab=arrests&personId=X`
- "View Court Cases" → `/court-tracker?personId=X`

### 4b. Other Modules → Warrants
- **PersonsTab**: Warrant count badge + link to WarrantsPage filtered by person
- **DispatchPage call detail**: Warrant badge next to person names, clickable
- **MdtPage**: Same warrant badge treatment

### 4c. Watch List Card Navigation
Each person card has buttons routing to records, dispatch, and unified search using existing routes with query parameters. No new API endpoints needed.

## Files Affected

### New Files
- None (all changes are to existing files)

### Modified Files
- `client/src/pages/WarrantsPage.tsx` — Unified search tab, watch list cards, map, print buttons
- `server/src/routes/warrants.ts` — `search-all` endpoint, `summary-report` endpoint, enhanced auto-poll-status
- `client/src/utils/recordPdfGenerator.ts` — Enhanced warrant sheet, BOLO generator, summary report
- `client/src/pages/records/PersonsTab.tsx` — Warrant badge
- `client/src/pages/dispatch/DispatchPage.tsx` — Warrant badge in call detail
- `client/src/pages/MdtPage.tsx` — Warrant badge

### New API Endpoints
1. `POST /api/warrants/search-all` — Unified cross-source search
2. `GET /api/warrants/summary-report?from=&to=` — Summary stats for PDF
