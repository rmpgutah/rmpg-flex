# Person Intelligence Dossier — Design Spec
**Date:** 2026-06-22  
**Status:** Approved  
**Author:** Claude (brainstorming session)

---

## Overview

A standalone **Person Intelligence** module that accepts any identifying seed (name, DOB, phone, email, license plate) and builds a persistent, multi-source dossier on a subject via a three-phase async pipeline: internal D1 records → OSINT API fan-out → Firecrawl live webcrawl. Results are cross-corroborated across sources with a confidence scoring engine targeting 95%+ accuracy on verified data points. A visual connections graph aggregates relationships across all stored dossiers.

---

## Goals

- Accept any single identifier as a seed and expand to a full dossier
- Fan out to 11 OSINT API sources in parallel (Phase 2)
- Live-crawl the open web via Firecrawl + Claude extraction (Phase 3)
- Score every data point by cross-source corroboration (1/2/3+ sources → 0.40/0.60/0.80+ confidence)
- Surface only 0.60+ confidence facts in the primary dossier; suppress noise below 0.40
- Auto-link discovered identity to existing `persons`, `warrants`, `arrests`, `calls_for_service`, `alpr_captures`, `national_sex_offenders` records
- Persist all investigations with full source audit trail for chain-of-custody
- Export court-ready PDF in RMPG letterhead style
- Visualize multi-hop relationship graph across all stored dossiers

---

## Non-Goals

- Real-time continuous monitoring (this is on-demand investigation, not a watch daemon)
- Social media scraping that requires authentication (public web only)
- NCIC terminal queries (separate gated system)
- Paid commercial databases beyond already-configured API keys

---

## Architecture

### New Files

```
src/routes/personIntel.ts
src/durable-objects/PersonIntelDO.ts
client/src/pages/intel/PersonIntelPage.tsx
client/src/pages/intel/PersonIntelDossierPage.tsx
client/src/pages/admin/AdminPersonIntelTab.tsx
migrations/XXXX_person_intelligence.sql
```

### Durable Object: `PersonIntelDO`

One DO instance per investigation (keyed by dossier ID). Manages the three-phase pipeline sequentially, survives Worker restarts, and pushes live phase updates to the client via WebSocket. Follows the existing `DeepResearchDO` pattern already in the codebase.

**Internal state machine:**
```
PENDING → PHASE1_RUNNING → PHASE1_DONE
        → PHASE2_RUNNING → PHASE2_DONE
        → PHASE3_RUNNING → COMPLETE
        → ERROR (at any phase, logs failing source, continues others)
```

Each phase transition triggers a WebSocket push of the accumulated data points so far. The client renders incrementally — Phase 1 data is readable within 3 seconds while Phase 3 crawl is still running.

### Worker Routes (`src/routes/personIntel.ts`)

```
POST   /api/person-intel              Create investigation, spawn DO, return {id, wsUrl}
GET    /api/person-intel              List investigations (paginated, filter by status/date)
GET    /api/person-intel/:id          Full dossier (REST polling fallback)
GET    /api/person-intel/:id/ws       WebSocket endpoint (live updates)
DELETE /api/person-intel/:id          Admin/creator only
POST   /api/person-intel/:id/rerun    Re-run failed or incomplete phases only
GET    /api/person-intel/graph        Aggregated connections graph across all dossiers
```

All routes require auth. Role-based access enforced per access control matrix below.

---

## Data Model

### Migration: `XXXX_person_intelligence.sql`

