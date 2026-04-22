# Dispatch & Records Spillman-Grade Overhaul — Design Document

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Comprehensive upgrade of dispatch + records to match Spillman Flex feature parity

---

## 1. Master Name Index (MNI) — Unified Person Intelligence

### Single-Screen Person Dossier
Replace the current sparse PersonsTab detail view with a dense Spillman-style intelligence console:

```
┌─ MASTER NAME INDEX ──────────────────────────────────────────┐
│ [Photo]  SMITH, JOHN ALLEN          DOB: 1990-01-15 (36)    │
│          M/W  6'01" 185 BRN/BLU     DL: UT 12345678         │
│          400 S STATE ST SLC UT 84111  📱 801-555-1234        │
│ ⚠ FLAGS: ARMED & DANGEROUS │ ACTIVE WARRANT │ GANG: Sureños │
├──────────────────────────────────────────────────────────────┤
│ CRIMINAL HISTORY (7)  │ WARRANTS (2)    │ FIELD CONTACTS (12)│
│ ─────────────────────  │ ───────────────  │ ──────────────────│
│ 2025 Assault 1st F    │ WRN-25-001 ACT  │ FI-25-034 04/01   │
│ 2024 Theft Misd       │ WRN-25-002 ACT  │ FI-25-021 03/15   │
│ 2023 DUI Misd         │                 │ FI-25-009 02/28   │
├──────────────────────────────────────────────────────────────┤
│ CALLS (15)     │ INCIDENTS (8)   │ VEHICLES (3)   │ CASES (2)│
│ CFS-25-001234  │ RMP-25-00042    │ UT ABC1234     │ CASE-001 │
│ CFS-25-000987  │ RMP-25-00038    │ UT XYZ5678     │ CASE-002 │
├──────────────────────────────────────────────────────────────┤
│ ASSOCIATES (4)        │ ADDRESSES (3 known)                  │
│ DOE, JANE (girlfriend)│ 400 S State (current)                │
│ GARCIA, LUIS (co-def) │ 1200 W Temple (2024)                 │
├──────────────────────────────────────────────────────────────┤
│ TIMELINE ────────────────────────────────────────────────────│
│ 04/07 Warrant check — 2 active warrants found                │
│ 04/05 Linked to CFS-25-001234 as suspect                     │
│ 04/01 Field contact by Zamora #1572 at 400 S State           │
│ 03/28 Arrested — Assault 1st Degree (RMP-25-00042)           │
└──────────────────────────────────────────────────────────────┘
```

### Auto-Alerting on Person Add
When a person is added to a dispatch call:
1. Auto-check warrants (local + Utah API)
2. Auto-check BOLO list
3. Auto-check sex offender registry (NSOPW)
4. Auto-check caution flags (armed, escape risk, mental health)
5. Auto-check premise history at call address
6. Display consolidated WarrantAlertBanner + voice alert if hits found

---

## 2. Compound Search Engine (NCIC-Style)

### Query Builder Interface
```
┌─ ADVANCED SEARCH ─────────────────────────────────────────┐
│ Name: [SMITH, JO*     ] DOB: [1990-__-__ ] to [1995-__-__]│
│ Race: [White ▼] Sex: [Male ▼] Height: [5'10"-6'02"]       │
│ Hair: [Brown ▼] Eyes: [Blue ▼] Build: [Any ▼]             │
│ Address: [400 S State*  ] Radius: [1 mile ▼]              │
│ Vehicle: [ABC*         ] State: [UT ▼]                     │
│ Alias: [              ] SSN Last 4: [____]                 │
│ Flags: ☑ Active Warrant  ☑ Armed  ☐ Sex Offender          │
│                                        [SEARCH] [CLEAR]    │
└───────────────────────────────────────────────────────────┘
```

### Search Features
- **Wildcard matching**: `SMITH*` matches SMITH, SMITHSON, SMITHFIELD
- **Partial DOB**: `1990-__-__` matches any person born in 1990
- **Physical range**: height 5'10"–6'02", weight 170–200
- **Address radius**: all persons within N miles of an address
- **Cross-module**: searches persons + vehicles + properties + warrants + citations simultaneously
- **Results ranked** by confidence score (exact match > partial > fuzzy)
- **Saved searches**: save frequently used queries as named presets

---

## 3. Criminal History Management UI

### Criminal History Tab in Person Detail
Full CRUD for criminal records with visual timeline:
- **Add Record**: offense, statute, case #, agency, jurisdiction, date, disposition, sentence
- **Record Types**: arrest, conviction, charge, booking, probation, parole, court_order, restraining_order, sex_offense, DUI
- **Visual Timeline**: vertical timeline with color-coded entries (red=felony, amber=misdemeanor, blue=civil)
- **Import**: paste from NCIC response, auto-parse fields
- **Print**: criminal history summary report (PDF)

