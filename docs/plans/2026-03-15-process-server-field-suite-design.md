# Process Server Field Suite — Design Document

**Date:** 2026-03-15
**Status:** Approved
**Scope:** New mobile-first field tool for process servers

---

## Overview

A dedicated Process Server Field Suite that gives process servers a purpose-built mobile interface for managing their daily serve queue, documenting service attempts with court-ready evidence, optimizing multi-stop routes, running skip traces in the field, and generating affidavit PDFs.

## Context

- Process servers currently get job lists from ServeManager and manually plan routes in Google Maps
- Utah law requires 3 attempts at the same address on different days/times before alternate service
- Service types: personal, substitute, posting — each requires different legal documentation
- Affidavit of Service and Affidavit of Non-Service/Due Diligence PDFs are filed with courts
- Process servers drive 20-40 stops per day

---

## Feature 1: Serve Page (Mobile-First Field Interface)

New `/serve` page accessible from menu bar (F-key shortcut) and mobile bottom nav.

**Layout:**
- Top: today's serve queue as cards — recipient name, address, document type, attempt count (0/3), priority/deadline
- Map view toggle: all stops plotted with optimized route line
- Each job card expands: full recipient details, case info, prior attempt history, attorney/client notes
- Action buttons per job: "Navigate" (Google Maps directions), "Attempt Service" (documentation wizard), "Skip Trace" (Microbilt lookup), "Flag Bad Address"
- Bottom stats bar: jobs remaining, serves completed, miles driven

**Data source:** Pulls from `sm_jobs` + new `serve_queue` table for daily assignments. Officers can manually add jobs not in ServeManager.

---

## Feature 2: Service Attempt Documentation Flow

4-step wizard triggered by "Attempt Service" button:

**Step 1 — Arrival Confirmation**
- Auto-captures GPS coordinates + timestamp
- Mini-map showing current position vs job address
- Warning if GPS is >200m from service address (override allowed)

**Step 2 — Attempt Type**
- Personal Service — handed directly to named person
- Substitute Service — left with another person (requires name, relationship, description)
- Posting — affixed to door/premises (only available after 2+ prior failed attempts)
- Failed Attempt — no one home, refused, wrong address, etc.

**Step 3 — Documentation**
- Camera capture: up to 5 photos per attempt
- Physical description of person served (personal/substitute): age, height, weight, hair, clothing
- Free-text notes ("dog in yard", "lights on but no answer", "neighbor said subject works nights")

**Step 4 — Result & Signature**
- Digital signature capture from process server
- Outcome: Served, Not Served — No Answer, Not Served — Refused, Not Served — Wrong Address, Not Served — Moved, Not Served — Other
- Auto-increments attempt counter (1/3, 2/3, 3/3)
- After 3rd failed attempt: prompt to generate affidavit of non-service

---

## Feature 3: Smart Route Optimization

**Multi-Factor Route Engine:**
- Time-window awareness: jobs tagged morning/afternoon/evening/anytime, optimizer clusters accordingly
- Geographic clustering: groups by neighborhood/zip, optimizes within clusters, prevents zigzagging
- Priority weighting: approaching deadlines and court dates move earlier; 2nd/3rd attempts get boosted
- Re-attempt scheduling: if failed at 2pm last time, suggest different time window
- Real-time re-routing: recalculates on completion/skip considering position and time windows

**Algorithm:**
- Google Maps Directions API with waypoint optimization (up to 25 waypoints per batch)
- 25+ stops: cluster by lat/lng grid, optimize within zones, chain zones by proximity
- Fuel cost and mileage tracked per route

**Route History:**
- `serve_routes` table: planned vs actual route per day
- Mileage for expense reimbursement and client billing
- Route replay on map (breadcrumb trail + stop completion timestamps)

**UI:**
- Drag-and-drop reorder for manual override
- Color-coded pins: green (served), yellow (attempted), red (failed/deadline), blue (not visited)

---

## Feature 4: PDF Generation — Legal Documents

Three PDF templates via existing jsPDF system:

**Affidavit of Service (Proof of Service)**
- Court header: case number, court name, jurisdiction
- Server ID: name, badge/license number, company
- Recipient: name, address, document type
- Service details: date, time, GPS coordinates, method
- Substitute details if applicable: name, relationship, description
- Embedded GPS-stamped photos
- Digital signature + notary block
- Utah-specific language per URCP Rule 4(d)

