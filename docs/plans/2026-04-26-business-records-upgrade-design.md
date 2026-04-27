# Business Records Upgrade — Design

**Date**: 2026-04-26
**Owner**: chzamo@rmpgutah.us (RMPG Flex / Rocky Mountain Protective Group)
**Status**: Approved (brainstorming complete; implementation plan pending via writing-plans skill)

## Problem

The Records → Business module is at ~15% feature parity with Persons:

- **5 routes vs 38** for Persons
- **27 columns vs 60+** for Persons
- **No junction tables** linking Business to incidents, calls, or other entities
- **No dossier endpoint, no search, no export, no archive UI**
- **Cannot be entered as a victim** in call dispatches or incident reports — the canonical "Walmart got burgled" workflow has no structured representation
- Lives as a tab (`BusinessTab.tsx`) with a read-only detail pane that an officer described as "dull and unusable"

This blocks legitimate field workflows: a Walmart manager calling in a shoplifter has no way to be recorded as the reporting party "on behalf of the business," and the trespass list maintained for that location has no canonical link back to the business itself.

## Goals

1. Bring Business to true feature parity with Persons (junction tables, dossier, search, lifecycle endpoints).
2. Enable Business to fill any role on a call or incident that a Person can.
3. Surface Business as a first-class subject in the dispatcher and IR officer flows via a unified "+ Add Subject" picker.
4. Make the Business detail view operationally useful — a place an officer pulls up to answer "what do I need to know about this place RIGHT NOW," not a corporate registry.
5. Ship in three independently-deployable phases so the team can pause, validate, or roll back any individual phase without losing prior progress.

## Non-Goals

- Merging the Clients table into Businesses (option C in Q4 — explicitly deferred; would require touching invoicing/contract reports).
- Linking Business to Properties via FKs (option B in Q4 — explicitly deferred; keeps blast radius small).
- Promoting BusinessTab to a top-level navigation item (it stays as a Records sub-tab).
- A full Persons / Vehicles / Properties parity review — these are scoped as separate follow-up engagements per user intent.
- Visual regression testing, k6/locust load testing, full E2E with Playwright, accessibility audit (out of scope per existing project posture).

## Decisions Locked During Brainstorming

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Full role parity** for Business — same enum as Persons (victim, reporting_party, witness, suspect_affiliated, involved, other) | Matches realistic patterns: businesses appear as victim, RP via security/manager, witness corporately, etc. Avoids re-engineering when edge cases emerge. |
| Q2 | **Unified "+ Add Subject" picker** — one search returning Persons + Businesses inline, replacing the separate "Add Person" affordance | Matches Spillman/Motorola CAD UX. Dispatchers under pressure don't pre-classify entity type before searching. Reduces UI surface from N×2 to N×1. |
| Q3 | **`business_persons` junction table** with role + dates | Without it, Business is a glorified business card. Junction unlocks dossier richness, automatic flag/warrant alerts, cross-business person tracking. |
| Q4 | **Business stays independent** of Clients and Properties — no cross-FKs added | Smallest blast radius. Avoids migration risk on existing invoicing/property/patrol systems. Junction model can be added in a follow-up if needed. |
| Q5 | **Operational/security-focused dossier** — profile + linked persons (with warrant/flag badges) + active trespass + 30d activity + alarm/key info + photos | Matches RMPG's actual field use ("what do I need to know") not corporate registry questions. Trespass + active warrants on linked persons is safety-critical info. |
| Q6 | **Phased — 3 sequential PRs** (backend → detail page → subject picker) | Each PR <30 min review. Independent deploy + rollback. After today's outage, scary all-at-once deploys are unacceptable. |

## Architecture

### Schema additions

**3 new tables** (all mirror existing patterns from `incident_persons` and `call_persons`):

```sql
-- Junction: incident ↔ business with role
CREATE TABLE incident_businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id),
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  role TEXT NOT NULL CHECK(role IN ('victim','reporting_party','witness','suspect_affiliated','involved','other')),
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(incident_id, business_id)
);

-- Junction: call ↔ business with role
CREATE TABLE call_businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  business_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(call_id, business_id)
);

-- Junction: business ↔ person with role + dates
CREATE TABLE business_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  person_id INTEGER NOT NULL REFERENCES persons(id),
  role TEXT NOT NULL CHECK(role IN ('owner','officer_director','manager','key_holder','security_contact','employee','vendor','other')),
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(business_id, person_id, role)
);
```

**3 enhancement tables** added in PR 1 to support the enriched Section 4 dossier:

