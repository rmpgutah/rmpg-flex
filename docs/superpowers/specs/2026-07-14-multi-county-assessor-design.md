# Multi-County Assessor Integration — Design

Date: 2026-07-14
Status: approved
Builds on: PR #1542 (Salt Lake County Assessor integration, live)

## Goal

Extend the existing Salt Lake County Assessor auto-fill system (`src/utils/sl-assessor/`,
`src/routes/assessor.ts`, `parcel_records`/`parcel_sales`/`assessor_backfill_jobs`) to cover
Utah County and Summit County with the same full field set, and Tooele County with a
narrower recorder-only field set. Davis County is explicitly OUT of scope for this plan —
its property search is a JS map SPA, not scrapeable HTML, and needs a separate spike to find
a real data source (likely a hidden ArcGIS FeatureServer) before a parser can be designed.

## Site recon (grounded 2026-07-14 via live browser + curl)

| County | Source URL | Backend | Scrape strategy |
|---|---|---|---|
| Salt Lake (existing) | `assessor.slco.org` (ColdFusion) | Form POST → redirect / Firecrawl for multi-result | Regex label-driven parser (existing) |
| Utah | `utahcounty.gov/LandRecords/AddressSearchForm.asp` | Classic ASP, same vintage as SL Co | Same regex label-driven parser approach |
| Summit | `property.summitcounty.org/eaglesoftware/taxweb/search.jsp` | Eagle Software TaxWeb (Java) | Same regex label-driven parser approach |
| Tooele | Recorder e-recording portal only (`erecording.tooeleco.gov/eaglesoftware/web/`) | Tyler/Eagle document index | Recorder-only fields; no assessed-value source exists at this endpoint |
| Davis (deferred) | `webportal.daviscountyutah.gov` "Property Search 2.0" | JS map SPA | Needs a spike to find the underlying JSON API |

## Architecture

Reuse the SL Co plumbing; add a routing layer + per-county client/parser pairs.

### 1. Shared types extraction

`src/utils/sl-assessor/types.ts` currently hardcodes `source: 'sl_county_assessor'` as a
string literal on the `Parcel` interface, and lives entirely under the `sl-assessor`
namespace. Extract a shared base to `src/utils/parcel-lookup/types.ts`:

```ts
export type ParcelSource =
  | 'sl_county_assessor'
  | 'utah_county_assessor'
  | 'summit_county_assessor'
  | 'tooele_county_recorder';

export interface ParcelBase { /* the ~35 shared fields, unchanged from today's Parcel */ }
export interface Parcel extends ParcelBase { source: ParcelSource; }
```

`src/utils/sl-assessor/types.ts` re-exports from the shared module for its existing 40+
call sites (no call-site churn). Each new county package (`utah-assessor/`,
`summit-assessor/`, `tooele-assessor/`) imports the shared `Parcel`/`ParcelSummary`/
`ParcelSale`/`AssessorError` hierarchy the same way.

### 2. County resolution

New `src/utils/parcel-lookup/router.ts`:

```ts
export type County = 'salt_lake' | 'utah' | 'summit' | 'tooele' | 'unsupported';
export function resolveCountyFromAddress(address: string): County;
```

Implementation: a hardcoded city→county lookup table (city names are a closed, small set —
Utah County's own address-search form enumerates all ~60 of its cities/districts; Summit
and Tooele are single-digit numbers of incorporated cities). ZIP-prefix fallback for
addresses that don't include a recognizable city token. Returns `'unsupported'` for
anything outside the four covered counties (including Davis) rather than guessing — the UI
falls back to "no assessor data available for this county" instead of silently returning
wrong data.

### 3. Per-county client + parser packages

Mirroring `sl-assessor/`'s shape exactly:

```
src/utils/utah-assessor/    { client.ts, parser.ts, cache.ts }
src/utils/summit-assessor/  { client.ts, parser.ts, cache.ts }
src/utils/tooele-assessor/  { client.ts, parser.ts, cache.ts }
```