---

## 4. Field Interview (FI) Cards

### Quick-Entry Contact Cards
New module for documenting street-level person contacts:

**Database: `field_interviews` table**
- fi_number (auto-generated: FI-YY-NNNNN)
- officer_id, date, time, location (address + GPS)
- person_id (link to existing person or create new)
- reason (suspicious activity, traffic stop, welfare check, etc.)
- narrative (free text)
- vehicle_id (optional link)
- associates (JSON — other persons present)
- photos (JSON — uploaded images)
- disposition (released, arrested, cited, warned)
- linked_call_id, linked_incident_id (optional)

**UI: Quick-entry form**
- Optimized for mobile/tablet use in the field
- Auto-fill from person record if linked
- GPS auto-capture for location
- Camera integration for photos
- Auto-link to active dispatch call if officer is on one

**API: 6 endpoints**
- GET/POST/PUT/DELETE `/api/field-interviews`
- GET `/api/field-interviews/by-person/:personId`
- GET `/api/field-interviews/by-location` (radius search)

---

## 5. Vehicle Intelligence Module

### Enhanced Vehicle Detail View
- **NCIC Fields**: OLN (operator license #), OCA, ORI, NIC (NCIC entry #)
- **Stolen Status Tracking**: stolen_date, stolen_agency, recovery_date, recovery_location
- **Registration Verification**: expiry, state, plate_type, title_status (clean/salvage/branded)
- **Owner History**: previous owners with date ranges
- **Insurance Verification**: company, policy, expiry, verified_at, verified_by
- **BOLO Matching**: auto-check against active BOLOs on every vehicle view
- **Tow/Impound Tracking**: tow_company, lot_location, release_date, release_to, tow_reason

### Vehicle Stop Module
New workflow for traffic stops:
- Officer initiates stop → creates CFS + links vehicle
- Auto-run plate through NCIC/stolen/BOLO
- Generate citation from stop (linked to vehicle + driver)
- Record stop data: reason, outcome, duration, body camera status

---

## 6. Property Intelligence Module

### Enhanced Property Detail View
- **Patrol Schedule**: assigned officers, patrol frequency, checkpoint list
- **Inspection History**: date, officer, pass/fail, notes, photos
- **Access Log**: who accessed the property, when, purpose
- **Incident History**: all CFS + incidents at this address (auto-queried)
- **Trespass Orders**: active trespass orders for this property
- **Key Holder Info**: name, phone, relationship, backup contact
- **Security Features**: cameras (type/count), alarm system, gate code, access instructions
- **Patrol Route Integration**: property appears on officer patrol route map

---

## 7. Record Merge & Deduplication

### Duplicate Detection
- Auto-detect duplicates on person creation (name + DOB similarity)
- Periodic background scan for fuzzy matches (Levenshtein distance)
- Dashboard showing potential duplicates with confidence scores

### Merge Workflow
- Side-by-side comparison of two person records
- Field-by-field conflict resolution (pick field A or field B)
- All linked records (calls, incidents, warrants, vehicles) automatically reassigned to surviving record
- Audit trail of merge with original data preserved

---

## 8. NIBRS/UCR Crime Reporting

### Auto-Classification
- When incident offenses are entered, auto-map to NIBRS offense codes
- Track Group A (46 offenses) and Group B (11 offenses) per FBI standards
- Victim/offender demographics auto-populated from incident_persons
- Weapon/force codes from incident_offenses

### Monthly NIBRS Export
- Generate XML/flat-file export per FBI NIBRS specification
- Validation against NIBRS business rules before submission
- Error report showing missing/invalid fields
- API: `GET /api/reports/nibrs/monthly?year=2026&month=4`

---

## 9. Dispatch Enhancements

### Supervisor Dashboard (slide-out panel)
- **Real-time unit map**: all units with live GPS, color-coded by status
- **Workload board**: calls per unit, response times, time on scene
- **Call volume graph**: live-updating, last 8 hours
- **Response time gauges**: P1 avg, P2 avg, P3 avg vs. SLA targets
- **Alerts**: overdue calls, units idle too long, high-priority calls unassigned

### ETA Calculator
- Calculate estimated arrival time for each available unit based on:
  - GPS distance to call location
  - Current speed / average speed
  - Traffic conditions (time of day)
- Display ETAs in unit recommendation list
- Auto-suggest closest available unit

### Premise History Auto-Display
- When a new call is created at an address, auto-query previous calls
- Show count + summary in call card: "⚠ 12 prior calls at this address (3 DV, 2 weapons)"
- Expandable to see full premise history

### Call Stacking
- Units can be assigned to multiple calls (priority-ordered queue)
- Visual indicator showing call stack depth per unit
- Auto-advance to next call when current is cleared

### Name-Based Alerting
- When a person is added to any call/incident:
  1. Warrant check (local + Utah + scraped)
  2. BOLO check
  3. Sex offender check
  4. Caution flag check (from person.flags)
  5. Restraining order check
- Results displayed as dispatch alert banner + voice alert
- Officer safety information pushed to unit MDT

---

## 10. Dispatch-to-Unit Messaging

### Secure Message Channel
- `messages` table: sender_id, recipient_id (user or unit), channel, text, read_at, created_at
- Channels: dispatch, unit-to-unit, broadcast, BOLO
- WebSocket delivery for real-time
- Read receipts
- Message history per call (messages tagged with call_id)

---

## 11. Universal Search

### One Search Bar, All Modules
Top-level search bar that queries:
- Persons (name, DOB, DL, SSN-last4, alias)
- Vehicles (plate, VIN, make/model)
- Properties (address, name, client)
- Calls (call_number, address, description)
- Incidents (incident_number, narrative)
- Warrants (warrant_number, charge)
- Citations (citation_number, violation)
- Cases (case_number)
- Arrests (booking_number)

Results grouped by type with count badges. Click to navigate to record.

---

## 12. Photo Lineup Management

### 6-Pack Photo Lineup
- Select a suspect from person records
- System auto-suggests 5 similar-looking persons (same race, gender, age range, build)
- Manual override to pick specific fillers
- Generate printable 6-pack lineup sheet (PDF) with numbered positions
- Random position assignment (suspect not always in same spot)
- Document which photo was identified (if any) with witness info
- Chain-of-custody for lineup administration

---

## 13. Officer Activity Tracking

### Per-Shift Activity Summary
- Calls responded to (count, types, outcomes)
- Citations issued
- Arrests made
- Field interviews conducted
- Reports written
- Mileage driven
- Time on calls vs. available vs. administrative

### Performance Scorecards
- Monthly/quarterly performance metrics
- Comparison to department averages
- Trend graphs over time
- Supervisor review integration

---

## 14. Full Case-to-Court Chain

### End-to-End Workflow
```
CFS → Incident → Arrest → Booking → Citation → Court → Disposition
  ↓       ↓         ↓        ↓          ↓        ↓         ↓
 Call   Report   Charges   Custody   Violation  Hearing   Outcome
```

Each step linked bidirectionally. Status tracking at every stage.
Case management aggregates all records into one folder.

---

## 15. Database Changes

### New Tables
- `field_interviews` — FI card records
- `dispatch_messages` — unit messaging
- `photo_lineups` — lineup administration records
- `nibrs_submissions` — NIBRS export tracking
- `officer_activity_summary` — per-shift activity aggregates
- `saved_searches` — user search presets
- `record_merge_log` — merge audit trail

### New Columns (via addCol)
- `warrants`: oca_number, ori, ncic_entry_number, extradition, caution_flags, assigned_officer_id, assigned_unit_id, priority_score
- `vehicles_records`: nic_number, oca_number, stolen_agency, recovery_location, recovery_date
- `calls_for_service`: premise_history_count, eta_seconds, call_stack_position
- `persons`: fi_count, last_fi_date, merge_source_ids

---

## 16. Implementation Order

### Phase 1: Foundation (Database + API)
1. New table creation + addCol migrations
2. Field interview CRUD endpoints
3. Compound search engine endpoint
4. Universal search endpoint
5. Criminal history UI endpoints (enhance existing)

### Phase 2: Records UI
6. Master Name Index person view rewrite
7. Compound search UI (query builder)
8. Criminal history timeline UI
9. Field interview form + list
10. Vehicle intelligence detail view
11. Property intelligence detail view

### Phase 3: Dispatch Enhancements
12. Supervisor dashboard panel
13. ETA calculator integration
14. Premise history auto-display
15. Name-based alerting on person add
16. Call stacking logic
17. Dispatch messaging

### Phase 4: Advanced Features
18. Record merge/dedup workflow
19. Photo lineup management
20. NIBRS/UCR reporting engine
21. Officer activity tracking
22. Vehicle stop module
23. Full case-to-court chain linking

### Phase 5: Integration
24. Universal search bar
25. Cross-module auto-alerting
26. Performance scorecards
27. Saved search presets
