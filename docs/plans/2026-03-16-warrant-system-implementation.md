# Warrant System Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 6-tab warrant page with a 3-tab alert dashboard + unified search, add universal warrant scanner that auto-creates local warrants from external hits, flags persons app-wide, and alerts dispatch when flagged persons are attached to calls.

**Architecture:** Backend-first — build the universal scanner and schema changes, then the shared WarrantBadge component, then rewrite the WarrantsPage UI, then wire dispatch integration. Each task is independently deployable.

**Tech Stack:** Express + better-sqlite3 (backend), React 18 + Tailwind (frontend), WebSocket for real-time alerts, jsPDF for warrant PDFs.

**Design Doc:** `docs/plans/2026-03-16-warrant-system-redesign.md`

---

## Task 1: Schema Migrations — New Warrant Columns

**Files:**
- Modify: `server/src/models/database.ts` (migrateSchema function, ~line 1299)

Add new columns to warrants table for universal scanner support:
- `source TEXT DEFAULT 'manual'` — origin (manual, utah_api, scraper, court_records)
- `external_warrant_id TEXT` — dedup key for external warrants
- `external_source_key TEXT` — which scraper/API found it
- `auto_created INTEGER DEFAULT 0` — distinguishes manual vs auto

Add unique index on external_warrant_id (WHERE NOT NULL) for dedup.

**Verify:** `cd server && npx tsc --noEmit`
**Commit:** `feat(warrants): add source, external_warrant_id, auto_created columns to warrants table`

---

## Task 2: Universal Warrant Scanner — Core Function

**Files:**
- Create: `server/src/utils/universalWarrantScanner.ts`

Core module exports:

### `universalWarrantCheck(personId, force?)`
1. Load person (first_name, last_name, dob, flags)
2. Cooldown check (1hr unless forced)
3. Query Utah API via `searchUtahWarrantsLive()`
4. Query scraped_warrants table for name matches
5. Name match (case-insensitive) + DOB verification (age +/-1yr)
6. Deduplicate by external_warrant_id
7. Auto-create local warrant records (EXT-YYYY-NNNNN format)
8. Only clear auto-created warrants if ALL sources responded (no errors)
9. Update person flags via `updatePersonWarrantFlag()`
10. Broadcast `warrant:hit` via WebSocket

### `updatePersonWarrantFlag(personId)`
- Count active warrants for person
- Determine highest severity (felony > misdemeanor > infraction)
- Update person's `flags` JSON: add/remove `{ type: "ACTIVE_WARRANT", severity, count, updated_at }`

### `inferWarrantType(chargeDescription)`
- Parse charge text for bench/FTA, search, civil keywords
- Default to 'arrest'

### `runUniversalWarrantScan()`
- Load all non-archived persons with first+last names
- Call `universalWarrantCheck()` for each with 3s throttle
- Log totals: persons checked, hits, created, cleared, errors

**Verify:** `cd server && npx tsc --noEmit`
**Commit:** `feat(warrants): add universal warrant scanner — checks all sources, auto-creates warrants, flags persons`

---

## Task 3: Wire Scanner into Person Creation + Scheduled Scan

**Files:**
- Modify: `server/src/routes/records.ts` — POST / (create person)
- Modify: `server/src/routes/dispatch/callLifecycle.ts` — call_persons INSERT
- Modify: `server/src/routes/incidents.ts` — incident_persons INSERT
- Modify: `server/src/routes/fieldInterviews.ts` — subject_person_id set
- Modify: `server/src/index.ts` — replace old scheduler
- Modify: `server/src/routes/warrants.ts` — add manual check endpoint

### Person creation/linking hooks
After person is created or linked to call/incident, fire-and-forget:
```typescript
universalWarrantCheck(personId).catch(err =>
  console.error('[Warrant Check]', err.message)
);
```

### Replace scheduled scan in index.ts
Replace `scheduleUtahWarrantSync()` with `startUniversalWarrantScan()`:
- 2-minute startup delay
- Then hourly interval
- Keep old Utah sync import but don't call it

### Manual check endpoint
`POST /api/warrants/check/:personId` — force=true, returns ScanResult, audit logged

**Verify:** `cd server && npx tsc --noEmit`
**Commit:** `feat(warrants): wire universal scanner into person creation, dispatch, scheduled scan`

---

## Task 4: Dashboard + Unified List API Endpoints

**Files:**
- Modify: `server/src/routes/warrants.ts`

### New endpoints:

**GET /api/warrants/dashboard/stats**
Returns: activeWarrants, hitsToday, personsFlagged, sourcesOnline, sourcesTotal

**GET /api/warrants/dashboard/feed?range=24h&event=all&source=all&limit=50&offset=0**
Returns: reverse-chronological warrant_watch_log events with person photos and warrant details.
Range options: 1h, 8h, 24h, 7d. Filter by event type and source.

**GET /api/warrants/dashboard/priority?limit=10**
Returns: top active warrants sorted by severity (felony first), then recency.
Includes subject person details (name, photo, DOB).

**GET /api/warrants/unified?status=all&source=all&type=all&severity=all&q=&limit=50&offset=0**
Returns: merged warrants list from all sources with filters.
Sorts: active first, then by severity, then by date.

**GET /api/warrants/person/:personId/profile**
Returns: { person, warrants (all), scanHistory (last 50 events), lastChecked }

**Verify:** `cd server && npx tsc --noEmit`
**Commit:** `feat(warrants): add dashboard stats, alert feed, priority, unified list, person profile API endpoints`

