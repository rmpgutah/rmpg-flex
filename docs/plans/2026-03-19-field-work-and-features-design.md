# RMPG Flex — Field Work & Incomplete Features Design
**Date**: 2026-03-19
**Status**: Approved

## Overview
Systematic 3-phase sweep to complete unfinished features, maximize offline field capability, and stitch together integration gaps across the CAD/RMS.

---

## Phase 1: Field Workflows & Offline (Highest Impact)

### 1A. Expand Offline Router
**Files**: `desktop/offlineRouter.js`, `desktop/localDb.js`, `desktop/syncManager.js`

New offline handlers:
- `POST /api/citations` — Create citation offline (local_id + sync queue)
- `PUT /api/citations/:id` — Update draft citation
- `POST /api/field-interviews` — Create FI card offline
- `POST /api/evidence` — Log evidence item offline
- `POST /api/personnel/time/clock-out` — Clock out offline

New mirror tables in `localDb.js`:
- `citations` (local_id, is_dirty, synced_at)
- `field_interviews` (local_id, is_dirty, synced_at)
- `evidence_property` (local_id, is_dirty, synced_at)

Sync intervals:
- Citations: 2 min
- FIs: 5 min
- Evidence: 5 min

### 1B. Quick Actions from Dispatch
**File**: `client/src/pages/dispatch/DispatchPage.tsx`

When officer clears a call:
- Disposition picker dropdown (not just dispatchers)
- "Create Incident" button → pre-fills from call data
- "Create Citation" button → pre-fills with call location + person

### 1C. MDT Quick Actions
**File**: `client/src/pages/MdtPage.tsx`

Quick-action bar:
- 10-code status buttons (10-8, 10-7, 10-6)
- "New FI" → pre-filled with current GPS
- "New Citation" → pre-filled with GPS
- "Log Evidence" → evidence intake form
- Sync indicator showing pending offline items

### 1D. Offline Sync Queue UI
**File**: `client/src/components/StatusBar.tsx` + new `SyncQueuePanel.tsx`

- Badge next to connection status showing pending count
- Orange when queued, green when synced
- Click opens popover with item details + "Sync Now" button

---

## Phase 2: Missing UI Pages (Unlock Existing Backend)

### 2A. Forensic Lab Page
**New file**: `client/src/pages/ForensicsLabPage.tsx`
**Backend**: `server/src/routes/forensics.ts` (already complete)
**Route**: `/forensics-lab`

Split-panel layout (list left, detail right):
- Left: Case list with status/analyst/date filters
- Right: Tabbed detail (Overview, Exhibits, Analyses, Timeline)
- Full CRUD: create case, add exhibits, record analysis, close case

### 2B. Court Records Page
**New file**: `client/src/pages/CourtRecordsPage.tsx`
**Backend**: `server/src/routes/court.ts` (already complete)
**Route**: `/court-records`

Table view with expandable row detail:
- Columns: case number, defendant, court date, judge, status, charges
- Filters: status, date range, defendant search
- Detail: events timeline, linked incidents, attorney info, bail status

### 2C. IPED Digital Forensics Page
**New file**: `client/src/pages/IpedPage.tsx`
**Backend**: `server/src/routes/iped.ts` (already complete)
**Route**: `/digital-forensics`

Dashboard + job queue layout:
- Active jobs with progress indicators
- Hash set management
- Job detail: hash results, matched files, export

---

## Phase 3: Integration Stitching

### 3A. Call → Incident → Report → Evidence Chain
**Files**: `DispatchPage.tsx`, `IncidentsPage.tsx`

- Dispatch "Create Incident" auto-fills all call data
- Incident "Log Evidence" pre-fills incident_id + location
- Incident "View Linked Evidence" section
- Incident "Create Citation" pre-fills person/location

### 3B. Evidence → Case Linking
**Files**: `server/src/routes/evidence.ts` (migration), `EvidencePropertyPage.tsx`, `CaseManagementPage.tsx`

- Add `case_id` FK to evidence_property table
- "Link to Case" dropdown in evidence detail
- "Linked Evidence" tab in case management

### 3C. Auto Warrant Check on Citation
**Files**: `server/src/routes/citations.ts`, `CitationsPage.tsx`

- Server: auto-query warrants table on citation creation
- Client: warning banner if active warrants match person

### 3D. FI → Person Record Sync
**File**: `server/src/routes/field-interviews.ts`

- Auto-create person record from FI data if not exists
- Update last_contact_date if person exists

### 3E. Sync Queue Visibility
**New file**: `client/src/components/SyncQueuePanel.tsx`
**File**: `client/src/components/StatusBar.tsx`

- Popover panel: pending items list, retry count, type
- "Sync Now" and "Clear Failed" buttons
- Auto-refresh every 10s

---

## Navigation Updates
**File**: `client/src/components/Layout.tsx`, `client/src/App.tsx`

Add to "Investigation" dropdown menu:
- Forensic Lab → `/forensics-lab`
- Court Records → `/court-records`
- Digital Forensics → `/digital-forensics`

---

## Execution Order
1. Phase 1A (offline router expansion) — foundation for all field work
2. Phase 1B-1D (quick actions + sync UI) — officer-facing improvements
3. Phase 2A-2C (new pages) — parallelizable, independent of each other
4. Phase 3A-3E (integration) — depends on Phase 1+2 being complete
