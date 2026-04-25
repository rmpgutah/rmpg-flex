# Warrants PDF + UI Enhancement — Phase 1 Design

**Date:** 2026-04-24
**Author:** Claude (audit session)
**Status:** approved through Section 5, ready for implementation planning
**Branch:** `feat/warrants-pdf-ui-phase-1-2026-04-24`

---

## Context

RMPG Flex is a private security / CAD-RMS operator. The agency **does not serve warrants** — it **checks** warrants for officer safety when encountering subjects on patrol and **hands off** to real law enforcement when appropriate.

The current warrants PDF and Warrants-tab UI are functional but thin: the PDF is missing NCIC compliance fields, subject identification intel (aliases, marks), source provenance, and the RMPG encounter log; the list lacks triage affordances (priority, age, freshness, match-our-person).

This Phase-1 design enhances both the PDF and the list UI to support three real use cases:

1. **Officer-safety briefing** — patrol officer encountering a subject needs to confirm identity, understand severity, see pattern of RMPG encounters
2. **Contemporaneous documentation** — when we detain someone, we need a print-worthy record proving what we had on file and when
3. **Clean handoff package** — when turning someone over to real LE, we need their NCIC reference fields so the agency can pick up where we left off

Workflow scope explicitly **excluded**: assigning internal officers to execute, logging service attempts, extradition handling, affidavit-of-service PDFs, bulk-assign. These don't match RMPG's workflow.

---

## Approach

Phased rollout across 3 PRs. **This document covers Phase 1 only.**

| Phase | Audience | Scope |
|---|---|---|
| **P1 (this design)** | Officers + Dispatchers/supervisors | Field-sheet PDF v2 (QR, NCIC block, source, associates, RMPG encounters, bigger mugshot, statute text) **+** list polish (priority/age/freshness/match columns, filter chips, sticky header, bulk archive/review/print-packet) |
| **P2** | — (deferred; subject to re-scoping based on P1 feedback) | Detail panel polish; additional filters; dashboard upgrades |
| **P3** | Executives / reporting | Monthly warrant-summary PDF, scraper-health snapshot, state-coverage CSV export |

---

## Section 1 — PDF v2 layout

**Goal:** print-worthy detailed record, single-page when possible, content overflow to page 2.

### New content blocks

| Block | Location | Content | Data source |
|---|---|---|---|
| QR code | Top-right of page 1, ~1×1" | Scannable URL to `/warrants/:id` | Generated client-side |
| NCIC compliance box | Directly below header | ORI, OCA#, NCIC Entry #, Issue Date, Priority Score | `warrants.ori`, `oca_number`, `ncic_entry_number`, `issue_date`, `priority_score` |
| Priority indicator | Stamp/banner | Red "CRITICAL" / Amber "HIGH" / Blue-Gray "MEDIUM" / Gray "LOW" | Computed from `priority_score` |
| Mugshot (enlarged) | Page 1, ~2×2" | Current `photo_url` but 2× size | `persons.photo_url` |
| Subject aliases | Subject block | Known AKAs | `persons.alias_nickname`, aliases table |
| Distinguishing features | Subject block | Scars, marks, tattoos | `persons.scars_marks_tattoos`, `distinguishing_features` |
| Statute text (expanded) | Below charges | Full statute description | Join `utah_statutes` on `warrants.statute_id` |
| Known associates | Collapsible section | Name + relationship | `person_associates` (if subject linked) |
| Known vehicles | Collapsible section | Plate + description | `vehicles_records` where `owner_person_id` = subject |
| Source / provenance | Below court info | Scraper name, state, URL, last-scraped, verification | `warrants.source`, `external_source_key`, JOIN `warrant_scraper_config`, `scraped_warrants` |
| RMPG encounters | Bottom section | Dates, incident/call refs, property name | `call_persons`, `incident_persons`, `field_interviews.person_id` |
| Print audit footer | Bottom of last page | "Printed by {name} #{badge} on {ts}" | `req.user` at render time |