---

## Task 5: WarrantBadge Shared Component

**Files:**
- Create: `client/src/components/WarrantBadge.tsx`

Lightweight badge component:
- Props: `flags` (string | any[]), `size` ('sm' | 'md'), `onClick?`
- Parses person flags JSON, finds ACTIVE_WARRANT entry
- Renders: red badge for felony, amber for misdemeanor, yellow for infraction
- Shows count if > 1
- Title tooltip with severity + count
- No extra API call — reads from already-loaded person data

**Commit:** `feat(warrants): add WarrantBadge shared component for app-wide warrant visibility`

---

## Task 6: Rewrite WarrantsPage — 3-Tab Layout

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx` (full rewrite, ~2,528 lines)

### Tab restructure: 6 tabs → 3

| Old Tabs | New Tab |
|----------|---------|
| LOCAL WARRANTS, WARRANT WATCH, UTAH SEARCH, ALL STATES | WARRANTS (unified) |
| (new) | DASHBOARD (default landing) |
| COVERAGE, SCAN HISTORY | SOURCES (admin only) |

### DASHBOARD tab (default landing)
- **StatsBar**: 4 metric cards fetching `/api/warrants/dashboard/stats`
  - ACTIVE WARRANTS (red), HITS TODAY (amber), PERSONS FLAGGED (white), SOURCES ONLINE (green/red)
- **AlertFeed** (65% left): event list from `/api/warrants/dashboard/feed`
  - Color-coded rows: red border = FOUND, green = CLEARED
  - Filterable by time range, event type, source
  - Click person name → PersonWarrantProfile slide-out
- **PriorityWarrants** (35% right): cards from `/api/warrants/dashboard/priority`
  - Person photo, name, warrant type badge, charge, bail, severity
- **QuickSearch**: sticky search bar, instant search across persons + warrants

### WARRANTS tab (unified list)
- Table with columns: STATUS, WARRANT#, SUBJECT, TYPE, CHARGE, SOURCE, COURT, BAIL, SEVERITY, DATE
- Horizontal filter bar: status, source, type, severity, text search
- Fetches from `/api/warrants/unified`
- Row click → inline detail panel
- Person name click → PersonWarrantProfile slide-out
- Row actions: Serve, Edit (manual only), Archive

### SOURCES tab (admin + manager only)
- Merge existing Coverage + Scan History views
- Source cards grid with health indicators
- Scan run history table at bottom
- Actions: Enable/Disable, Manual Scrape, Reset Errors

### PersonWarrantProfile slide-out (shared component)
- Fetches from `/api/warrants/person/:personId/profile`
- Person header: name, DOB, photo, flags
- All warrants from every source in one list
- Scan history timeline (found/cleared/served events)
- Quick actions: Run Check Now, Create Manual Warrant, Link to Incident

**Verify:** `cd client && npx vite build`
**Commit:** `feat(warrants): rewrite WarrantsPage — 3-tab layout with dashboard, unified warrants, person profiles`

---

## Task 7: Dispatch Integration — Call Warrant Alerts

**Files:**
- Modify: `server/src/routes/dispatch/callLifecycle.ts`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`

### Backend — warrant check on person link
When person added to call via call_persons INSERT:
1. Fire `universalWarrantCheck(personId)` async
2. If hits found: auto-add call note with warning text
3. Broadcast `call:warrant_alert` to dispatch channel with callId, personName, warrantCount

### Frontend — DispatchPage changes
1. Import WarrantBadge, render next to person names in call detail (~lines 3116-3232)
2. Add WebSocket listener for `call:warrant_alert` — show error-level toast notification
3. Call card gets red WARRANT badge when any attached person has active warrants

**Verify:** `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`
**Commit:** `feat(warrants): dispatch integration — auto-check persons on call, warrant badge, alert toasts`

---

## Task 8: WarrantBadge Across App

**Files:**
- Modify: `client/src/pages/IncidentsPage.tsx` — badge next to person names in suspect/victim/witness lists
- Modify: `client/src/pages/FieldInterviewsPage.tsx` — red warning banner when subject has warrants
- Modify: `client/src/pages/RecordsPage.tsx` — badge in person search results
- Modify: `client/src/pages/ArrestsPage.tsx` — badge in booking form

Pattern: Import WarrantBadge, add next to person name display. FieldInterviewsPage gets a prominent red banner instead.

**Verify:** `cd client && npx vite build`
**Commit:** `feat(warrants): add WarrantBadge to incidents, field interviews, records, arrests pages`

---

## Task 9: Build + Deploy + Verify

1. Full type-check: `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`
2. Build client: `cd client && npx vite build`
3. Deploy: `bash deploy/deploy.sh`
4. Verify health: `curl -sf https://rmpgutah.us/api/health`
5. Verify new endpoints: `curl -sf https://rmpgutah.us/api/warrants/dashboard/stats`
6. Hotfix commit if needed

---

## Execution Order Summary

| Task | Description | Size |
|------|-------------|------|
| 1 | Schema migrations (4 addCol calls + index) | Small |
| 2 | Universal warrant scanner (core module) | Large |
| 3 | Wire scanner into routes + scheduler | Medium |
| 4 | Dashboard + unified list API endpoints | Medium |
| 5 | WarrantBadge shared component | Small |
| 6 | WarrantsPage full rewrite (3 tabs) | Large |
| 7 | Dispatch integration (backend + frontend) | Medium |
| 8 | WarrantBadge across app (4 pages) | Small |
| 9 | Build + deploy + verify | Small |
