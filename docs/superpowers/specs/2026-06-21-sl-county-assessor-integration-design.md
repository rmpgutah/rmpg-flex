# Salt Lake County Assessor Integration — Records Cross-Reference

**Status:** Design approved 2026-06-21 — implementation plan pending.
**Scope:** When an address is entered (or already present) on a Business or Property
record, cross-reference the Salt Lake County Assessor parcel database and pull every
field the Assessor publishes. Auto-fill the matching form fields, store the full
parcel record verbatim, and provide a one-click backfill for existing records.

---

## Goals

1. **Live auto-fill on data entry** — operator types an address on a Business or
   Property record, blurs the field, and within ~1–3 s a suggestion panel renders
   below the address with the matched Salt Lake County parcel(s). One click applies
   the parcel to the form, populating empty fields only (never overwriting
   user-typed values).
2. **Backfill existing records** — admin/manager presses one button on
   `/records` and every Business and Property row missing a `parcel_number`
   gets queued, looked up, and either auto-applied (1 match) or routed to a
   review queue (>1 match).
3. **Capture all the data** — the focused subset (~13 fields) lives on
   `businesses` and `properties` for query/filter; the full Assessor record
   (every flat field + sale history) lives in `parcel_records` + `parcel_sales`.
4. **Never silently lie** — owner-of-record is captured verbatim regardless of
   individual / entity / mixed shape; we never clobber a field the user already
   typed; ambiguous matches are never auto-picked.

## Non-goals

- Other county assessors (Davis, Utah, Weber, etc.). The
  `parcel_records.source` column and dedicated `sl-assessor` utility namespace
  leave room for them later, but they are out of scope for this spec.
- Bulk nightly mirror of the Assessor database. On-demand + 30-day cache only.
- Owner ↔ Person record linking (matching `owner_of_record` to an existing
  `persons` row). Future work.
- Tax-bill / payment data. Assessor only.

---

## Architecture

### File layout (new)

```
src/utils/sl-assessor/
  client.ts      Worker-safe; searchByAddress(addr) → ParcelSummary[];
                 getParcel(parcel_no) → Parcel; Firecrawl-backed.
                 Typed errors: AssessorConfigError | AssessorHttpError |
                                AssessorParseError | AssessorTimeoutError.
  parser.ts      Pure HTML/markdown → ParcelSummary[] | Parcel.
                 Unit-tested via captured-HTML fixtures.
  cache.ts       KV wrapper. 30-day TTL.
                 Key: assessor:parcels:<normalizeAddress(addr)>
                 Key: assessor:parcel:<parcel_no>
  autofill.ts    Pure applyParcelToRecord(record, parcel) → { patch, skipped[] }.
                 Implements the never-clobber rule. Unit-tested.
  types.ts       Parcel, ParcelSummary, ParcelSale.

src/routes/assessor.ts
  GET  /api/assessor/parcels?address=<...>
       → { parcels: ParcelSummary[], cached: bool, source_url }
  GET  /api/assessor/parcel/:parcel_no
       → { parcel: Parcel, sales: ParcelSale[], cached: bool, source_url }
  POST /api/assessor/apply
       Body: { record_type: 'business'|'property', record_id, parcel_number }
       → Resolves the parcel, runs applyParcelToRecord(), persists.
  POST /api/assessor/backfill
       Body: { dryRun?: bool, limit?: number }
       → Enqueues pending rows into assessor_backfill_jobs, returns counts.
       → Handler additionally requires role IN ('admin','manager').
  GET  /api/assessor/backfill/status
       → { pending, applied, ambiguous, no_match, error, total }
  GET  /api/assessor/review-queue
       → Ambiguous jobs with stored ParcelSummary[] for picker.
       → Handler additionally requires role IN ('admin','manager').
  Mounted in src/routesConfig.ts at /api/assessor with auth: 'required'
  (every endpoint requires a valid JWT; per-endpoint role checks are inline).
  Parcel-number path param is URL-decoded by Hono — dashes/dots are preserved
  (e.g. /api/assessor/parcel/16-04-301-005).

migrations/0134_assessor_integration.sql   (idempotent — see Schema section)

client/src/hooks/useAssessorLookup.ts
  Debounced on-blur lookup. Returns
  { parcels, cached, sourceUrl, loading, error, dismiss(), refetch() }.

client/src/components/AssessorSuggestionPanel.tsx
  Renders 0 / 1 / N parcel states. Emits onApply(parcel_number).

client/src/components/AssessorReviewQueueBanner.tsx
  Shown on /records when ambiguous count > 0.

Touch points:
  client/src/pages/records/BusinessTab.tsx       wire panel under address input
  client/src/pages/records/PropertiesTab.tsx     wire panel under address input
  src/routes/records.ts (businesses CRUD)        accept new columns in PATCH/POST
  src/routes/properties.ts                       accept new columns in PATCH/POST
  src/utils/db.ts (boot reconciler)              append the 13×2 columns to the
                                                 missing-column reconciliation list
  wrangler.toml                                  unchanged — existing cron
                                                 `* * * * *` already runs; we
                                                 just add a new dispatch under
                                                 the existing scheduled() handler
                                                 that runs every other minute
  client/public/sw.js                            bump CACHE_NAME

Tests:
  tests/sl-assessor.parser.test.ts
  tests/sl-assessor.cache.test.ts
  tests/sl-assessor.client.test.ts
  tests/sl-assessor.autofill.test.ts
  tests/sl-assessor.backfill.test.ts
  client/src/components/AssessorSuggestionPanel.test.tsx
```