### Watermark rules

- `expires_at < now` → red "EXPIRED" diagonal watermark
- `archived_at IS NOT NULL` → gray "ARCHIVED" diagonal watermark
- Both printable — watermarks for provenance, don't block the page

### New fields added to `WarrantPdfData` interface

```typescript
oca_number?: string;
ori?: string;
ncic_entry_number?: string;
issue_date?: string;
priority_score?: number;
statute_text?: string;
qr_code_data_url?: string;
subject_aliases?: string[];
subject_scars_marks_tattoos?: string;
subject_distinguishing_features?: string;
known_associates?: { name: string; relationship: string }[];
known_vehicles?: { plate: string; description: string }[];
source_scraper_name?: string;
source_state?: string;
source_url?: string;
source_last_scraped_at?: string;
source_verification?: string;
rmpg_encounters?: { date: string; context: string; property?: string }[];
printed_by_name?: string;
printed_by_badge?: string;
printed_at?: string;
```

**Removed / excluded** (per Section 1 reframe): `assigned_officer_name`, `assigned_officer_badge`, `assigned_unit_call_sign`, `extradition`, service-attempt-history block.

---

## Section 2 — UI revisions

### New columns in the Warrants tab table

| Column | Content | Sort |
|---|---|---|
| ☐ Select | Row checkbox | n/a |
| ★ Match | Gold star if `subject_person_id IS NOT NULL` | Boolean desc |
| Priority | Chip: Critical/High/Medium/Low driven by `priority_score` buckets | High→low default |
| Warrant # | Existing | Alpha |
| Subject | Mugshot thumb (24×24) + name + DOB | Alpha |
| Type | Felony / Misd / Bench / Other | Alpha |
| Charge | First 80 chars of `charge_description` | Alpha |
| Status | Active / Served / Expired / Archived chip | Alpha |
| Source | State badge (UT/NV/FBI/…) with scraper name on hover | Alpha |
| Age | Days since `issue_date` (fallback `created_at`): `3d` / `2w` / `6mo` | Numeric |
| Freshness | 🟢 <24h / 🟡 <7d / 🟠 <30d / ⚫ >30d / MANUAL | Numeric |
| Actions | Row-hover icons: Print / View / Archive | n/a |

Default sort: `priority_score DESC, age ASC`.

### Filter chips

Horizontal row above the table:

```
[All]  [High priority]  [New this week]  [Matches our person]  [By state ▼]  [Federal only]  [Show archived]
```

Chips combine AND. Free-text search box unchanged, AND-combined. State stored in URL query params for refresh/share.

### Sticky header + polish

- Fixed header when scrolling long lists
- Click column to sort; arrow shows active sort
- Zebra striping + hover highlight
- Result-count summary: *"Showing 47 warrants · Priority ≥70 · Last 7 days · State: UT"*

### Bulk actions

When 1+ rows selected:

```
[3 selected]   [Print packet PDF]   [Mark reviewed]   [Archive]   [Clear]
```

- **Print packet PDF** — client-side: loops selected warrants, renders each with new PDF layout into a single combined jsPDF file, downloads as one PDF
- **Mark reviewed** — sets `reviewed_at` + `reviewed_by` (new columns)
- **Archive** — sets `archived_at` = now
- No bulk-assign / no bulk-serve

### Detail panel additions

- Larger mugshot header
- Priority/source/freshness chips inline
- Source provenance collapsible (scraper name, URL, last-scraped, verification)
- RMPG encounter log collapsible (if subject linked, top 20 + "+N more")
- Known associates + known vehicles collapsible (if subject linked)
- Print PDF button (uses new layout)
- Link/unlink person button

### Preserved unchanged

- Tab structure (6 tabs total, existing IDs)
- Dashboard / Search All / Watch List / Sources / Scrapers tabs
- Free-text search box
- Row-click-for-detail behavior
- `WarrantAlertBanner.tsx` and `WarrantBadge.tsx`