```sql
CREATE TABLE IF NOT EXISTS person_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_seed TEXT NOT NULL,          -- JSON: {name?,dob?,phone?,email?,plate?}
  subject_name TEXT,                   -- resolved canonical name
  subject_dob TEXT,                    -- resolved DOB (YYYY-MM-DD)
  subject_photo_url TEXT,              -- R2 URL if photo found via crawl
  status TEXT NOT NULL DEFAULT 'pending',
  phase INTEGER NOT NULL DEFAULT 0,   -- 0=not started, 1/2/3=current phase
  phase1_completed_at TEXT,
  phase2_completed_at TEXT,
  phase3_completed_at TEXT,
  risk_score REAL DEFAULT 0,           -- 0–100 composite
  risk_flags TEXT,                     -- JSON array of triggered flags
  linked_person_id INTEGER,            -- FK → persons.id (auto-linked)
  sources_queried INTEGER DEFAULT 0,
  sources_succeeded INTEGER DEFAULT 0,
  data_points_found INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  org_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS person_intel_data_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  category TEXT NOT NULL,    -- address|phone|email|associate|vehicle|social|business|legal|online
  field TEXT NOT NULL,       -- e.g. "current_address", "phone_carrier", "breach_count"
  value TEXT NOT NULL,
  sources TEXT NOT NULL,     -- JSON array: ["MicroBilt","Pipl","Firecrawl"]
  confidence REAL NOT NULL,  -- 0.0–1.0
  verified_by INTEGER DEFAULT 0, -- count of independent sources agreeing
  officer_note TEXT,
  officer_flagged INTEGER DEFAULT 0,
  promoted INTEGER DEFAULT 0,  -- officer promoted from Unverified Leads
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  from_subject TEXT NOT NULL,   -- canonical name or "SUBJECT"
  relationship TEXT NOT NULL,   -- associate|relative|co-resident|business-partner|co-defendant
  to_subject TEXT NOT NULL,
  to_subject_dossier_id INTEGER, -- FK if a dossier exists for this person
  confidence REAL NOT NULL,
  sources TEXT NOT NULL,         -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  phase INTEGER NOT NULL,        -- 1, 2, or 3
  status TEXT NOT NULL,          -- success|error|skipped|not_configured
  response_time_ms INTEGER,
  data_points_found INTEGER DEFAULT 0,
  error_message TEXT,
  queried_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pid_dossier ON person_intel_data_points(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pic_dossier ON person_intel_connections(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pis_dossier ON person_intel_sources(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pi_linked_person ON person_intelligence(linked_person_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON person_intelligence(status);
```

---

## Three-Phase Pipeline

### Phase 1 — Internal Records (`~1–3s, zero API cost`)

Parallel D1 queries across 8 internal tables. Results carry a `+0.12` confidence bonus (own records are highest trust). An internal warrant hit adds `risk_score += 30`.

| Internal Source | Seed used | Data returned |
|---|---|---|
| `persons` | name / DOB | Existing person records, address, DOB |
| `warrants` | name / DOB | Active/closed warrants, charges |
| `arrests` | name / DOB | Booking history, charges |
| `calls_for_service` | name | CFS involvement (caller/subject/witness) |
| `alpr_captures` + `vehicle_sightings` | plate | Plate read history, vehicle associations |
| `vehicles_records` | plate / name | Registered vehicles |
| `crm` contacts | name / email / phone | Overwatch/CRM profile |
| `national_sex_offenders` | name / DOB | NSOPW matches already in DB |

Phase 1 data is written to `person_intel_data_points` immediately and pushed to the client via WebSocket before Phase 2 begins.

### Phase 2 — OSINT API Fan-out (`~10–40s, parallel`)

All configured sources queried simultaneously via `Promise.allSettled`. Each has an isolated adapter that normalizes the response into `person_intel_data_points` rows. A missing API key or source error logs `status: 'skipped'` or `status: 'error'` to `person_intel_sources` and never blocks the other sources.

| Source | Seed | Returns |
|---|---|---|
| MicroBilt | name+DOB / SSN | Identity verification, address history, phone, relatives |
| Pipl | name / phone / email | Deep identity — social profiles, employment, education |
| Spokeo | name / phone / email / address | Reverse lookup, address history, associates |
| NumVerify | phone | Carrier, line type, location, validity |
| AbstractAPI | phone + email | Phone validation, email verification |
| Hunter.io | email / domain | Email finder, domain-linked emails, confidence |
| EmailRep.io | email | Reputation, breach history, social links |
| Have I Been Pwned | email | Data breach membership, breach names |
| Clearbit | email | Employer, title, social profiles |
| WhoisXML | email domain | Domain ownership, registrant, DNS history |
| Censys | email / IP | Internet infrastructure linked to subject |

After all Phase 2 results land: run **cross-source fusion**. For each distinct (category, value) pair, count how many sources reported it. Apply confidence formula:

```
base = 0.40
per_additional_source = +0.18 (capped at 3 sources)
webcrawl_bonus = +0.08 (applied in Phase 3 if crawl corroborates)
internal_bonus = +0.12 (if Phase 1 internal record matched)
confidence = min(base + (source_count - 1) * 0.18 + bonuses, 0.95)
```