```sql
CREATE TABLE business_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('owner_employee','frequent_visitor','fleet','other')),
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(business_id, vehicle_id)
);

CREATE TABLE business_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  visit_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  latitude REAL,
  longitude REAL,
  notes TEXT
);

CREATE TABLE business_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  category TEXT CHECK(category IN ('storefront','interior','exterior','parking','other')),
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

**Columns added to existing `businesses` table** (via `addCol()` migrations, RMPG-domain-driven):

| Column | Type | Purpose |
|---|---|---|
| `alarm_company` | TEXT | "ADT", "Vector Security" — ops calls them at 3am |
| `alarm_panel_code` | TEXT | Encrypted at rest using JWT_SECRET-derived key (TOTP pattern) |
| `alarm_passphrase` | TEXT | Verbal duress code, encrypted |
| `after_hours_contact_name` | TEXT | Fallback if no key-holder Person linked |
| `after_hours_contact_phone` | TEXT | Same |
| `hours_of_operation` | TEXT (JSON) | Mon-Sun open/close |
| `holiday_schedule` | TEXT (JSON) | Closure dates |
| `loss_prevention_contact` | TEXT | Chain stores' LP teams |
| `insurance_carrier` | TEXT | For burglary/theft reports |
| `insurance_policy_number` | TEXT | Same |
| `parent_company` | TEXT | Free text. "Walmart Inc." |
| `franchise_id` | TEXT | "Store #321" |
| `photo_storefront_url` | TEXT | Officer ID-on-arrival reference |
| `archived_at` | TEXT | Soft-delete pattern matching Persons |

**Existing-table modifications:**

- `bolos` — add `linked_business_id INTEGER` (nullable) via addCol — supports "BOLOs referencing this business" panel.

**Indexes**: B-tree on every new FK column. Partial index `(business_id, end_date IS NULL)` on `business_persons` for "current employees" query speed. Partial index on `business_visits(business_id, visit_at DESC)` for the "last patrol" query.

**Migration safety**: 100% additive. No DROP, no rename. Backwards compatible with v5.7.0 if rolled back.

### API surface (18 new routes)

All under existing `/api/records/businesses` unless noted.

```
SEARCH & DOSSIER
GET    /businesses/search?q=...&limit=
GET    /businesses/:id/dossier
GET    /businesses/:id/incidents          (paginated, filter by role)
GET    /businesses/:id/calls
GET    /businesses/:id/persons
GET    /businesses/:id/trespass-orders

PERSON LINKING
POST   /businesses/:id/persons
PUT    /businesses/:id/persons/:linkId
DELETE /businesses/:id/persons/:linkId

INCIDENT/CALL LINKING
POST   /incidents/:id/businesses
PUT    /incidents/:id/businesses/:linkId
DELETE /incidents/:id/businesses/:linkId
POST   /dispatch/calls/:id/businesses
PUT    /dispatch/calls/:id/businesses/:linkId
DELETE /dispatch/calls/:id/businesses/:linkId

UNIFIED SUBJECT SEARCH (powers the picker)
GET    /records/subjects/search?q=...&types=person,business&limit=
       Returns discriminated union: [{type:'person'|'business', id, display_name, sub_text, badges, ...}]

