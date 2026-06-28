# Warrant System Redesign — Alert Dashboard + Unified Search

**Date:** 2026-03-16
**Status:** Approved
**Approach:** C — Alert Dashboard + Unified Search (3 tabs from 6)

## Problem

Current warrant system has 6 scattered tabs, unreliable warrant watch (flip-flop bug), no persistent person flagging, no auto-creation of local warrants from external hits, and no dispatch integration for officer safety.

## Goals

1. Unified warrant experience — 3 tabs: Dashboard, Warrants, Sources
2. Universal scanner that checks ALL sources (Utah API + multi-state scrapers + court records)
3. Auto-create local warrant records from external hits
4. Auto-flag persons with ACTIVE_WARRANT across the entire app
5. Dispatch call alerts when attached persons have warrants
6. Immediate warrant check when new persons are added to the system

---

## Section 1: Universal Warrant Scanner (Backend)

### Core Function

`universalWarrantCheck(personId)` — queries all sources for one person, returns unified results.

### Triggers

- **New person created** (arrest, field interview, dispatch call)
- **Manual check** from person profile
- **Scheduled scan** — hourly, all persons, replaces Utah-only scan

### Auto-Create Local Warrants

When external hit found:
- Creates record in `warrants` table with `source = 'utah_api' | 'scraper' | 'court_records'`
- Links via `subject_person_id`
- Status = `active`, type inferred from charge text
- Warrant number: `EXT-YYYY-NNNNN` (distinct from manual `WRN-`)
- Deduplicates by `external_warrant_id`

### Auto-Flag Persons

- Adds `ACTIVE_WARRANT` to person's `flags` JSON array when active warrants exist
- Removes flag when all warrants cleared/served
- Flag metadata: `{ type: "ACTIVE_WARRANT", severity: "felony", count: 2, updated_at: "..." }`

### WebSocket Broadcast

On new warrant hit:
```
broadcast('warrant:hit', { personId, personName, warrantType, source, court })
```

### New Columns on `warrants` Table

- `source TEXT DEFAULT 'manual'` — origin (manual, utah_api, scraper, court_records)
- `external_warrant_id TEXT` — dedup key for external warrants
- `external_source_key TEXT` — which scraper/API found it
- `auto_created INTEGER DEFAULT 0` — distinguishes manual vs auto

---

## Section 2: Dashboard Tab (Default Landing)

### Top Stats Bar — 4 cards

| Card | Value | Style |
|------|-------|-------|
| ACTIVE WARRANTS | Count all active (local + external) | Red badge if > 0 |
| HITS TODAY | warrant_found events in 24h | Amber pulse if recent |
| PERSONS FLAGGED | Persons with ACTIVE_WARRANT flag | White |
| SOURCES ONLINE | X/Y healthy sources | Green/red indicator |

### Alert Feed (65% left)

- Reverse-chronological warrant events
- Each row: timestamp, person name (clickable), event type (FOUND/CLEARED), source, charge summary
- Color-coded: red border = FOUND, green = CLEARED
- Filterable: time range (1h, 8h, 24h, 7d), event type, source
- Click person name → Person Warrant Profile panel

### Priority Warrants (35% right)

- Top 10 active warrants (felonies first, then recency)
- Card: person name, photo thumb, warrant type badge, charge, bail
- Click → person drill-down

### Quick Search (sticky top)

- Name search across persons table + all warrant sources
- Results grouped: "In System" vs "External Hits" (not yet linked)

---

## Section 3: Warrants Tab (Unified List)

### Table Columns

| Column | Description |
|--------|-------------|
| STATUS | Badge: Active (red), Served (green), Recalled (gray), Expired (dim) |
| WARRANT # | WRN- manual, EXT- auto-created |
| SUBJECT | Person name (clickable) + photo thumb |
| TYPE | Arrest, Bench, Search, Civil |
| CHARGE | Truncated with tooltip |
| SOURCE | Badge: MANUAL, UTAH API, SCRAPER, COURT REC |
| COURT | Issuing court |
| BAIL | Amount or NO BAIL |
| SEVERITY | Felony (red), Misdemeanor (amber), Infraction (white) |
| DATE | Issue date or created_at |

### Filters — Horizontal bar

- Status: All / Active / Served / Recalled / Expired
- Source: All / Manual / Utah API / Scraper / Court Records
- Type: All / Arrest / Bench / Search / Civil
- Severity: All / Felony / Misdemeanor / Infraction
- Text search (name, warrant number, charge)

### Row Actions

- Click row → inline detail panel (full charge, court info, activity log)
- Serve button (active warrants)
- Edit (manual only)
- Archive

### Person Warrant Profile (Slide-Out Panel)

Triggered by clicking any person name (dashboard or warrants tab):
- Person header: name, DOB, photo, flags
- All warrants from every source in one list
- Scan history: every check, what was found
- Quick actions: Run new check, create manual warrant, link to incident
- Timeline: chronological found/cleared/served events

---

## Section 4: Sources Tab (Admin Only)

Role-gated: admin + manager only.

### Source Cards Grid

Each card:
- Source name + state badge (UT, CO, NV, etc.)
- Status indicator: green (healthy), amber (degraded), red (circuit broken)
- Last scrape + next scheduled
- Warrant count from source
- Error count / consecutive errors
- Actions: Enable/Disable toggle, Manual Scrape, Reset Errors

### Scan Run History (bottom)

- Recent runs: timestamp, persons checked, hits, cleared, errors, duration
- Expandable error details

---

## Section 5: Dispatch Integration — Warrant Alerts on Calls

### Trigger

When a person is linked to a dispatch call (any role), backend runs `universalWarrantCheck(personId)` if not checked within last 1 hour.

### On Active Warrants Found

1. **WebSocket broadcast**: `broadcast('call:warrant_alert', { callId, personId, personName, role, warrantCount, highestSeverity })`
2. **Auto call note**: `"⚠️ WARRANT ALERT: [Name] ([role]) — [X] active warrant(s) — [Felony/Misdemeanor] — [charge summary]"`
3. **Notification** pushed to all units assigned to the call

### Dispatch UI

- Call card: red WARRANT badge when flagged persons attached
- Call detail: persons with warrants get red border + warrant icon
- Warrant icon click → Person Warrant Profile slide-out
- Map: call marker gets secondary red ring when warrant-flagged persons attached

### Applies to all person roles

Suspect, victim, witness, RP, involved — all tactically relevant.

---

## Section 6: Person Flag System — App-Wide Visibility

### Shared Component

`<WarrantBadge personId={id} />` — reads from person's flags, no extra API call.

### Where It Appears

| Page | Display |
|------|---------|
| Dispatch — call persons | Red WARRANT badge + count |
| Incidents — person lists | Red WARRANT badge, clickable |
| Field Interviews | Warning banner if subject has warrants |
| Arrests | Auto-populated warrant info |
| Records / Person Search | Red dot in results table |
| CRM / Trespass Orders | Subtle indicator on linked persons |

---

## Data Flow Summary

```
Person Created/Updated
  → universalWarrantCheck(personId)
    → Utah API + Scraped Warrants DB + Court Records
    → Dedupe by external_warrant_id
    → Auto-create warrants table records (EXT-YYYY-NNNNN)
    → Update person flags (ACTIVE_WARRANT)
    → WebSocket broadcast (warrant:hit)
    → If on active call → call:warrant_alert + auto call note

Hourly Scheduled Scan
  → For each person in persons table
    → universalWarrantCheck(personId)
    → Same pipeline as above

Dispatch Call → Person Linked
  → universalWarrantCheck(personId) if stale (>1h)
  → call:warrant_alert if hits found
```