### Unit boundaries

| Unit | Purpose | Depends on | Exposes |
|---|---|---|---|
| `parser.ts` | HTML/markdown → typed Parcel | — (pure) | `parseParcelList(html)`, `parseParcelDetail(html)` |
| `client.ts` | Network fetch + parse + typed errors | `parser`, Firecrawl util | `searchByAddress`, `getParcel` |
| `cache.ts` | KV-backed memoization | `KV` binding | `getCached`, `putCached`, `normalizeAddress` |
| `autofill.ts` | Never-clobber field merge | — (pure) | `applyParcelToRecord(record, parcel)` |
| Route `assessor.ts` | HTTP surface | client, cache, autofill, D1 | endpoints above |
| Backfill processor | Paced queue worker | route + cron | `processBackfillTick(env)` |
| `useAssessorLookup` | Client-side blur + state | `apiFetch` | hook |
| `AssessorSuggestionPanel` | UI | hook | onApply event |

Each can be reasoned about in isolation; each has its own tests; each can be
swapped (e.g. Firecrawl → direct fetch) without breaking consumers.

---

## Data flow

### Auto-fill on new entry

```
User types address → blur
  → useAssessorLookup runs (only if address has at least one digit + non-empty)
  → GET /api/assessor/parcels?address=...
    → Worker: normalizeAddress() → KV cache lookup
       hit (30d fresh)  → return cached ParcelSummary[]
       miss             → Firecrawl scrape query.cfm with the normalized address
                        → parser.parseParcelList(html)
                        → write KV cache, return
  → Client renders <AssessorSuggestionPanel>
    0 parcels       → no UI
    1 parcel        → pre-selected, [Apply] / [Dismiss]
    N parcels       → radio list picker, [Apply] disabled until pick
  → User clicks Apply
  → GET /api/assessor/parcel/:parcel_no (full record + sales)
  → autofill.applyParcelToRecord(form, parcel)
       returns { patch, skipped }
       patch is merged into form's pending state (never overwrites non-empty)
       skipped count rendered: "3 fields applied · 1 skipped (already filled)"
  → User saves
  → PATCH /api/records/businesses/:id OR /api/records/properties/:id
       writes the column subset
       upserts parcel_records (UNIQUE parcel_number)
       replaces parcel_sales rows
       audit log via recordAudit('ASSESSOR_APPLIED', ...)
```

### Backfill