---

## Section 3 — Server/API

### Schema additions (lazy `ensureWarrantReviewColumns(db)` pattern)

```typescript
function ensureWarrantReviewColumns(db: any) {
  const cols = db.prepare('PRAGMA table_info(warrants)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'reviewed_at'))
    db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_at TEXT').run();
  if (!cols.some(c => c.name === 'reviewed_by'))
    db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_by INTEGER').run();
  if (!cols.some(c => c.name === 'last_scraped_at'))
    db.prepare('ALTER TABLE warrants ADD COLUMN last_scraped_at TEXT').run();
}
```

Also a sibling `ensureWarrantIndexes(db)` to idempotently add indexes on `priority_score`, `issue_date`, `subject_person_id`, `source`, `last_scraped_at`.

### Existing endpoints — extended responses

**`GET /api/warrants`** — add SELECT fields:
- `priority_score`, `issue_date`, `source`, `external_source_key`, `last_scraped_at`, `reviewed_at`, `subject_person_id`
- Computed: `age_days`, `freshness_days`, `matches_person` (boolean)
- LEFT JOIN `persons` for subject name/dob/photo_url when linked

Query params:
- `?priority_min=<int>`
- `?since_days=<int>`
- `?matches_person=1`
- `?state=<2char>` or `?state_prefix=<prefix>` (federal)
- `?include_archived=1`
- `?sort=priority|age|freshness|alpha&order=asc|desc`

**`GET /api/warrants/:id`** — extend response:
- All existing fields
- `statute_text` (LEFT JOIN `utah_statutes`)
- `source_metadata` object (scraper details)
- `rmpg_encounters[]` array (top 20)
- `known_associates[]`, `known_vehicles[]` (if subject linked)

### New endpoints

**`POST /api/warrants/bulk-archive`**
```json
Request: { "warrant_ids": [1, 2, 3] }
Response: { "archived": 3, "skipped": 0 }
```
Auth: `authenticateToken`, any role. Soft limit 500, hard reject >500.

**`POST /api/warrants/bulk-review`**
```json
Request: { "warrant_ids": [1, 2, 3] }
Response: { "reviewed": 3 }
```
Same auth shape.

### Client-side only

- QR code generation (`qrcode` npm package — add to client/package.json if missing)
- Bulk packet PDF (loop, render each into shared `jsPDF` doc, single download)

### No changes to

- `multiStateWarrantScraper.ts`
- `scraped_warrants` table
- Authentication / middleware
- Dashboard / Search All / Watch List / Sources / Scrapers endpoints

---

## Section 4 — Error handling & edge cases

### PDF

- Missing `photo_url` → "PHOTO ON FILE" placeholder box
- `qrcode.toDataURL` throws → fall back to plain URL text
- Missing statute → show citation only; if both null, omit row
- No linked person → omit Known Associates / Known Vehicles / RMPG Encounters sections entirely
- Manually entered warrant → Source section reads "Manually entered by {name} on {date}"
- `expires_at < now` → red EXPIRED watermark
- `archived_at IS NOT NULL` → gray ARCHIVED watermark
- Unicode names → NotoSans font fallback; transliterate unsupported glyphs
- Long content → existing `checkPageBreak` overflow pattern
- `req.user` missing → footer reads "Printed by: Unknown"

### List view

- 10k+ rows → paginate at 100/page (existing pattern)
- Missing indexes → `ensureWarrantIndexes(db)` creates them idempotently
- 0-row filter → empty state with "Clear all filters" button
- Filter state in URL query params (share-friendly)
- Archived in another session → 404 on detail → toast + auto-refetch
- `last_scraped_at` null → MANUAL chip instead of day badge
- Orphan FK (subject_person_id set but persons row deleted) → no star, no crash

### Bulk actions