LIFECYCLE
POST   /businesses/:id/archive
POST   /businesses/:id/unarchive
GET    /businesses/export?format=csv
```

**Plus** 3 endpoints each for `business_vehicles`, `business_visits`, `business_photos` (POST/DELETE/list).

**Auth**: All require `authenticateToken`. Mutations require `admin|manager|supervisor|dispatcher|officer`. Subject search open to all authenticated users. `client_viewer` and `human_resources` cannot create new persons/businesses (UI hides those buttons).

**Audit**: every mutation through `auditLog()` with entity name. WebSocket broadcasts on every change so live dispatch views auto-refresh.

### Dossier response shape

`GET /api/records/businesses/:id/dossier` returns aggregated payload (~12 indexed queries internally, p50 <30ms, p95 <80ms):

```typescript
{
  business: { /* full row from businesses table — 41 cols after migration */ },
  linked_persons: [
    { link_id, role, start_date, end_date, person: { ...full person + flags + active_warrant_count } }
  ],
  active_trespass_orders: [
    { order_id, subject_person_id, subject_name, issued_at, expires_at, violation_count }
  ],
  recent_activity: {
    incidents: [{ incident_id, type, role, occurred_at, summary }, ...],  // last 30d, cap 50
    calls: [{ call_id, incident_type, role, occurred_at, disposition }, ...],
    counts: { incidents_30d, calls_30d, incidents_all_time, calls_all_time }
  },
  alarm_info: {  // STRIPPED for client_viewer + human_resources roles
    company, panel_code, passphrase, after_hours_contact_name, after_hours_contact_phone
  },
  hours: { operation, holidays, is_currently_open },
  photos: [{ url, caption, category, uploaded_at }],
  vehicles: [{ link_id, relationship, vehicle: {...} }],
  visits: [{ visit_at, officer_name, lat, lon, notes }],
  related_businesses: [{ id, name, relationship_reason: 'parent_company'|'address_radius' }],
  active_bolos: [{ id, type, severity, summary }],
  heatmap: number[7][6],  // [day_of_week][4-hour bucket] — incidents+calls last 90d
  trend: { week_buckets: [...], pct_change_vs_prior: number },
  meta: { fetched_at, request_id, cache_hint: 'no-store' }
}
```

### UI architecture

**New route**: `/records/businesses/:id` → `<BusinessDetailPage>`

**Layout**: 3-column desktop (340px / flex / 340px), single-column stack on mobile (<768px).

**13 new components** (~1,400 LoC TSX total):

- `BusinessDetailPage` (top-level, route handler, dossier fetch)
- `BusinessProfileCard`
- `BusinessLinkedPersonsPanel` (with active-warrant badges)
- `BusinessTrespassPanel`
- `BusinessActivityTimeline` (incidents + calls, role filter, time filter)
- `BusinessHeatmap` (day × hour grid, 90d window)
- `BusinessAlarmCard` (auth-gated render)
- `BusinessLinkedVehiclesPanel`
- `BusinessVisitLog`
- `BusinessPhotoGallery` (multi-photo, captioned)
- `BusinessRiskCard` (trend %, top types, peak hours)
- `BusinessRelatedCard` (sister stores by parent / address radius)
- `BusinessFlagsCard`
- `BusinessQuickFactsCard` (last patrol, response stats, SLA)
- `BusinessHoursCard` (with "currently open" indicator)
- `BusinessActiveBolosCard`
- `BusinessDocumentsCard` (post orders, floorplan)

(Plus reuses: `PanelTitleBar`, `MapSnippetCard`, `FileAttachments`, `LinkedRecordsSection`, `NotesEditor`.)

**Title bar quick-actions**: 📞 After-hours · 🗺 Locate · ➕ Dispatch Unit · 📝 Log Visit · ✏ Edit · ⋯ More.

**Status pills**: 🟢 OPEN NOW (with countdown) · ⚠ N WARRANTS · 🚫 N TRESPASS · 🔴 N INCIDENTS 30D · 🟡 ARCHIVED.

### Unified Subject Picker

`<SubjectPicker>` modal — single search field, returns persons + businesses inline, role + notes selection.

**Replaces "Add Person" in 5 locations**: DispatchPage, IncidentsPage, FieldInterviewsPage, CaseManagementPage, TrespassOrdersPage.

**Backwards compatible**: existing `<PersonPicker>` is gutted to a thin wrapper that calls `<SubjectPicker types={['person']}>` — no breakage in screens not yet migrated.

**Behavior**:
- Debounced typeahead (250ms) → `GET /records/subjects/search`
- Empty state shows "recent subjects added by this user" (recency cache)
- Inline "+ Create New Person" / "+ Create New Business" buttons spawn quick-create form without leaving modal
- Role pre-selection when invoked from a context that implies role (e.g., "Add Victim" button)
- Multi-add mode for dispatch (modal stays open, running list of attached subjects)
- Keyboard shortcuts: ↑↓ navigate · Enter select · 1-5 set role · Esc close · ⌘+Enter add

**Search ranking**:
1. Exact-match boosters: name prefix, phone exact, EIN exact, plate exact
2. Recency (+20 if touched in last 7 days)
3. Co-occurrence (subjects historically appearing together rank higher when one is the search context)
4. Active warrant/flag (+10 — surfaces high-risk subjects faster)

## Data Flow

### Adding a Business as Victim to a Call

1. Dispatcher clicks "+ Add Subject" on call edit screen
2. `<SubjectPicker>` opens modal, focuses search field
3. Dispatcher types "walmart 321"
4. Debounced fetch to `GET /records/subjects/search?q=walmart%20321&types=person,business&limit=20`
5. Results render: Walmart business at top, John Smith (linked owner with warrant) below
6. Dispatcher clicks Walmart row → row highlights, focus moves to Role dropdown
7. Role defaults to Victim (call context implied this), dispatcher confirms
8. Dispatcher clicks "Add to Call"
9. `POST /api/dispatch/calls/:id/businesses` body `{business_id, role: 'victim', notes: ''}`
10. Server inserts into `call_businesses`, fires `auditLog`, broadcasts `call_business_added` WebSocket event
11. Modal closes, call edit view live-updates with attached business shown in Subjects panel
12. Other dispatchers viewing the same call see the addition in real-time via WebSocket

### Opening a Business dossier

1. Officer navigates Records → Business tab → clicks Walmart row
2. `<BusinessTab>` calls `navigate('/records/businesses/47')`
3. `<BusinessDetailPage>` mounts, fetches `GET /api/records/businesses/47/dossier`
4. Server runs ~12 indexed queries in parallel, encrypts/decrypts alarm fields per role, returns shape
5. All 13 panels render (some with skeleton until their data arrives if any individual query slow-paths)
6. WebSocket subscriptions registered: `business_updated:47`, `incident_business_added:47`, `call_business_added:47`, `business_persons_updated:47`
7. Any change to this business by anyone in the system triggers panel-level refresh via existing `useLiveSync` hook

## Error Handling

- **409 Conflict** on duplicate `(incident_id, business_id)` or `(business_id, person_id, role)` — UI shows "Already linked" toast
- **400 Bad Request** with role enum violation — UI shows "Invalid role" with allowed values
- **403 Forbidden** when `client_viewer` or `human_resources` attempts mutation — UI hides buttons proactively, server enforces as defense-in-depth
- **404** when business archived — UI shows "Business archived" page with restore option for `admin|manager`
- **500 with structured error code** — alarm decryption failures (would indicate JWT_SECRET rotation, requires `admin` re-key)
- **WebSocket disconnect** — UI degrades to polling refresh every 30s, banner indicates "Live sync paused, reconnecting..."
- **Search timeout** (>500ms) — UI shows "Search slow, narrowing results" hint, server returns partial results with `truncated: true` flag

## Testing

**Layer 1 — Unit** (vitest, isolated): heatmap bucketing, "currently open" timezone math, encryption round-trips, search ranking. Coverage target 90%+ on aggregation/search utility files.

**Layer 2 — Integration** (vitest + supertest, in-memory SQLite): all 18 new routes + auth gating + role enum enforcement + dossier shape + performance bound (<200ms for fixture business with 100 incidents + 50 calls + 10 linked persons).

**Layer 3 — Smoke** (vitest + jsdom): `BusinessDetailPage` renders all 13 panels for empty / minimal / full / archived / sensitive-restricted variants. `SubjectPicker` debounce + keyboard nav + role pre-fill behave with mocked search results.

**Per-PR test gates** wired into existing husky pre-push + GitHub Actions infrastructure. PR 3 includes manual end-to-end smoke documented in PR description (dispatcher creates test call, attaches Walmart, opens dossier, sees the call in recent activity).

**Explicitly NOT tested**: visual regression, load testing, accessibility audit, cross-browser (matches existing project posture).

## Rollout Plan

| PR | Branch | Estimate | Bumps CACHE_NAME | User-visible? |
|---|---|---|---|---|
| **PR 1** — Schema & backend | `feat/business-records-backend` | 2-3 days | v448 → v449 | No |
| **PR 2** — Business detail page | `feat/business-detail-page` | 5-6 days | v449 → v450 | Yes (dossier viewer works standalone) |
| **PR 3** — Unified Subject picker | `feat/unified-subject-picker` | 3-4 days | v450 → v451 | Yes (closes the loop end-to-end) |

**Total wall-clock**: 10-13 working days.

**Cross-cutting safeguards**:
- Each PR independently deployable + revertable
- Zero cross-PR coupling (PR 2 doesn't depend on PR 3 UI; PR 3 doesn't change schema)
- `CACHE_NAME` bump per PR retires officers' stuck service workers cleanly
- Deploy lock (per Gotcha #43) prevents concurrent-worktree clobbering
- Verification curl after each deploy

**Rollback**:
- PR 1 revert: tables stay (additive, harmless), routes disappear cleanly
- PR 2 revert: detail page disappears, BusinessTab returns to in-tab read-only pane, no data loss
- PR 3 revert: `SubjectPicker` disappears, `PersonPicker` wrapper returns to original behavior, PRs 1+2 stay live

## Open Questions / Future Work

- Whether to merge Clients into Businesses (Q4 option C) — deferred; revisit after PR 3 lands and field officers report on whether the duplication causes real friction
- Whether to add `business_id` FK to Properties (Q4 option B) — deferred; same trigger
- Persons / Vehicles / Properties parity review — explicit follow-up engagement per user intent ("review afterwards")
- Inheritance from `parent_company` — currently free-text; if we ever want recursive aggregation ("show all incidents at any Walmart store"), we'd need an FK to a `business_groups` table
- Visit log → patrol shift integration — could auto-log visits from GPS breadcrumbs without officer manually pressing "Log Visit"

## References

- CLAUDE.md Gotcha #21 (typecheck deploy gate)
- CLAUDE.md Gotcha #43 (deploy lock for concurrent worktrees)
- CLAUDE.md Gotcha #44 (husky pre-push hook in worktrees)
- Existing patterns in `incident_persons`, `call_persons`, `vehicles_records.owner_person_id`
- Existing dossier endpoint at `/api/incidents/mni/person/:personId` (the model this design mirrors)