**Affidavit of Non-Service / Due Diligence**
- Chronological attempt history (date, time, result, notes)
- GPS coordinates per attempt
- Photos from each attempt
- Skip trace results and alternate addresses tried
- Declaration of diligent efforts
- Supports motion for alternate service

**Service Log Report (Internal)**
- Daily/weekly summary for management and billing
- Jobs attempted/served/failed/pending
- Miles driven, time per stop, route efficiency
- Grouped by client/attorney for invoicing

**Triggers:**
- Auto-generated on "Served" (affidavit of service)
- Auto-generated after 3rd failed attempt (affidavit of non-service)
- On-demand from job detail
- Batch generation end of day

---

## Feature 5: Skip Trace Integration

**Quick Lookup Flow:**
- Pre-fills Microbilt search with recipient name + last known address
- Results in serve-focused card: alternate addresses (ranked by recency), phones, employer, vehicles, associates
- "Add to Route" button per alternate address
- "Flag Primary Address" for most promising lead

**Address Verification:**
- Cross-references job address against skip trace history
- Warning if address not in subject's known addresses
- Recency indicator per address

**Cost Tracking:**
- Display cost before running lookup
- Track per-job for client billing pass-through
- Daily/monthly spend on stats bar

---

## Architecture

### New Files

| File | Type | Description |
|------|------|-------------|
| `client/src/pages/ServePage.tsx` | Page | Mobile-first field interface |
| `client/src/components/serve/ServeJobCard.tsx` | Component | Job card with actions |
| `client/src/components/serve/ServeAttemptModal.tsx` | Component | 4-step documentation wizard |
| `client/src/components/serve/ServeRoutePlanner.tsx` | Component | Route optimizer with map |
| `client/src/components/serve/ServeSkipTracePanel.tsx` | Component | Skip trace results panel |
| `client/src/utils/servePdfGenerator.ts` | Utility | 3 PDF templates |
| `server/src/routes/serve.ts` | Route | All serve API endpoints |

### New Database Tables

**`serve_queue`** — Daily job assignments + manual jobs
- id, sm_job_id (nullable FK), officer_id, date, recipient_name, recipient_address, document_type, case_number, court_name, jurisdiction, client_name, attorney_name, priority, time_window, deadline, attempt_count, max_attempts (default 3), status, sort_order, notes, created_at, updated_at

**`serve_attempts`** — Attempt documentation
- id, serve_queue_id, officer_id, attempt_number, attempt_type (personal/substitute/posting/failed), result, latitude, longitude, gps_accuracy, timestamp, person_served_name, person_served_relationship, person_served_description (age/height/weight/hair/clothing), notes, signature_data (base64), photos (JSON array of upload IDs), created_at

**`serve_routes`** — Planned vs actual routes
- id, officer_id, date, planned_stops (JSON), actual_stops (JSON), planned_mileage, actual_mileage, planned_duration, actual_duration, fuel_cost, start_time, end_time, created_at

**`serve_skip_traces`** — Skip trace results linked to jobs
- id, serve_queue_id, officer_id, lookup_cost, results_json, addresses_found (JSON), address_added_to_route (boolean), created_at

### Modified Files

- `client/src/components/Layout.tsx` — Add Serve to menu bar
- `client/src/components/MenuBar.tsx` — Add F-key shortcut
- `client/src/components/mobile/MobileBottomNav.tsx` — Add Serve tab
- `client/src/App.tsx` — Add /serve route
- `server/src/index.ts` — Register serve router
- `server/src/models/database.ts` — Add 4 new tables

### Integrations

- `sm_jobs` / `sm_attempts` → serve queue auto-populates from ServeManager sync
- Microbilt (`skiptracer.ts`) → skip trace from serve workflow
- GPS (`useGpsTracking.ts`) → location verification + breadcrumbs
- Uploads (`uploads.ts`) → photo storage
- Google Maps Directions API → route optimization

---

## Design Decisions

- **3-attempt limit default** with per-job override for jurisdictions requiring more
- **Posting only after 2+ failed attempts** — enforced in UI, matches Utah practice
- **GPS proximity warning at 200m** — allows for parking distance but catches wrong-address errors
- **Nearest-neighbor + Google waypoint optimization** — pragmatic balance of speed vs optimality for 20-40 stops
- **Photos stored via existing upload system** — no new storage infrastructure needed
- **ServeManager remains source of truth** — RMPG Flex adds field tooling on top, syncs results back