```
Admin clicks [Backfill from SL Assessor]
  → POST /api/assessor/backfill
  → INSERT OR IGNORE into assessor_backfill_jobs for every:
      businesses WHERE archived_at IS NULL AND address NOT NULL AND parcel_number IS NULL
      properties WHERE address NOT NULL AND parcel_number IS NULL
    (UNIQUE(record_type, record_id) makes it idempotent)
  → Returns { queued, already_pending, total_target }
  → UI shows "Queued 412 records — running in background"

Cron */2 * * * *  → processBackfillTick(env)
  → Picks up to 1 row WHERE status='pending' AND retry_count < 3
  → Same searchByAddress() path as the form
  → 0 matches  → status='no_match'; assessor_last_synced_at set
  → 1 match    → autofill.applyParcelToRecord + persist + parcel_records upsert
                 → status='applied'; recordAudit('ASSESSOR_BACKFILL_APPLIED', ...)
  → N matches  → matches_json = ParcelSummary[]; status='ambiguous'
  → error      → retry_count++; if >=3, status='error', error_message stored
  → Paced ≤30 lookups/min (KV-tracked counter) to be Firecrawl- + Assessor-polite

Client polls GET /api/assessor/backfill/status every 5s while banner is visible
  → Banner: "Assessor backfill: 287/412 done · 18 need review"
  → On finish: "18 records need review →" link to review queue

Review queue (/records, admin/manager only)
  → GET /api/assessor/review-queue
  → For each ambiguous row, click [Pick parcel] opens the SAME
    <AssessorSuggestionPanel> (matches_json hydrates it)
  → Pick + Apply → POST /api/assessor/apply → row marked 'applied'
```

### Behavioral rules

| Situation | Behavior |
|---|---|
| Address blank, or no digit (e.g. `"Main St"`) | Silent — no lookup runs |
| 0 Assessor results | Silent — no panel shown |
| 1 result | Panel pre-selects, `[Apply]` enabled |
| N results | Picker, `[Apply]` disabled until pick |
| Firecrawl 503 / network error | Non-blocking toast; manual 🔍 button remains |
| Parser error (assessor HTML changed) | Logged + structured error; toast same |
| User edits address again | Panel re-fires on next blur; previous suggestion replaced |
| Auto-fill collision (user already typed) | Field stays user's value; `skipped` counter shown |
| Cache TTL | 30 days, KV |
| Re-lookup of an applied record | `Re-fetch from Assessor ↻` on detail panel bypasses cache |
| Owner-of-record | Stored verbatim; `owner_type` inferred (LLC/INC/CORP/TRUST/LP/LLP → `entity`, else `individual`; comma-separated mix of name + entity → `mixed`; blank → `unknown`) |
| `businesses.owner_name` vs `owner_of_record` | Separate columns — `owner_name` is the business proprietor (user-entered), `owner_of_record` is the parcel's legal owner from the Assessor. Auto-fill never touches `owner_name`. |
| Strip-mall / multi-tenant | Multiple businesses may share one `parcel_number`. Parcel-records upsert is on `UNIQUE(parcel_number)`; no FK on businesses.parcel_number. |
| Backfill row re-enqueue | `INSERT OR IGNORE` via `UNIQUE(record_type, record_id)` |
| Backfill rate cap | 30 lookups/min, KV-counter window |
| Backfill auth | Bulk endpoint = `admin` or `manager`; per-record button = any authed user |

---

## Schema (`migrations/0134_assessor_integration.sql`)

Idempotent — see CLAUDE.md rule #5; Worker boot reconciler in
[`src/utils/db.ts`](../../src/utils/db.ts) covers any column that didn't land via
`wrangler d1 migrations apply` (deploy is `continue-on-error`). After merge:
**apply this migration directly to live D1 `785de7ae`** and verify each new
column via `pragma_table_info`.

