# Geography Rebuild — Areas / Sectors / Zones / Beats

**Status:** Approved (2026-04-10). Ready for implementation planning.
**Author:** Claude (pair with user via brainstorming skill)
**Related:** CLAUDE.md gotchas #30, #37 (dispatch geography, dual CREATE TABLE)

---

## Problem

The dispatch geography system is broken on three levels:

1. **Data model wrong.** The schema has 5 overlapping tables (`dispatch_districts`, `dispatch_areas`, `dispatch_sections`, `dispatch_zones`, `dispatch_beats`), the second tier is named "Sections" but should be "Sectors," and the API in `server/src/routes/dispatch/districts.ts` already has BOTH `/geography/sections` and `/geography/sectors` endpoints — a half-finished rename left consumers split between the two.
2. **Data content wrong.** The 269 rows seeded into `dispatch_districts` are stale placeholder data that don't map to real Utah counties or municipalities. The three rich GeoJSON files at `client/public/geojson/` (county.geojson — 29 features, municipality.geojson — 261 features, beat.geojson — 719 features) are never ingested into the database despite being served to the map.
3. **UI broken.** `GeographyPage.tsx` is 1,040 lines with a tree view that doesn't render correctly, references the obsolete `section_*` column names, and mixes tree rendering with form editing in ways that don't work.

The user asked for a single unified pass: rename the second tier, reseed from real Utah GeoJSON, and rebuild the page layout.

## Desired semantics

| Tier | Meaning | Utah data source |
|---|---|---|
| **Areas** | Sub-state regions | 6 AOG (Association of Government) regions, hard-coded |
| **Sectors** | Counties | `county.geojson` (29 features) |
| **Zones** | Municipalities | `municipality.geojson` (261 features) + synthetic "unincorporated" per county |
| **Beats** | Patrol sub-zones | `beat.geojson` (719 features) |

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Scope of "fix" | **D.** All three: rename + reseed + UI rewrite |
| What are Areas? | **A.** Utah AOG regions (combined to 6 for simplicity; Wasatch Front lumps WFRC+MAG counties) |
| Existing call data | **A.** Fresh wipe + reseed; existing `section_id`/`zone_id`/`beat_id` on calls go NULL |
| Beat generation | **C.** Polygon-based, seeded from existing `beat.geojson` |

## Non-goals (YAGNI)

Explicitly **not** in scope:

- Map polygon editor in the admin page (use the existing MapPage for rendering)
- Bulk CSV import/export (re-seeding from GeoJSON is the bulk path)
- Drag-and-drop row reparenting (use the edit form's parent dropdown)
- Migrating the 269 existing `dispatch_districts` rows to the new tables (user confirmed "fresh wipe" — they were placeholder data anyway)
- Change-history tracking beyond the existing `auditLog()` calls
- Supporting arbitrary nested tiers beyond 4 (Areas/Sectors/Zones/Beats is the lock)

---

## Section 1 — Schema

### Final tables

```sql
dispatch_areas           -- 6 rows (Utah AOG regions)
  id, area_code UNIQUE, area_name, color, description, commander,
  sort_order, active, created_at, updated_at

dispatch_sectors         -- 29 rows (Utah counties) — RENAMED from dispatch_sections
  id, sector_code UNIQUE, sector_name, area_id FK, county_nbr, fips_code,
  color, description, supervisor, radio_channel, sort_order, active, created_at, updated_at

dispatch_zones           -- ~287 rows (261 municipalities + ~26 unincorporated)
  id, zone_code UNIQUE, zone_name, sector_id FK, zone_type, ugrc_code,
  color, description, primary_unit, backup_unit, radio_channel, hazard_notes,
  population_estimate, sq_miles, sort_order, active, created_at, updated_at

dispatch_beats           -- 719 rows (from beat.geojson)
  id, beat_code UNIQUE, beat_name, beat_descriptor, zone_id FK,
  district_letter, beat_number, dispatch_code,
  color, assigned_unit, backup_unit, hazard_notes, premise_alerts,
  patrol_frequency, priority_modifier, population_estimate, sq_miles,
  sort_order, active, created_at, updated_at
```

### Tables removed

- `dispatch_districts` — legacy flat 3-tier table, obsoleted by normalized model
- `dispatch_sections` — renamed to `dispatch_sectors`, all column refs `section_*` → `sector_*`

### Indexes

```sql
CREATE INDEX idx_sectors_area ON dispatch_sectors(area_id);
CREATE INDEX idx_zones_sector ON dispatch_zones(sector_id);
CREATE INDEX idx_beats_zone ON dispatch_beats(zone_id);
CREATE INDEX idx_beats_dispatch_code ON dispatch_beats(dispatch_code);
```

### Foreign-key column renames on consuming tables

- `calls_for_service.section_id` → `sector_id`
- `incidents.section_id` → `sector_id`
- `field_interviews`, `citations`, etc. — audit during implementation, rename any `section_id` found

### Rationale

- Keep integer primary keys; rename affects table name + column names only, not PK strategy (avoids cascading changes in ~30 call sites that reference FKs as integers).
- One atomic migration block, not a sequence of patches — reduces risk of partial state.
- `county_nbr` and `fips_code` on sectors, `ugrc_code` on zones — retained from the GeoJSON properties so future re-syncs can match by stable Utah state IDs, not by name (names change with annexations).

---

## Section 2 — Seed from Real GeoJSON

### New module: `server/src/seeds/geographySeed.ts`

Idempotent seed that reads the three GeoJSON files + a hard-coded AOG mapping and populates all 4 tables. Runs once on empty DB, no-op otherwise.

### Hard-coded AOG constant

```typescript
const UTAH_AOG_REGIONS = {
  BEAR_RIVER:   { name: 'Bear River',   counties: ['BOX ELDER','CACHE','RICH'] },
  WASATCH_FRONT:{ name: 'Wasatch Front',counties: ['WEBER','MORGAN','DAVIS','SALT LAKE','TOOELE','SUMMIT','UTAH','WASATCH'] },
  SIX_COUNTY:   { name: 'Six County',   counties: ['JUAB','MILLARD','PIUTE','SANPETE','SEVIER','WAYNE'] },
  UINTAH_BASIN: { name: 'Uintah Basin', counties: ['DAGGETT','DUCHESNE','UINTAH'] },
  SOUTHEASTERN: { name: 'Southeastern', counties: ['CARBON','EMERY','GRAND','SAN JUAN'] },
  FIVE_COUNTY:  { name: 'Five County',  counties: ['BEAVER','GARFIELD','IRON','KANE','WASHINGTON'] },
} as const;
```

6 areas total. Wasatch Front combines WFRC + MAG per user decision. Can be split later without migration — rename/split rows in `dispatch_areas`.

### Sector code override map

3-letter prefix would collide on "SAN JUAN" / "SANPETE". Hard-coded overrides:

```typescript
const SECTOR_CODE_OVERRIDES = {
  'SAN JUAN': 'SJN',
  'SANPETE':  'SNP',
  'BOX ELDER':'BXE',
  'SALT LAKE':'SLC',
  'UINTAH':   'UNT',
  'UTAH':     'UTC',
};
```

Full override list finalized during implementation dry-run.

### Ordered seed procedure

1. **Areas** — 6 rows from `UTAH_AOG_REGIONS`
2. **Sectors** — 29 rows from `county.geojson`, joined to Areas via the AOG reverse-map
3. **Zones** — 261 rows from `municipality.geojson`, joined to Sectors via `COUNTYNBR`, plus ~26 synthetic `{CODE}-UNINC` zones for each county that has unincorporated beats
4. **Beats** — 719 rows from `beat.geojson`, joined to Zones via `city_code`

### Orphan handling

Beats whose `city_code` doesn't match any zone after Step 3 go into a synthetic `UTAH-ORPHAN` zone under a `Unmatched` sector in a `NONE` area. Expected: 0 rows after seed, but defensive.

### Integration

Single call from `database.ts` after the schema creation block, replacing the existing "Seed normalized geography tables from existing dispatch_districts" block.

### Expected row counts

| Table | Rows |
|---|---|
| `dispatch_areas` | 6 |
| `dispatch_sectors` | 29 |
| `dispatch_zones` | ~287 |
| `dispatch_beats` | 719 |
| **Total** | **~1,041** |

---

## Section 3 — API Routes

### File rename

`server/src/routes/dispatch/districts.ts` → `server/src/routes/dispatch/geography.ts`

Single import site updated in `server/src/routes/dispatch/index.ts`.

### URL surface — all mounted under `/api/dispatch/geography/*`

| Tier | Endpoints |
|---|---|
| **Areas** | GET `/areas`, GET `/areas/:id`, POST `/areas`, PUT `/areas/:id`, DELETE `/areas/:id` |
| **Sectors** | GET `/sectors` (with `?area_id=`), GET `/sectors/:id`, POST, PUT, DELETE |
| **Zones** | GET `/zones` (with `?sector_id=`, `?area_id=`), GET `/zones/:id`, POST, PUT, DELETE |
| **Beats** | GET `/beats` (with `?zone_id=`, `?sector_id=`, `?area_id=`, `?active=`), GET `/beats/:id`, POST, PUT, DELETE |
| **Aggregates** | GET `/tree` (cached 60s), GET `/stats`, GET `/identify?lat=&lng=` |
| **Preserved** | GET `/codes`, premise alerts endpoints (unchanged) |

### Deleted endpoints

All `/geography/sections*` routes (GET, POST, PUT, DELETE — the entire half-finished set).

### Role model

- GET: any authenticated user
- POST/PUT: admin, manager
- DELETE: admin only

### Response shapes

Strongly typed `Area`, `Sector`, `Zone`, `Beat` interfaces. Child counts rolled up via subquery. Parent names JOINed in for convenience.

### Validation

- Required fields + parent FK existence check (400 `INVALID_PARENT`)
- UNIQUE code violations → 409 `CODE_EXISTS`
- Standard `requireRole` middleware for auth

### Tests

New `server/src/routes/dispatch/__tests__/geography.test.ts` with 10 tests:

1. `/areas` returns 6 rows with correct codes
2. `/sectors?area_id=1` filters correctly
3. `/zones?sector_id=1` filters correctly
4. `/beats?zone_id=1` filters correctly
5. `/tree` has correct 4-level nesting
6. `/identify?lat=40.7608&lng=-111.8910` returns SLC beat
7. Anonymous GET returns 401
8. Officer POST to `/sectors` returns 403
9. POST zone without `sector_id` returns 400
10. Old `/sections` path returns 404 (regression guard)

### Consumer updates

Server: `incidents.ts`, `reports.ts`, `dispatch/*.ts`, `serveIntake.ts`, `citations.ts`, `utils/geofence.ts`
Client: `DispatchPage.tsx` (both), `GeographyPage.tsx`, `MapPage.tsx`, `IncidentsPage.tsx`, `CodeEnforcementPage.tsx`, `TrespassOrdersPage.tsx`, `CustomReportBuilder.tsx`, `detached/IncidentDetailWindow.tsx`, `dispatch/utils/dispatchMappers.ts`

All `section_*` → `sector_*` via mechanical rename in commit 1.

---

## Section 4 — UI: GeographyPage rebuild

### Layout — Spillman Miller Column drilldown

```
┌─────────────────────────────────────────────────────────────────────┐
│ PanelTitleBar + search + stats                                      │
├─────────┬─────────┬────────────┬──────────────┬────────────────────┤
│ AREAS   │ SECTORS │ ZONES      │ BEATS        │ DETAIL PANEL       │
│ (6)     │ (n/29)  │ (n/287)    │ (n/719)      │                    │
│ ▸ Bear │ Box Eld│ Brigham   │ BXE-A-1     │ Selected metadata  │
│ ▸ Wasat│ Cache   │ City      │ BXE-A-2     │ + edit form        │
│ ▸ Six C│ Rich    │ Perry     │ BXE-A-3     │                    │
│ ...     │         │ Unincorp. │              │ [Edit] [Delete]    │
│ w:180   │ w:180   │ w:240     │ w:240        │ flex-1             │
├─────────┴─────────┴────────────┴──────────────┴────────────────────┤
│ Stats bar: 6 areas • 29 sectors • 287 zones • 719 beats • 0 orphan │
└────────────────────────────────────────────────────────────────────┘
```

### Mobile fallback

On viewports < 1024px: single-column cascade with breadcrumb. Tap replaces current column with next tier.

### Data flow

- Mount → `GET /geography/tree` once, stored in local state
- Drill-down filtering is client-side (fast, no roundtrip)
- Mutations: optimistic local update → API call → background refetch to reconcile

### Components (all in `GeographyPage.tsx`)

```
GeographyPage
├── GeographyHeader (title + search + stats)
├── GeographyColumns
│   └── TierColumn (x4 — reusable)
│       ├── ColumnHeader (title, count, [+ Add])
│       └── ColumnRow (name, secondary text, child count)
├── DetailPane (view | edit | create)
└── StatsBar
```

### Keyboard navigation

| Key | Action |
|---|---|
| ↑/↓ | Move within column |
| →/← | Drill into child / back to parent |
| `/` | Focus search |
| `n` | New child of current selection |
| `e` | Edit current |
| `Delete` | Prompt delete |
| `Esc` | Close edit/create |

### Styling

Pure-black Spillman theme: `var(--surface-raised)` columns, `#222` dividers, `#d4a017` gold selection border, 2px radii, `.input-dark` / `.select-dark` form classes. Zero blue hex anywhere (blue-killswitch CSS from earlier session would override any leak regardless).

### Form fields per tier

| Tier | Fields |
|---|---|
| Area | code, name, color, description, commander, sort_order, active |
| Sector | code, name, area (dropdown), county_nbr (readonly), color, description, supervisor, radio_channel, active |
| Zone | code, name, sector (dropdown), zone_type, primary_unit, backup_unit, radio_channel, hazard_notes, color, active |
| Beat | code, name, descriptor, zone (dropdown), district_letter, beat_number, dispatch_code, assigned_unit, backup_unit, hazard_notes, patrol_frequency, priority_modifier, color, active |

### File changes

- `client/src/pages/GeographyPage.tsx` — full rewrite (~700 lines, down from 1,040)
- `client/src/hooks/useGeographyTree.ts` — new fetcher with 60s cache
- `client/src/types/geography.ts` — new TypeScript interfaces

---

## Section 5 — Migration & Rollout

### 3 commits, merged in order

#### Commit 1 — Mechanical rename (zero behavior change)

**Title:** `refactor(geography): rename dispatch_sections → dispatch_sectors (mechanical)`

**Rename mapping applied globally:**
```
dispatch_sections → dispatch_sectors
section_id → sector_id
section_name → sector_name
section_code → sector_code
/geography/sections → /geography/sectors
interface Section → interface Sector
"Section" → "Sector"   (UI label strings)
SECTIONS → SECTORS     (UI headers)
```

**DB migration (idempotent, runs once):**
```sql
ALTER TABLE dispatch_sections RENAME TO dispatch_sectors;
ALTER TABLE calls_for_service RENAME COLUMN section_id TO sector_id;
ALTER TABLE incidents RENAME COLUMN section_id TO sector_id;
-- ...for any other tables discovered during the rename grep pass
DROP INDEX IF EXISTS idx_sections_area;
CREATE INDEX idx_sectors_area ON dispatch_sectors(area_id);
```

**Verification gate:**
- Duplicate-routes check passes
- `tsc --noEmit` (server + client): 0 errors in touched files
- Vite build passes
- All 343 tests pass
- Grep for `section_id|dispatch_sections|/geography/sections` → 0 code hits

#### Commit 2 — Schema fill-out + seed from GeoJSON

**Title:** `feat(geography): seed from Utah GeoJSON (6 areas, 29 sectors, 287 zones, 719 beats)`

**Changes:**
- `database.ts`: drop `dispatch_districts`, add missing columns (`county_nbr`, `fips_code`, `zone_type`, `ugrc_code`, `district_letter`, `beat_number`), truncate+reseed via seed module
- `server/src/seeds/geographySeed.ts` (new): 250-line GeoJSON ingestion
- `server/src/seeds/data/utahAogRegions.ts` (new): AOG constant
- `server/src/routes/dispatch/districts.ts` → `geography.ts` (rename + rewrite)
- `server/src/routes/dispatch/index.ts`: update import
- `server/src/routes/dispatch/__tests__/geography.test.ts` (new): 10 tests
- `client/src/pages/GeographyPage.tsx`: minimal stub (fetches new endpoints, placeholder UI) so page doesn't crash between commits

**Verification gate:**
- Delete local DB, restart server, confirm seed logs show 6 / 29 / ~287 / 719 rows
- `curl` spot checks on `/tree`, `/sectors`, `/zones`, `/beats`, `/identify`
- 343 + 10 = 353 tests pass
- Vite build passes

#### Commit 3 — UI rewrite

**Title:** `feat(geography): rebuild GeographyPage with 4-column miller layout`

**Changes:**
- `client/src/pages/GeographyPage.tsx` — full ~700-line rewrite
- `client/src/hooks/useGeographyTree.ts` — new
- `client/src/types/geography.ts` — new

**Verification gate:**
- Vite build passes
- Launch preview, log in as admin, navigate to `/geography`
- Click-through cascade works: Areas → Sectors → Zones → Beats
- Add/Edit/Delete operations persist to server
- Search filters across all 4 tiers
- Keyboard nav works
- Mobile fallback kicks in at < 1024px
- Screenshot captured for PR
- No blue hex in the new file (grep check)

### Production deploy sequence

1. Local preflight: run each commit against a local DB reset, confirm behavior
2. `bash deploy/deploy.sh` from main repo root (pre-deploy gates: tsc, vitest, vite build)
3. Post-deploy smoke:
   - `curl -sS https://rmpgutah.us/api/dispatch/geography/tree | jq '.areas | length'` → `6`
   - Admin login → Geography page → confirm 4 columns render with real data
   - Create test call → verify `sector_id`/`zone_id`/`beat_id` persist
   - `journalctl -u rmpg-flex --no-pager -n 50` clean

### Rollback plan

- `deploy.sh` creates `server/data/rmpg-flex.db.bak` on every deploy
- If post-deploy smoke fails: `ssh root@194.113.64.90 "cp /opt/rmpg-flex/server/data/rmpg-flex.db.bak /opt/rmpg-flex/server/data/rmpg-flex.db && systemctl restart rmpg-flex"`
- `git revert` the 3 commits on main, redeploy

### Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pre-existing ~130 client TS errors hide a new one I introduced | Medium | Low | Grep tsc output for filenames I touched |
| ALTER TABLE RENAME COLUMN fails on old schema | Low | Medium | Wrap each ALTER in try/catch (follows existing `addCol()` pattern) |
| Sector code collision on SAN JUAN/SANPETE | High unmitigated | Medium | Hard-coded override map before seed runs |
| Rename breaks auth flow via stale import | Very Low | High | `tsc --noEmit` catches all broken imports |
| 1,040→700 line rewrite introduces React hook-order violation | Medium | Medium | ≥5 min preview interaction + browser console check |
| Beats with unmatched `city_code` → orphans | Medium | Low | Synthetic `UTAH-ORPHAN` zone + stats count shown in UI |
| Undiscovered consumer of `dispatch_districts` | Medium | Medium | Full-text grep before commit 1 |

### Estimated diff

| Commit | Files | +lines | −lines |
|---|---|---|---|
| 1 — rename | ~15 | ~100 | ~100 |
| 2 — schema + seed + API | ~12 | ~900 | ~400 |
| 3 — UI rewrite | ~4 | ~700 | ~1040 |
| **Total** | **~31** | **~1700** | **~1540** |

Net +160 lines for a working 4-tier system with real data and a proper admin UI.

---

## Open questions for implementation

- Should commit 1 also delete the now-unused `DISPATCH_DISTRICTS` constant file immediately, or defer to commit 2 where it's replaced? (Leaning: defer — keeps commit 1 pure rename.)
- Should the 10 new tests live in `server/src/routes/dispatch/__tests__/geography.test.ts` or `server/tests/integration/geography.test.ts`? (Leaning: integration — matches existing test organization.)
- Which specific cities should a future "RMPG operational subset" filter highlight on the Zones column? Punt to follow-up — not in this pass.

These are resolvable during implementation without re-opening the design.

---

## Next step

Hand off to `superpowers:writing-plans` skill to produce the step-by-step implementation plan, which becomes the TodoWrite checklist for execution.
