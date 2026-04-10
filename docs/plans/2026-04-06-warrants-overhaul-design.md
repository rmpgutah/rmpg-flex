# Warrants Module Full Spillman Overhaul — Design Document

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Complete redesign of WarrantsPage + server enhancements

## 1. Page Layout — Top/Bottom CAD Terminal Split

Replace the current 5-tab layout with a single-screen CAD terminal:

- **Title Bar**: WARRANTS + action buttons (New, Utah Search drawer, Watch Scan, Export, Print)
- **Stats Strip** (22px): LED indicators — ACTIVE count, HITS today, FLAGGED persons, SOURCES online, SCAN status
- **Filter Bar** (24px): Search input + Status/Type/Level dropdowns + Clear button
- **Top Panel** (30% height): Warrant master list — thin spreadsheet rows (9px headers, 2px cell padding, plain colored text for status/level)
- **Bottom Panel** (70% height): Full detail view with collapsible sections

### Top Panel — Warrant Grid
Columns: Status (colored text), Warrant #, Subject Name, Type, Charge (truncated), Level, Court, Bail, Source, Assigned To, Date
- Row height ~20px, font 11px
- Click row = loads detail below
- Batch selection via checkboxes (admin/manager)
- Sort by clicking column headers

### Bottom Panel — Detail Sections (all collapsible)
1. **Subject Info**: Photo (left), Name/DOB/DL#/SSN-last4/Race/Sex/Height/Weight/Hair/Eyes/Address/Flags (grid right)
2. **Warrant Details**: Number, Type, Status, Level, Bail, Court, Judge, Expires, Charge, Statute, OCA#, ORI, NCIC Entry#, Extradition, Caution Flags, Source, Assigned Officer/Unit
3. **Service History**: Table of all attempts — date, officer, badge, method, result, GPS, notes. "+ Record Attempt" button
4. **Linked Records**: Cross-references to incidents, calls, cases, citations (using AddLinkModal search)
5. **Timeline**: Chronological feed — created, status changes, edits, service attempts, scans, linked record changes
6. **Map Pin**: Small inline map showing subject's last known address (Google Maps static)

## 2. New Database Fields

### warrants table (via addCol)
- `oca_number` TEXT — Originating Case Agency number
- `ori` TEXT — Originating Agency Identifier (e.g., UT0180100)
- `ncic_entry_number` TEXT — NCIC warrant entry number
- `extradition` TEXT — none, in_state, surrounding, nationwide
- `caution_flags` TEXT — JSON array: armed, escape_risk, suicidal, violent, medical
- `assigned_officer_id` INTEGER — FK users, officer assigned to serve
- `assigned_unit_id` INTEGER — FK units, unit assigned to serve
- `priority_score` INTEGER — computed priority for assignment board (0-100)

### warrant_service_attempts table (enhance existing)
- Add: `gps_lat` REAL, `gps_lng` REAL, `gps_accuracy` REAL
- Add: `badge_number` TEXT
- Add: `photos` TEXT (JSON array of photo URLs)
- Add: `signature_data` TEXT (digital signature if served)
- Add: `attempt_duration_minutes` INTEGER

## 3. New API Endpoints

### Service Attempts (enhance existing)
- `GET /api/warrants/:id/service-attempts` — already exists, enhance response
- `POST /api/warrants/:id/service-attempts` — already exists, add GPS/photos/signature fields
- `PUT /api/warrants/:id/service-attempts/:attemptId` — edit attempt (admin)
- `DELETE /api/warrants/:id/service-attempts/:attemptId` — delete attempt (admin)

### Officer Assignment
- `PUT /api/warrants/:id/assign` — assign officer + unit to warrant
- `GET /api/warrants/assignment-board` — all active warrants grouped by assigned officer, with workload counts
- `PUT /api/warrants/bulk-assign` — assign multiple warrants to one officer