```sql
-- ── Focused subset on businesses (auto-fillable, queryable) ──
ALTER TABLE businesses ADD COLUMN parcel_number TEXT;
ALTER TABLE businesses ADD COLUMN owner_of_record TEXT;
ALTER TABLE businesses ADD COLUMN owner_type TEXT;          -- individual|entity|mixed|unknown
ALTER TABLE businesses ADD COLUMN owner_mailing_address TEXT;
ALTER TABLE businesses ADD COLUMN year_built INTEGER;
ALTER TABLE businesses ADD COLUMN total_market_value INTEGER;
ALTER TABLE businesses ADD COLUMN land_sqft INTEGER;
ALTER TABLE businesses ADD COLUMN last_sale_date TEXT;
ALTER TABLE businesses ADD COLUMN last_sale_price INTEGER;
ALTER TABLE businesses ADD COLUMN legal_description TEXT;
ALTER TABLE businesses ADD COLUMN tax_district TEXT;
ALTER TABLE businesses ADD COLUMN assessor_last_synced_at TEXT;
ALTER TABLE businesses ADD COLUMN assessor_source_url TEXT;

-- ── Same subset on properties ──
ALTER TABLE properties ADD COLUMN parcel_number TEXT;
ALTER TABLE properties ADD COLUMN owner_of_record TEXT;
ALTER TABLE properties ADD COLUMN owner_type TEXT;
ALTER TABLE properties ADD COLUMN owner_mailing_address TEXT;
ALTER TABLE properties ADD COLUMN year_built INTEGER;
ALTER TABLE properties ADD COLUMN total_market_value INTEGER;
ALTER TABLE properties ADD COLUMN land_sqft INTEGER;
ALTER TABLE properties ADD COLUMN last_sale_date TEXT;
ALTER TABLE properties ADD COLUMN last_sale_price INTEGER;
ALTER TABLE properties ADD COLUMN legal_description TEXT;
ALTER TABLE properties ADD COLUMN tax_district TEXT;
ALTER TABLE properties ADD COLUMN assessor_last_synced_at TEXT;
ALTER TABLE properties ADD COLUMN assessor_source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_businesses_parcel ON businesses(parcel_number);
CREATE INDEX IF NOT EXISTS idx_properties_parcel ON properties(parcel_number);

-- ── Full verbatim parcel records ──
CREATE TABLE IF NOT EXISTS parcel_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_number TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'sl_county_assessor',
  source_url TEXT,
  account_number TEXT,
  serial_number TEXT,
  tax_district TEXT,
  owner_of_record TEXT,
  owner_type TEXT,
  owner_mailing_address TEXT,
  situs_address TEXT,
  situs_city TEXT,
  situs_zip TEXT,
  subdivision TEXT,
  land_acres REAL,
  land_sqft INTEGER,
  land_value INTEGER,
  zoning TEXT,
  year_built INTEGER,
  effective_year_built INTEGER,
  total_bldg_sqft INTEGER,
  finished_sqft INTEGER,
  basement_sqft INTEGER,
  garage_sqft INTEGER,
  stories REAL,
  bedrooms INTEGER,
  bathrooms REAL,
  construction_type TEXT,
  improvement_class TEXT,
  improvement_value INTEGER,
  market_value_total INTEGER,
  market_value_land INTEGER,
  market_value_improvement INTEGER,
  taxable_value INTEGER,
  assessed_value INTEGER,
  tax_year INTEGER,
  legal_description TEXT,
  plat TEXT,
  lot TEXT,
  block TEXT,
  raw_data_json TEXT,                  -- every field we parsed, verbatim, for forward-compat
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parcel_records_situs ON parcel_records(situs_address);
CREATE INDEX IF NOT EXISTS idx_parcel_records_owner ON parcel_records(owner_of_record);

-- ── 1:N sale history ──
CREATE TABLE IF NOT EXISTS parcel_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_record_id INTEGER NOT NULL,
  sale_date TEXT,
  sale_price INTEGER,
  doc_number TEXT,
  buyer TEXT,
  seller TEXT,
  sale_type TEXT,
  FOREIGN KEY (parcel_record_id) REFERENCES parcel_records(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_parcel_sales_record ON parcel_sales(parcel_record_id);

-- ── Backfill job queue (resumable, audit trail) ──
CREATE TABLE IF NOT EXISTS assessor_backfill_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK(record_type IN ('business','property')),
  record_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','applied','no_match','ambiguous','unfetchable','error')),
  matches_json TEXT,
  applied_parcel_number TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(record_type, record_id)
);
CREATE INDEX IF NOT EXISTS idx_backfill_pending
  ON assessor_backfill_jobs(status, retry_count) WHERE status = 'pending';
```