Discrepant facts (source A reports address X, source B reports address Y) are both stored with their individual confidence scores — neither is silently dropped.

### Phase 3 — Firecrawl Live Webcrawl (`~60–120s`)

**3a. Query construction** — build 4–8 search queries from resolved identity:
```
"FirstName LastName" "City, State"
"FirstName LastName" site:linkedin.com OR site:facebook.com OR site:instagram.com
"FirstName LastName" court OR arrest OR warrant OR conviction
"FirstName LastName" LLC OR company OR business OR registered agent
+[phone number if known]
+[email address if known]
```

**3b. Scrape** — Firecrawl searches each query, returns top results. Admin-configurable depth:
- Light: 5 pages total (~30s)
- Medium: 10 pages total (~75s) ← default
- Deep: 20 pages total (~120s)

**3c. Claude extraction** — each scraped page sent to Claude (falls back to GPT-4o if `anthropic_api_key` unset) with a structured extraction prompt. Returns JSON:
```json
{
  "names": ["string"],
  "aliases": ["string"],
  "dob_mentions": ["string"],
  "addresses": ["string"],
  "phones": ["string"],
  "emails": ["string"],
  "associates": [{"name": "string", "relationship": "string"}],
  "businesses": [{"name": "string", "role": "string"}],
  "court_references": ["string"],
  "social_urls": ["string"],
  "news_mentions": ["string"],
  "source_url": "string",
  "source_credibility": "high|medium|low"
}
```

Extracted entities cross-referenced against Phase 1+2 data. Corroborated facts get `+0.08` confidence boost. Net-new facts added as `confidence: 0.42` (single Firecrawl source) to "Unverified Leads" unless corroborated.

---

## Confidence Scoring & Risk Score

### Confidence tiers

| Score | Label | Display | Dossier section |
|---|---|---|---|
| 0.00–0.39 | Noise | Suppressed | Hidden entirely |
| 0.40–0.59 | Possible | Red bar | Unverified Leads |
| 0.60–0.79 | Probable | Amber bar | Unverified Leads |
| 0.80–0.95 | Verified | Green bar + chip | Primary dossier |

Thresholds are admin-configurable in `AdminPersonIntelTab`.

### Risk score flags (additive, capped at 100)

| Trigger | Points |
|---|---|
| Active warrant found (internal) | +30 |
| NSOPW match found | +25 |
| OFAC / sanctions match | +40 |
| HIBP breach count > 3 | +10 |
| Firecrawl finds arrest/court mention | +15 |
| Sex offender registry match (other) | +20 |

---

## Client UI

### `PersonIntelPage.tsx` — `/intel/person`

- **Seed form** — fields: Name, DOB, Phone, Email, License Plate. Any combination valid. "Run Intelligence" button submits.
- **Investigation list** — paginated table: subject name, status badge (Pending / Running / Complete / Error), risk score, phase progress dots (●●○), created by, elapsed/total time, deep-link.

### `PersonIntelDossierPage.tsx` — `/intel/person/:id`

**Two tabs:** Dossier | Connections

**Dossier tab:**

Live phase progress bar (three segments: Internal / OSINT APIs / Webcrawl) fills as each phase completes. Data appears immediately after each phase — user reads Phase 1 while Phase 2 is running.

Sections in order:
1. **Identity** — canonical name, DOB, photo, risk score badge, confidence, source count, internal record links
2. **Addresses** — current + historical, geocoded mini-map, per-row source chips + confidence bar
3. **Phones** — number, carrier, line type, location, breach indicator
4. **Emails** — address, reputation score, breach count, linked social profiles
5. **Associates** — name, relationship, confidence, [Run Dossier] button per row
6. **Vehicles** — plate, make/model/year, ALPR hit count, last seen, [View ALPR History]
7. **Social Profiles** — platform, URL, discovery source
8. **Business Interests** — company, role, state registered
9. **Legal / Criminal** — warrants, arrests, CFS, NSOPW (Phase 1 only, highest confidence)
10. **Online Presence** — news mentions, court URLs, web footprint (Phase 3)
11. **Unverified Leads** — collapsed by default, confidence 0.40–0.79, officer can promote or dismiss each item