Each `client.ts` exports the same two functions the router dispatches to:
```ts
searchByAddress(env: LookupEnv, address: string): Promise<ParcelSummary[]>
getParcel(env: LookupEnv, parcelNo: string): Promise<Parcel>
```
Each `parser.ts` follows the SL Co precedent: tolerant `pullByLabel(html, regex)` extraction
per field, every raw key/value pair also captured into `raw_data_json` for forward-compat,
no DOM library (Workers don't ship cheerio/jsdom). `cache.ts` reuses the exact
`normalizeAddress` + KV 30-day-TTL pattern from `sl-assessor/cache.ts` (duplicated per
package rather than shared, matching the existing SL Co precedent of keeping each county's
utils self-contained).

**Utah County parser specifics:** results come off `AddressSearchForm.asp` → a results
table (multi-match) or a single detail redirect. Primary key is the county's parcel
"Serial Number." Detail page is `PropertyForm.asp?serial_no=<n>`.

**Summit County parser specifics:** Eagle Software TaxWeb form/result HTML. Primary key is
account number. Detail page follows a `search.jsp?...` query-string pattern discovered at
implementation time (Eagle Software URL shapes are consistent across counties that use it,
useful precedent from the SL Co build).

**Tooele County — narrower field set.** No source exposes assessed value, year built, or
land square footage. `AUTOFILL_FIELDS` for this source is a **subset**:
`parcel_number, owner_of_record, owner_mailing_address, legal_description`, plus two new
non-autofill provenance-style fields captured directly into `parcel_records.raw_data_json`
and a new typed column pair (see schema below) for a recorder-document link-out.

### 4. Route dispatch

`src/routes/assessor.ts` stays as the single mounted surface at `/api/assessor` (no rename
— avoids churn across 49 `recordAudit` callers and the client hooks). Each handler resolves
county from the incoming `address` (for `/parcels`) or from the `parcel_records.source`
looked up by `parcel_number` (for `/parcel/:parcel_no` and `/apply`), then dispatches to the
matching package's `searchByAddress`/`getParcel`. `lookupParcelsWithFallback` /
`lookupParcelWithFallback` in `sl-assessor/lookup.ts` get a thin wrapper —
`parcel-lookup/lookup.ts` — that takes a `County` and picks the right client module before
running the existing fresh-cache → live-fetch → stale-cache fallback chain (that chain
logic itself is copied, not shared, matching the existing pattern of each county owning its
full stack).

`POST /backfill` (bulk enqueue) is unchanged — it doesn't care which county a record
belongs to, just that it has an address and no `parcel_number`. The backfill **worker**
(`processBackfillTick`, currently in `sl-assessor/backfill.ts`) needs one change: resolve
county from the record's address before calling into the right package, instead of always
calling SL Co's `getParcel`. That dispatch logic moves to a new
`src/utils/parcel-lookup/backfill.ts` that all four counties share; the per-county
`decideOutcome`/job-status logic is unchanged.

### 5. Schema changes

One new migration, additive only:

```sql
-- 0157_multi_county_parcel_fields.sql
ALTER TABLE parcel_records ADD COLUMN recorded_document_url TEXT;
ALTER TABLE parcel_records ADD COLUMN recorded_document_type TEXT;
```

No changes to `businesses`/`properties` — the 13 shared columns from migration 0142 already
cover every county's autofill targets (Tooele just leaves most of them null). The boot
reconciler `ensureAssessorColumns(db)` in `src/utils/db.ts` gets these two columns added to
its idempotent-ALTER list, same pattern as the existing 13.

`parcel_records.source` is already a free-text `TEXT NOT NULL` column (not an enum/CHECK
constraint) — no migration needed to accept the three new source values.

### 6. UI changes

- `AssessorSuggestionPanel` (`client/src/components/AssessorSuggestionPanel.tsx`): add a
  branch — when `parcel.source === 'tooele_county_recorder'`, render a "View recorded
  document" link (from `recorded_document_url`) instead of the value/year-built fields it
  currently always shows. The existing conditional-render-if-present pattern for
  optional fields already covers most of this; only the explicit link-out is new.
- `useAssessorLookup` hook: no change — it's already source-agnostic (passes through
  whatever `/parcels` returns).
- No new backfill/review-queue UI — those components already read `source` generically.

### 7. Testing

- New synthetic HTML fixtures: `tests/fixtures/utah-assessor/`, `tests/fixtures/summit-assessor/`,
  `tests/fixtures/tooele-assessor/` — following the SL Co precedent (README noting these are
  synthetic and how to swap in real captures later).
- Unit tests per parser (`tests/utahAssessor.test.ts`, `tests/summitAssessor.test.ts`,
  `tests/tooeleAssessor.test.ts`) mirroring the structure of the existing SL Co parser tests.
- `tests/parcelLookupRouter.test.ts` — county resolution table-driven tests (city → county,
  ZIP fallback, unsupported case for Davis/out-of-state).
- Extend `tests/roboflowAlpr.test.ts`-style autofill tests (actually the SL Co autofill
  tests file) to cover Tooele's narrower `AUTOFILL_FIELDS` subset and confirm never-clobber
  still holds.

## Explicitly out of scope

- Davis County parser/client (needs its own spike + spec once the data source is found).
- Any change to the `/api/assessor` route surface's URL shape or auth roles.
- Sharing `cache.ts`/`lookup.ts` logic across counties via a common module (kept
  per-county-duplicated, matching existing precedent — revisit only if a 5th county reveals
  real duplication pain).
- Real (non-synthetic) HTML captures for the three new counties — same caveat as SL Co's
  existing fixtures.
