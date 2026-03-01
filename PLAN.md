# Spillman Flex Essential Functions — Implementation Plan

## Overview
Add 6 major Spillman Flex features that are currently missing from RMPG Flex. Each is a substantial module with server endpoints, database tables (where needed), and full client UI.

---

## Feature 1: Premise History (Location Intelligence)
**What it does:** Pull up any address and instantly see ALL prior activity at that location — calls for service, incidents, field interviews, trespass orders, BOLOs, known persons. Critical for officer safety when responding to a scene.

**Server:** `GET /api/records/premise-history?address=...`
- Fuzzy-match address across: `calls_for_service.location_address`, `incidents.location_address`, `field_interviews.location`, `trespass_orders.location`, `properties.address`
- Returns unified timeline sorted by date with source-type labels
- Includes "threat summary" (weapons flags, DV flags, known offenders)

**Client:** New `PremiseHistory` panel accessible from Records page and as a popover from Dispatch/Map
- Address search bar with autocomplete from known addresses
- Color-coded timeline (calls=blue, incidents=red, FIs=green, trespass=orange)
- Threat indicators (weapons involved, DV history, caution flags)

---

## Feature 2: Master Name Index / Involvements Hub
**What it does:** Click on any person and see EVERYTHING about them across ALL modules — every call, incident, citation, field interview, warrant, BOLO, trespass order, vehicle, and address they've ever been linked to. The backbone of Spillman.

**Server:** `GET /api/records/persons/:id/involvements`
- Cross-queries: `incident_persons`, `calls_for_service` (caller/subject), `citations`, `field_interviews`, `warrants`, `bolos`, `trespass_orders`, `vehicles_records`, `criminal_history`, `offender_alerts`
- Returns categorized involvement map with counts and full records

**Client:** New `InvolvementsPanel` integrated into the Records person detail view
- Tab-based layout: Calls, Incidents, Citations, FIs, Warrants, BOLOs, Trespass, Vehicles, Criminal History
- Summary header showing total involvements, active warrants, caution flags
- Each sub-tab shows linked records with click-through navigation

---

## Feature 3: Roll Call / Briefing Board
**What it does:** Daily shift briefing page that aggregates everything officers need at shift start — active BOLOs, wanted persons with active warrants, recent crime trends, special assignments, shift assignments, and safety notices.

**Server:** `GET /api/reports/briefing?shift_date=...`
- Aggregates: active BOLOs, active warrants (last 30 days), recent incidents (last 24h), officer assignments for shift, fleet status, credential expirations, safety notices
- Returns structured briefing package

**Client:** New `/briefing` page (added to Operations nav group)
- Print-friendly layout for physical roll call
- Sections: Active BOLOs with photos, Wanted Persons, Recent Activity Summary, Shift Assignments, Vehicle Assignments, Safety Notices, Officer Credentials expiring soon
- Auto-refreshes every 5 minutes

---

## Feature 4: Alarm Management
**What it does:** Track alarm permits, alarm responses, false alarm counts, and alarm fee scheduling. Core functionality for private security companies that respond to alarm activations.

**Database:** New tables:
- `alarm_permits` — alarm system registrations (property, alarm company, permit #, type, zone info)
- `alarm_responses` — individual alarm response records linked to calls_for_service
- `alarm_fees` — fee assessment for excessive false alarms

**Server:** New route file `routes/alarms.ts`
- CRUD for alarm permits, alarm responses, alarm fee tracking
- `GET /api/alarms/dashboard` — summary stats (active permits, false alarm counts, fees assessed)
- Auto-link alarm responses to calls_for_service where source='alarm'

**Client:** New `/alarms` page (added to Records nav group)
- Tabs: Permits, Responses, Fees, Dashboard
- Permit management with alarm company info, zone mapping
- Response log linked to dispatch calls
- False alarm counter per property with fee escalation schedule

---

## Feature 5: Visitor / Access Log
**What it does:** Track who enters and exits secured properties — visitor sign-in/out, gate access, credential verification. Essential for private security managing access-controlled facilities.

**Database:** New table:
- `visitor_log` — visitor entries (property, visitor name, company, vehicle, badge #, purpose, escort, sign-in/out times, photo_url)

**Server:** New route file `routes/visitors.ts`
- CRUD for visitor entries
- `GET /api/visitors?property_id=...` — visitor log for a property
- `GET /api/visitors/active` — currently signed-in visitors across all properties
- `POST /api/visitors/:id/sign-out` — sign out a visitor

**Client:** New `/visitors` page (added to Records nav group)
- Active visitors dashboard showing currently signed-in visitors
- Property selector for filtered views
- Quick sign-in form (visitor name, company, purpose, vehicle, escort)
- Sign-out button with timestamp
- Visitor history search

---

## Feature 6: Hot Sheet / Active Alerts Consolidated View
**What it does:** Single-screen view of ALL active alerts — BOLOs, active warrants, offender alerts, trespass orders, alarm activations. Officers check this at shift start and throughout the day. Different from Briefing Board (which is shift-focused) — this is a live, always-current tactical alert feed.

**Server:** `GET /api/reports/hot-sheet`
- Combines: active BOLOs, active warrants, active trespass orders, offender alerts (severity=critical), recent alarm activations
- Sorted by priority/severity, then recency
- Includes photo URLs and descriptions

**Client:** New `/hot-sheet` page (added to Operations nav group)
- Live-updating feed (30-second refresh)
- Priority-sorted cards: BOLO cards (with person/vehicle photos), Warrant cards, Trespass alerts, Offender alerts
- Filter by type, priority, date range
- Quick-print for vehicle/dashboard reference
- Click-through to full record

---

## Implementation Order
1. **Premise History** + **Master Name Index** (server endpoints + client panels) — read-only queries, no new tables
2. **Roll Call / Briefing Board** + **Hot Sheet** — read-only aggregation, no new tables
3. **Alarm Management** — new tables + full CRUD
4. **Visitor / Access Log** — new tables + full CRUD

## Navigation Changes
- **Operations group:** Add Briefing Board, Hot Sheet
- **Records group:** Add Alarms, Visitor Log

## Files to Create/Modify
**New Server Routes (4):**
- `server/src/routes/alarms.ts`
- `server/src/routes/visitors.ts`
- Extend `server/src/routes/records.ts` (premise-history, involvements)
- Extend `server/src/routes/reports.ts` (briefing, hot-sheet)

**New Client Pages (4):**
- `client/src/pages/BriefingBoardPage.tsx`
- `client/src/pages/HotSheetPage.tsx`
- `client/src/pages/AlarmManagementPage.tsx`
- `client/src/pages/VisitorLogPage.tsx`

**New Client Components (2):**
- `client/src/components/PremiseHistory.tsx`
- `client/src/components/InvolvementsPanel.tsx`

**Modified Files:**
- `server/src/models/database.ts` — add alarm_permits, alarm_responses, alarm_fees, visitor_log tables
- `server/src/index.ts` — register new routes
- `client/src/App.tsx` — add new routes
- `client/src/components/Layout.tsx` — add nav entries
- `client/src/types/index.ts` — add new types

## Deployment
Build → Deploy → Restart (same `tar+scp+systemctl restart` pattern)