- Mix of archived/unarchived → silent skip, return `{ archived: N, skipped: M }`
- Packet print >50 → confirm dialog; >200 → hard reject
- Auth expired mid-op → `apiFetch` refresh-token retry; fail → toast, keep selection
- Empty `warrant_ids` → 400
- \>500 ids → 400
- No "select all matches across pages" in Phase 1 — only "select visible"

### Preserving existing behavior

- `WarrantAlertBanner`, `WarrantBadge` untouched
- `GET /api/warrants/dashboard/*` unchanged
- `GET /api/warrants/national-*` unchanged
- Watch list untouched
- `downloadRecordPdf('warrant', data, fileName)` signature unchanged; all callers keep working

---

## Section 5 — Testing

### Server-side

**Integration** (`tests/integration/warrants.test.ts` extensions):
- Filter chip query params (priority_min, matches_person, state, since_days, combined)
- Detail response includes/excludes computed blocks based on subject link
- Bulk archive success, partial, empty, over-limit
- Bulk review success

**Unit** (`tests/utils/warrantHelpers.test.ts`, new file):
- `computePriorityBucket` for 95/75/45/15/null
- `formatAge` for 3d/2w/6mo/2y
- `computeFreshnessClass` for fresh/recent/stale/old/manual

**Lazy-init** (`tests/unit/warrantReviewColumns.test.ts`, new file):
- First call adds columns
- Second call is no-op
- Existing DB no-ops cleanly

### Client-side

**PDF smoke** (`recordPdfGenerator.smoke.test.ts` extensions):
- Full data renders, expected text tokens present
- Minimal data renders placeholders, no Known-Associates section
- Expired watermark drawn
- Archived watermark drawn
- Unicode names don't crash
- QR fallback when `qrcode.toDataURL` rejects
- Known-Associates + RMPG-Encounters sections conditional on linked person

### Regression

Full vitest suite passes: **589 → 589+new, 0 failures.**

### Manual verification on production after deploy

- Print active/expired/archived warrants, verify QR scans, watermarks correct
- Print warrant with/without linked person, verify conditional sections
- Filter by priority, matches-person, state, combinations
- Sticky header on scroll
- Bulk archive, bulk review, bulk packet print
- Sort by priority / age / freshness
- `WarrantAlertBanner` still shows on a call with linked person with active warrant
- `WarrantBadge` still shows on person record

### Out of scope for Phase 1

- Playwright end-to-end browser tests
- Pixel-diff PDF snapshots
- Cross-browser (we target Electron + Chrome only)
- WCAG accessibility audit
- Load testing with >10k warrants

---

## Implementation sequencing

Suggested build order (confirmed in writing-plans step):

1. **Server schema + helpers** — `ensureWarrantReviewColumns`, `ensureWarrantIndexes`, unit tests
2. **Server API extensions** — extend GET endpoints with new fields + filter params, add bulk endpoints, integration tests
3. **PDF generator refactor** — extend `WarrantPdfData`, add new content blocks, QR code, watermarks, smoke tests
4. **UI list view** — new columns, filter chips, sticky header, bulk action bar, detail panel additions
5. **Client packet-print** — client-side PDF merging for bulk action
6. **Manual verification on live** — checklist above
7. **Deploy + monitor**

---

## Success criteria

- All approved sections (1–5) implemented
- Server typecheck 0 errors
- Client typecheck 0 errors
- Client vite build exit 0
- Full vitest suite passes
- Manual checklist complete on production
- No regression in existing warrant flows

---

## Out of scope (explicitly deferred to later phases)

- Phase 2: further UI polish, additional dashboard widgets (TBD based on P1 feedback)
- Phase 3: executive reporting PDFs, scraper health snapshots, coverage CSV export
- Process-server workflow (removed — not applicable to RMPG)
- Service-attempt tracking (removed — not applicable)
- Bulk officer assignment (removed — not applicable)