### Column budgets

| Table | Before | After | D1 cap | Headroom |
|---|---|---|---|---|
| `businesses` | 25 | 38 | 100 | 62 |
| `properties` | 13 | 26 | 100 | 74 |
| `parcel_records` | — | 45 | 100 | 55 |

Well under the 100-column cap; neither table is in CLAUDE.md's "do not ALTER"
list (those are `calls_for_service` and `persons`).

---

## Error handling

| Layer | Failure | Behavior |
|---|---|---|
| Firecrawl | Secret unset | `/api/assessor/*` returns `503 { code: 'not_configured' }`. Form skips lookup silently. |
| Firecrawl | Timeout / 5xx | Typed `AssessorHttpError` / `AssessorTimeoutError`; route returns 503; client toast non-blocking; backfill row left `pending` (next tick retries, max 3). |
| Parser | Assessor HTML shape changed | Typed `AssessorParseError`; logged with raw HTML excerpt; route returns 500; backfill row → `error` after 3 retries. Previously-saved parcel data untouched. |
| KV | Cache miss | Normal — cold path. |
| Auto-fill | User already had field populated | Skipped; tally exposed in panel: `"3 fields applied · 1 skipped (already filled)"`. |
| Auto-fill | Assessor returns blank for a field | That field skipped; others applied. |
| Backfill | Address has no digit / blank | `status = 'unfetchable'`; not retried. |
| Backfill | Re-press button | `INSERT OR IGNORE` via `UNIQUE(record_type, record_id)`. |
| Audit | Every applied row | `recordAudit('ASSESSOR_APPLIED' \| 'ASSESSOR_BACKFILL_APPLIED', { record_type, record_id, parcel_number, fields_set })`. |

---

## Testing

Pure helpers + parser are unit-testable without D1 or network — same pattern as
[`tests/roboflowAlpr.test.ts`](../../tests/roboflowAlpr.test.ts) and
[`tests/dar.test.ts`](../../tests/dar.test.ts). No new test infrastructure
needed; runs under existing vitest.

```
tests/sl-assessor.parser.test.ts
  · single hit, multi hit, no hit
  · mixed-owner row (individual + entity)
  · entity-only (LLC, INC, CORP, TRUST, LP, LLP)
  · trust ("JOHN DOE FAMILY TRUST")
  · blank-valuation row
  · weirdly-spaced owner field
  · sale history with 0 / 1 / 5 rows
  · raw_data_json captures every parsed field verbatim

tests/sl-assessor.cache.test.ts
  · normalizeAddress() equivalence classes:
      "2200 S 500 E" ≡ "2200 S 500 e" ≡ "2200 South 500 East"
  · 30-day TTL boundary

tests/sl-assessor.client.test.ts
  · Firecrawl mocked: success, timeout, 5xx, retry budget
  · Typed errors propagate as expected

tests/sl-assessor.autofill.test.ts
  · applyParcelToRecord() never-clobber rule
  · skipped[] is populated correctly
  · owner_type inference (LLC|INC|CORP|TRUST|LP|LLP → entity)
  · mixed-name detection (individual + entity in one string)

tests/sl-assessor.backfill.test.ts
  · processBackfillTick: pending → applied / ambiguous / no_match / error
  · re-enqueue idempotent
  · retry_count cap

client/src/components/AssessorSuggestionPanel.test.tsx
  · 0 / 1 / N parcel render states
  · pick + apply emits expected onApply payload
  · dismiss closes panel, doesn't write
```