### Analytics
- `GET /api/warrants/analytics/clearance-rate` — clearance rate by period (weekly/monthly)
- `GET /api/warrants/analytics/service-time` — average days from created to served, by type
- `GET /api/warrants/analytics/by-officer` — warrants served per officer, avg service time
- `GET /api/warrants/analytics/trends` — warrant volume over time (created vs cleared)
- `GET /api/warrants/analytics/by-source` — breakdown by source (manual, utah_api, scraper)

### Timeline
- `GET /api/warrants/:id/timeline` — aggregated timeline from activity_log + service_attempts + warrant_watch_log

### Map
- `GET /api/warrants/map-data` — active warrants with geocoded addresses for map pins
- `GET /api/warrants/heatmap` — density data for warrant concentration areas

### BOLO Integration
- `POST /api/warrants/:id/generate-bolo` — auto-create BOLO from warrant (copies subject info, charges, photo)
- `POST /api/warrants/auto-bolo` — bulk generate BOLOs for all unserved high-priority warrants

## 4. UI Feature: Map View

Slide-out panel (or tab in detail) showing:
- Pin markers for each active warrant's subject address
- Color-coded by severity (red=felony, amber=misdemeanor, blue=other)
- Click pin = select warrant in grid
- Heat map overlay for warrant density
- Route planning button: "Plan serve route" (uses Google Maps Directions API to optimize officer route)

## 5. UI Feature: BOLO Integration

- "Generate BOLO" button in warrant detail toolbar
- Auto-populates BOLO with: subject name, DOB, description, charge, warrant number, photo
- Pushes to dispatch WebSocket as `bolo_created` event
- MDT/DispatchPage show WarrantAlertBanner when BOLO is active

## 6. UI Feature: Officer Assignment Board

Slide-out panel showing:
- Left column: Unassigned warrants (sorted by priority score)
- Right columns: One per officer, showing their assigned warrants
- Drag-and-drop assignment (or click-to-assign dropdown)
- Workload indicators: warrant count, overdue count per officer
- Due date tracking: warrants approaching expiration highlighted amber/red

## 7. UI Feature: Analytics Dashboard

Integrated into the stats strip (expandable) or as a slide-out:
- **Clearance Rate** chart: line graph, weekly/monthly toggle
- **Service Time** distribution: bar chart by type
- **Officer Performance**: leaderboard — warrants served, avg time, success rate
- **Trends**: stacked area chart — created vs served vs expired over time
- **Source Breakdown**: pie/donut chart — manual vs utah_api vs scraper

## 8. Form Enhancements

### New Warrant Form
Add fields: OCA#, ORI, NCIC Entry#, Extradition dropdown, Caution Flags checkboxes, Assigned Officer dropdown, Assigned Unit dropdown

### Edit Warrant Form
Same additions, plus ability to reassign officer/unit

### Service Attempt Form (inline in detail panel)
- Method dropdown: Personal, Substitute, Posting, Mail, Abode, Other
- Result dropdown: Served, No Answer, Refused, Unable to Locate, Left with, Other
- GPS: auto-capture from browser with manual override
- Notes textarea
- Photo upload (camera capture on mobile)
- Signature pad (if result = served)

## 9. What Does NOT Change
- Database: existing warrant records, warrant_watch_runs, utah_warrants tables — all untouched
- Server: existing endpoints continue working (backward compatible)
- WebSocket: existing warrant alert broadcasts preserved
- Batch operations: existing batch-update endpoint preserved

## 10. Implementation Order
1. Database: addCol migrations for new fields
2. Server: new API endpoints (timeline, analytics, assignment, map-data)
3. Client: Page layout rewrite (top/bottom split)
4. Client: Detail panel sections (subject, warrant, service, links, timeline)
5. Client: Service attempt form
6. Client: Assignment board slide-out
7. Client: Map view slide-out
8. Client: Analytics charts
9. Client: BOLO integration
10. Client: Form enhancements (new fields)
