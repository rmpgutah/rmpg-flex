# Forensics Subsystem — Government/CJIS-Standard Reconstruction

**Date:** 2026-07-13
**Status:** Approved for planning

## Context

`src/routes/forensics.ts` implements a "Phase 1 RMS" forensic lab case
management system: cases → exhibits → analyses, with a basic JSON
chain-of-custody array per exhibit. Its header comment claims several
endpoints are "deferred to follow-up PRs," but on inspection most of that
list (turnaround times, backlog metrics, queue priority, capacity
planning, QC check/history) is already implemented and working — the
comment is stale.

What's genuinely missing, confirmed by code inspection:

- **Hashes**: `forensic_exhibits.hash_md5`/`hash_sha256` are single
  overwritable columns captured at intake only. No re-verification, no
  mismatch detection, no history. `ForensicLabPage.tsx:469-476` already
  calls `GET /forensic-lab/:id/links` and `GET /forensic-lab/:id/hashes`
  and silently swallows their 404s.
- **Cross-links**: no junction table or endpoints exist at all for linking
  a forensic case to persons/vehicles/cases/incidents/evidence elsewhere
  in the RMS. The frontend Links tab and its search bar are fully built
  and wired to endpoints that don't exist.
- **QC records**: `/qc-check` and `/qc-history` exist but write/read the
  generic `activity_log` table with a JSON-stringified `details` blob.
  The frontend checks `qc.details?.includes('PASS')`, which never matches
  the JSON payload — QC results always render as FAIL.
- **Report/analysis templates**: `GET /forensics/templates/report` and
  `GET /forensics/analysis-templates` query tables
  (`forensic_report_templates`, `forensic_analysis_templates`) that were
  never created in any migration. Both endpoints silently return `{data:
  []}` on the missing-table error.