CI: the new tests under `tests/` are not currently wired into a Worker test
step (per CLAUDE.md, the only Worker-side CI gate today is typecheck). We will
add a `vitest run tests/` step under `.github/workflows/pr-tests.yml` as part
of this PR, so the parser/client/autofill/backfill tests gate every PR.

---

## Wrangler / secrets

- Reuses `FIRECRAWL_API_KEY` (already in prod per memory).
- Reuses `KV` binding (`8e01c39...`).
- No new cron lines in `wrangler.toml` — the existing `* * * * *` is reused.
  The backfill processor is invoked from inside the existing `scheduled()`
  handler in [`src/index.ts`](../../src/index.ts) and gated to run every other
  tick (`epoch_minute % 2 === 0`), giving it a ~2-min cadence without adding
  a second cron. (CLAUDE.md / memory: [[project-per-minute-cron-essential]].)
- Service worker bump: `client/public/sw.js` `CACHE_NAME` → next version.

## Deploy / rollout

1. Branch → PR (per [[feedback-use-pr-flow-not-direct-push]]).
2. PR includes: migration, route, utils, client hook+component, BusinessTab +
   PropertiesTab wiring, tests, sw bump.
3. CI gates: worker typecheck, client typecheck, client vitest, client build,
   new tests/ vitest step, column-cap check.
4. Merge → `deploy.yml` deploys Worker + Pages.
5. Apply `0134_assessor_integration.sql` **directly to live D1 `785de7ae`** and
   verify each new column via `pragma_table_info` (per CLAUDE.md rule #5).
6. Confirm `/api/health` returns 200 (WAF skip rule allows curl on that path).
7. Browser-verify: open a Business form, type a real Salt Lake County address,
   confirm the suggestion panel renders with at least one parcel, click Apply,
   save, reload, confirm fields persisted.
8. Press **Backfill from SL Assessor** in a small dry-run mode first
   (`limit: 10`) to validate parser against real records, then full run.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Assessor site changes HTML / breaks parser | Captured-HTML fixtures in `tests/` catch regressions; structured error logging surfaces real-world break; backfill rows fail gracefully into `error` status with raw excerpt; manual `Re-fetch` button per record. |
| Assessor adds bot protection (cf. Colorado DOC) | Firecrawl handles most JS / mild bot protection (proven via iCrimeWatch). If hard CAPTCHA appears, route returns 503; UI degrades to manual entry; no silent failure. |
| Rate-limited by Salt Lake County | 30-day KV cache + 30/min backfill cap; per-record `Re-fetch` already requires user action. |
| User pastes a non–Salt Lake County address | Lookup returns 0 results, UI silent. No data corruption possible — we only apply matched parcels. |
| Wrong parcel auto-applied | Ambiguous matches NEVER auto-pick (>1 = picker UI for entry, `ambiguous` queue for backfill). Single-match has the right parcel by definition of Assessor returning 1 row for the address. |
| Existing record had stale owner | `owner_of_record` (parcel legal owner) and `owner_name` (business proprietor) are separate columns — neither overwrites the other. |
| Migration partially applies on prod (the documented `continue-on-error` hazard) | Idempotent ALTERs + boot reconciler in `db.ts`; direct application to live D1 with `pragma_table_info` verification (CLAUDE.md rule #5). |
| Backfill spike on first run | Cron paced 1/2s, KV-tracked rate cap, banner gives operator visibility, can be paused by clearing pending rows. |
| Service worker serves stale chunks | `CACHE_NAME` bump in `client/public/sw.js`. |

---

## Open follow-ups (out of scope for this PR)

- Davis / Utah / Weber county assessors (would reuse `parcel_records` with
  different `source`).
- Owner ↔ Person record linking (auto-suggest if `owner_of_record` matches a
  `persons` row).
- Display parcel ownership history on the records detail page.
- Push parcel metadata into the `flex_events` analytics stream
  ([[project-r2-data-catalog-analytics]]) so warehouse queries can join.
