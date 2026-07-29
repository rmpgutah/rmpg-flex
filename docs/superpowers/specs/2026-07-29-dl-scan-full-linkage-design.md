# DL Scan — Full AAMVA Field Coverage + Automatic Record Linking

**Status:** Approved for planning (Part A of a two-part program; Part B — passport MRZ scanning — is a separate future spec).

## Problem

The DL barcode scanner shipped in the prior PR (#3160) already parses every AAMVA element from a driver's-license PDF417 barcode via `parseAamva()`, but the persistence and linking behind it is incomplete:

1. **Field loss.** `POST /records/from-dl-scan` (`src/routes/records.ts:362-488`) writes only a subset of parsed fields to `persons`/`persons_ext`. Dropped entirely: `suffix` (column exists in `persons_ext`, never written by this path), `country`, `document_discriminator`, `is_real_id`, `is_organ_donor`, `is_veteran` (column exists on `persons`, never written by this path), `under_18_until`, `under_21_until`, `aamva_version`, `issuer_id`, `address2`, and the full raw AAMVA element dump.
2. **Disconnected DL-record store.** Scanning a license creates/updates a `persons` row but never writes `dl_records` — a separate table populated only via `DlSearchPage`'s independent `POST /dl-records` call. A scanned license doesn't show up in DL-record search/lookup unless someone separately re-enters it.
3. **No automatic linking beyond vehicle/property.** The endpoint already dedupes/links a `Vehicle` (by plate) and a `Property` (by address), and already dedupes the `Person` itself (by `dl_number`, falling back to exact name+DOB). It does not link warrants, the current call, or a case the current call belongs to.

## Goals

- Every field `parseAamva()` extracts reaches D1 — nothing silently dropped.
- One scan populates both `persons` and `dl_records` — no separate re-entry.
- Scanning a subject during a call automatically links them to that call (and its case, if any) and surfaces any active warrants — on-scene, at scan time, without a second lookup step.
- Non-goals: no new fuzzy-matching infrastructure (reuse existing exact name+DOB/address dedupe patterns already in this endpoint); no changes to `LiveDlScanner.tsx` or `aamvaParser.ts` (already correct, already parse everything needed); no passport/MRZ work (Part B, separate spec).

## Design

### 1. Schema — `persons_ext` overflow columns (migration `0211`)

`persons` is at the D1 100-column SELECT cap (94 live columns per CLAUDE.md); all new AAMVA fields go to `persons_ext` (1:1 overflow table, existing pattern from migration `0081`/`0155`), never to `persons`.

New columns on `persons_ext`:

| Column | Type | Source AAMVA field |
|---|---|---|
| `country` | TEXT | `AamvaResult.country` |
| `document_discriminator` | TEXT | `AamvaResult.document_discriminator` |
| `is_real_id` | INTEGER (0/1/NULL) | `AamvaResult.is_real_id` |
| `is_organ_donor` | INTEGER (0/1/NULL) | `AamvaResult.is_organ_donor` |
| `under_18_until` | TEXT (ISO date) | `AamvaResult.under_18_until` |
| `under_21_until` | TEXT (ISO date) | `AamvaResult.under_21_until` |
| `aamva_version` | INTEGER | `AamvaResult.aamva_version` |
| `issuer_id` | TEXT | `AamvaResult.issuer_id` |
| `address2` | TEXT | `AamvaResult.address2` |
| `raw_aamva_elements` | TEXT (JSON, truncated to 8000 chars) | `AamvaResult.raw_elements` |

`is_veteran` already exists on `persons` (unused by this path) — no migration needed, just wire the write. `suffix` already exists on `persons_ext` — same, just wire the write.

`PERSON_EXT_COLUMNS` (`src/routes/records.ts:255-260`) gets these 10 new keys added to the set; `writePersonExt`/`mergePersonExt` need no changes (they're generic over the set).

### 2. `POST /records/from-dl-scan` — full field write + `dl_records` upsert

Extend the `scan` body handling (`records.ts:399-418`) to pass all newly-covered fields through to `writePersonExt`, and to write `is_veteran`/`suffix` on the base `persons` INSERT/UPDATE path alongside the existing fields.

After the person is resolved (created or reused), upsert `dl_records` in the same request using the existing upsert-on-`(dl_number, dl_state)` logic from `POST /dl-records` (`src/routes/dlRecords.ts:88-189`) — extracted into a shared internal helper function (e.g. `upsertDlRecord(db, userId, body)`) called from both routes, rather than duplicating the SQL or making an internal HTTP round-trip. `dl-records.ts`'s route becomes a thin wrapper calling the same helper, preserving its existing request/response contract for `DlSearchPage`'s manual-entry flow.

### 3. Automatic linking

All linking happens after the person is resolved, in the same request, using the existing `db`/`execute`/`queryFirst` helpers already imported in `records.ts`. The request body gains one new optional field: `call_id?: number`.

**a. Current call (write).** If `call_id` is present: `INSERT OR IGNORE INTO call_persons (call_id, person_id, person_type, added_at) VALUES (?, ?, 'subject', datetime('now'))` — mirrors the existing ALPR `call_vehicles` auto-link pattern for scanned vehicles.

**b. Current call's case (write).** If `call_id` is present, look up `SELECT case_id FROM case_calls WHERE call_id = ?`. If found: `INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship) VALUES (?, ?, 'linked')`. (`case_person_links` is the FK-enforced junction table with a `UNIQUE(case_id, person_id)` constraint — the correct one to write to, per the existing dual-table situation with `case_persons`, which is left untouched.)

**c. Warrants — backfill orphans (write).** `UPDATE warrants SET subject_person_id = ? WHERE subject_person_id IS NULL AND LOWER(status) = 'active' AND LOWER(subject_first_name) = LOWER(?) AND LOWER(subject_last_name) = LOWER(?) AND subject_dob = ?` — only runs when the scan has a non-empty first/last name and normalized DOB.

**d. Warrants — surface hits (read).** `SELECT id, warrant_number, warrant_type, offense_description, bond_amount, issuing_agency FROM warrants WHERE subject_person_id = ? AND LOWER(status) = 'active'`. Returned in the response as `warrant_hits: Array<{...}>` — always run (covers warrants already linked before this scan, not just ones just backfilled).

**e. Prior calls / open cases — surface only (read).** Reuse the existing query pattern at `records.ts:784` (`SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 10`) and an analogous one against `case_person_links` joined to `cases`. Returned as `prior_calls`/`open_cases` in the response — informational only, never written.

### 4. Response shape

`POST /records/from-dl-scan` response gains: `dlRecordId: number`, `dlRecordCreated: boolean`, `warrant_hits: WarrantHit[]`, `prior_calls: CallSummary[]`, `open_cases: CaseSummary[]`. Existing fields (`personId`, `personCreated`, vehicle/property fields) are unchanged.

### 5. Client changes

- `client/src/utils/scanIdToRecipient.ts` — extend `aamvaToScanResultObj`'s `DlScanResultObj` to include the 10 newly-persisted fields (all already available on `AamvaResult`, just not currently mapped through).
- `client/src/pages/mobile/FieldCameraPage.tsx` — pass `call_id` (already in scope as a query param, already used for the ALPR path) into the `from-dl-scan` POST body. Extend the result overlay to render `warrant_hits` as red alert banners (same visual treatment as the existing `assessAamva` danger-level alerts) and `prior_calls`/`open_cases` as a compact informational list.
- `ServeIntakePage.tsx` — no `call_id` concept exists on this page; it continues to only use `aamvaToServeOverrides` for local form-fill, untouched by the linking work (linking is specific to the `from-dl-scan`/FieldCameraPage flow, not the intake-form-prefill flow).

### 6. Error handling

Every linking step (b–e) is best-effort: wrapped so a failure in one (e.g. a missing `case_calls` row, a warrant query error) does not fail the overall scan or block person/dl_records creation — consistent with the existing fire-and-forget `screenPersonForSor` pattern at `records.ts:344-347`, except these are synchronous (not `waitUntil`) since the officer needs `warrant_hits` in the immediate response, not a deferred notification. A failure in one linking step is caught individually and the field is simply omitted/empty in the response, not surfaced as a top-level error.

### 7. Testing

- `tests/` (Worker/Node suite): new test file covering `POST /records/from-dl-scan` — full-field persistence to `persons_ext`, `dl_records` upsert (new + existing record), call/case auto-link with and without `call_id`, warrant backfill (orphan match, no-match, already-linked), warrant hit surfacing, prior-calls/open-cases surfacing, and the best-effort error isolation (a warrants-table failure doesn't block the person/dl_records write).
- `client/src/utils/__tests__/scanIdToRecipient.test.ts`: extend existing tests for the newly-mapped fields.
- No new client component tests required beyond FieldCameraPage's existing coverage pattern — the result-overlay rendering is additive JSX, same shape as the existing alert rendering.

## Migration/rollout

- Migration `0211_persons_ext_full_aamva_fields.sql`, idempotent (`ALTER TABLE persons_ext ADD COLUMN` — D1 doesn't support `IF NOT EXISTS` on ADD COLUMN per `migrations/README.md`, so re-apply failure is expected/accepted, same as every other migration in this repo).
- Apply directly to live D1 (`785de7ae`) via `scripts/apply-migration.sh` after merge, per CLAUDE.md's standard schema-change checklist. Verify via `pragma_table_info('persons_ext')`.