Each data point row: `value | source chips | confidence bar | note icon`

Actions: Export PDF | Add Note | Flag for Review | Link to Person Record | Rerun Investigation

**Connections tab:**

Force-directed graph (`react-force-graph-2d`). Aggregates `person_intel_connections` across all dossiers.

Node types and colors:
- Person — blue circle (size = confidence)
- Address — orange square
- Phone — green diamond
- Email — purple diamond
- Vehicle — grey hexagon
- Business — teal rectangle

Edge labels: `lives at`, `owns`, `associate of`, `co-resident`, `co-defendant`, `relative of`

Clicking a person node: mini-card with name, confidence, [Open Dossier] or [Run Dossier].

---

## Admin Configuration: `AdminPersonIntelTab.tsx`

Tab ID: `person_intel`. Roles: admin, manager only.

### Panel 1 — Source Configuration

Grid of all 11 Phase 2 sources. Per source:
- Enable/Disable/Test-only toggle
- Key status chip (configured ✓ / missing ✗) with [Configure Key →] link to `AdminIntegrationsTab` at that key's row
- Avg response time + last used (from `person_intel_sources` stats)

### Panel 2 — Webcrawl Settings

- Crawl depth: Light / Medium / Deep radio
- AI extraction model: Claude / GPT-4o / Disabled
- Checkboxes for which query types to run (name+location, name+court, name+social, phone, email, name+business)

### Panel 3 — Confidence & Display Thresholds

- Suppress below (default 0.40)
- Unverified leads below (default 0.60)
- Verified badge at (default 0.80)
- Risk flag checkboxes with point values (admin-editable)

### Panel 4 — Investigation Stats

Live metrics from `person_intel_sources`:
- Total investigations, avg completion time
- Phase 2/3 success rates
- Top contributing source by verified data points
- Investigations this week

---

## Access Control

| Role | Run investigation | View dossier | Configure sources | Delete |
|---|---|---|---|---|
| admin / manager | ✓ | Any | ✓ | Any |
| supervisor | ✓ | Any | ✗ | Own only |
| officer | ✓ | Own only | ✗ | ✗ |
| dispatcher | ✗ | ✗ | ✗ | ✗ |

---

## PDF Export

Court-ready PDF following the existing forensics/arrests PDF pattern:
- RMPG letterhead + case number
- Subject identity header with risk score
- All verified (0.80+) data points with source citations
- Unverified leads section (clearly labeled)
- Source audit table (which APIs were queried, response status, timestamp)
- Officer signature line + date generated
- Chain-of-custody note: "Generated by [officer], [datetime], Investigation ID [id]"

---

## D1 Column Cap Awareness

No new columns added to `calls_for_service` or `persons` (already at/near the 100-column cap). Cross-referencing to those tables is done via JOIN on ID, not by adding columns. `person_intelligence.linked_person_id` FK is on the new table only.

---

## Migrations

Apply via `scripts/apply-migration.sh XXXX_person_intelligence.sql` after merge (deploy step is `continue-on-error`). Four new tables — no existing tables modified.

Register `PersonIntelDO` binding in `wrangler.toml`:
```toml
[[durable_objects.bindings]]
name = "PERSON_INTEL_DO"
class_name = "PersonIntelDO"

[[migrations]]
tag = "v_person_intel"
new_classes = ["PersonIntelDO"]
```

---

## Dependencies

- `FIRECRAWL_API_KEY` — required for Phase 3 (Phase 3 skipped cleanly if unset)
- `anthropic_api_key` or `openai_api_key` — required for Phase 3 Claude extraction (raw text mode if both unset)
- Phase 2 sources: each independently optional — any configured key activates that source
- `react-force-graph-2d` — new client dependency for connections graph

---

## Implementation Sequence

1. D1 migration + DO binding in `wrangler.toml`
2. `PersonIntelDO` (Phase 1 only) + Worker routes + WebSocket
3. `PersonIntelPage.tsx` + `PersonIntelDossierPage.tsx` (Phase 1 display)
4. Phase 2 source adapters (one per API, isolated)
5. Cross-source fusion + confidence scoring engine
6. Phase 3 Firecrawl + Claude extraction
7. `AdminPersonIntelTab.tsx`
8. Connections graph tab
9. PDF export
10. Nav entry + access control gates