Connections (`src/routes/connections.ts`, `ConnectionsPage.tsx`) was
investigated and found to be mature, fixed, and verified live in
production (PR #756 and follow-ups) — no reconstruction needed there.
This spec covers forensics only.

## Goals

Bring the forensics subsystem to a government/CJIS-lab standard on four
axes: tamper-evident hashing, RMS-wide cross-linking, a properly-recorded
QC workflow, and report/analysis templates feeding the existing
client-side PDF engine. Government forensic-lab standards (CJIS Security
Policy, ISO/IEC 17025, ANAB accreditation criteria) converge on two
non-negotiables that anchor this work: every piece of evidence must be
tamper-evident (hash captured at intake, re-verifiable on demand, any
mismatch immediately visible), and every action on a case must be part of
a complete, immutable audit trail (already substantially served by
`forensic_activity_log`, extended here for hashes and QC).

## Non-goals

- No known-hash-set (NCMEC/CSAM-style) matching against an uploadable
  contraband hash database — tamper-evidence only, per user decision.
- No server-side PDF rendering — reports continue to render client-side
  via the existing `generateForensicCasePdf` (jsPDF) engine; templates
  only supply structured section data to that existing renderer.
- No changes to `src/routes/connections.ts` or `ConnectionsPage.tsx`.
- No reintroduction of the `queue/reorder` drag-to-reprioritize UI that a
  prior PR intentionally removed (dead code, no backend) — out of scope
  unless requested separately.

## Design

### 1. Hash / tamper-evidence

**New table** `forensic_exhibit_hashes`:
```
id, forensic_case_id, exhibit_id, algorithm ('md5'|'sha1'|'sha256'),
hash_value, purpose ('intake'|'reverify'), file_name,
mismatch INTEGER DEFAULT 0, computed_by, computed_by_name, computed_at
```
Append-only — never UPDATE an existing row. Re-verifying an exhibit
inserts a new `purpose='reverify'` row; the handler compares it against
the most recent row of the same `algorithm` for that exhibit and sets
`mismatch=1` if the values differ. A mismatch also writes a
`hash_mismatch` entry to `forensic_activity_log` (existing table) so it
surfaces in the case timeline, not just the Hashes tab.

The existing `forensic_exhibits.hash_md5`/`hash_sha256` columns are left
in place (existing intake flow keeps writing them for backward
compatibility with the exhibit list view) but the Hashes tab is
backed entirely by the new table.

**Endpoints** (mounted under `/forensic-lab`, i.e. `src/routes/forensics.ts`):
- `POST /:caseId/exhibits/:exhibitId/hashes` — body `{algorithm,
  hash_value, purpose, file_name?}`. Returns the created row plus
  `mismatch` boolean.
- `GET /:caseId/hashes` — returns `{hashes: [...], stats: {total,
  flagged, matched}}` matching the shape `ForensicLabPage.tsx:474`
  already destructures. `flagged` = count where `mismatch=1`. `matched`
  (renamed from the frontend's slightly confusing "DB Matches" label,
  left as-is since no hash-set matching exists) will always be 0 given
  the non-goal above — surfaced honestly as 0 rather than removing the
  UI stat, since hash-set matching may be added later.

**Digital-imaging metadata**: `handleSaveImaging` (tool, algorithm,
original/verification hash, imager, date) is exhibit-scoped forensic
metadata, not a generic hash record. Store as a JSON column
`imaging_metadata` on `forensic_exhibits`, written via `PUT
/:caseId/exhibits/:exhibitId` (already-generic update handler — add
`imaging_metadata` to `EXHIBIT_UPDATABLE`, stored as JSON.stringify).

### 2. Cross-links

**New table** `forensic_case_links`:
```
id, forensic_case_id, entity_type, entity_id, entity_label,
relationship DEFAULT 'related', linked_by, linked_by_name, linked_at
```

**Endpoints**:
- `GET /:caseId/links/search?q=` — mirrors `records.ts:2003`'s contract
  exactly (same `type` param values, same label-synthesis pattern, same
  50-row cap, same try/catch → `dbErrorResponse`). Implemented as a thin
  wrapper that calls the same per-type query logic (extracted into a
  shared helper if that's cleaner, or duplicated with a comment pointing
  at the canonical version — decided at implementation time based on how
  entangled `records.ts`'s existing function is).
- `GET /:caseId/links` — list current links for a case.
- `POST /:caseId/links` — body `{entity_type, entity_id, relationship?}`,
  looks up a label for the target entity server-side (don't trust a
  client-supplied label), inserts, logs `link_added` activity.
- `DELETE /:caseId/links/:linkId` — removes, logs `link_removed`.

### 3. QC workflow

**New table** `forensic_qc_checks`:
```
id, forensic_case_id, exhibit_id, check_type, reviewer_id,
reviewer_name, pass INTEGER, reviewer_notes, created_at
```

`POST /:id/qc-check` and `GET /:id/qc-history` are rewritten to use this
table instead of the generic `activity_log`. `qc-check` also still logs a
`qc_check` entry to `forensic_activity_log` (for the unified case
timeline) with a human-readable summary string like `"peer_review:
PASS"`, separate from the structured `forensic_qc_checks` row the QC tab
reads. This fixes the PASS/FAIL display bug as a byproduct, since the
frontend's `qc.details?.includes('PASS')` check will now be replaced with
reading the structured `pass` field directly (small frontend change).

### 4. Reports + analysis templates

**New tables**:
```
forensic_report_templates: id, name, case_type, sections (JSON: ordered
  list of {key, label, source_field?}), active, created_at

forensic_analysis_templates: id, name, case_type, analysis_type,
  methodology, equipment_used, active, created_at
```
Seeded via the migration with a small starter set per `CASE_TYPES` (e.g.
a "Standard DNA Report" template, a "Digital Forensics Imaging" analysis
template) so the tabs aren't empty on first deploy.

`GET /templates/report` and `GET /analysis-templates` already exist and
just need their backing tables (no code change beyond the migration).

**New endpoint** `POST /:caseId/apply-template` — body `{template_id}`.
Loads the template's `sections`, stores them as
`forensic_cases.report_sections` (new JSON column) so
`generateForensicCasePdf` can read a structured section list instead of
hardcoding the report layout. `generateForensicCasePdf` gets a small
extension to render an optional sections array if present, falling back
to its current hardcoded layout if `report_sections` is null (keeps
existing behavior for cases created before this ships).

## Data flow / migration

One migration file (next free integer — confirm exact number at
implementation time via `ls migrations/ | tail`, README says 0174 but the
directory has files through 0186, so likely 0187) creates all 5 new
objects: `forensic_exhibit_hashes`, `forensic_case_links`,
`forensic_qc_checks`, `forensic_report_templates`,
`forensic_analysis_templates`, plus the `imaging_metadata` and
`report_sections` columns via idempotent `ALTER TABLE ... ADD COLUMN`
(D1 doesn't support `IF NOT EXISTS` on ADD COLUMN — accept the re-apply
failure per project convention). Seed rows for templates included in the
same file.

## Error handling

Follow existing file conventions throughout: `dbErrorResponse(c, err,
...)` for mutation endpoints, `try { } catch { return c.json({data: []})
}` for best-effort read endpoints (stats/list), `requireRole(...)` gating
matching the case-level pattern already used elsewhere in the file
(`admin, manager, officer, supervisor` for writes). Hash mismatch and
link/QC activity all append to `forensic_activity_log` — never blocks the
underlying mutation on a logging failure, matching `logActivity`'s
existing best-effort behavior.

## Testing

No Worker test suite exists yet for `/src/` beyond typecheck (per
CLAUDE.md). This PR should add smoke coverage for the new endpoints under
`test-workers/` (Miniflare), following the pattern in
`test-workers/health.test.ts` / `test-workers/auth.test.ts` — at minimum:
hash insert + mismatch detection, link create/search/delete, QC
check/history round-trip. Client-side: no new component tests required
beyond removing the now-obsolete `.catch()`-to-empty comments; existing
`ForensicLabPage` isn't currently unit-tested per the Explore report, so
this doesn't regress test coverage.

## Deploy

After merge, apply the migration directly to live D1 (`785de7ae`) via
`scripts/apply-migration.sh <file>` per CLAUDE.md's standard drift
mitigation, and verify via `pragma_table_info` for each new table.
