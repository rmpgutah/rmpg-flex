# Utah DOC + iCrimeWatch SOR integrations — design

**Date:** 2026-06-15
**Status:** Approved design → implementation planning
**Author:** Claude (brainstorming session with operator-owner)

## Goal

Add two external offender data sources to RMPG Flex screening, each usable
**both** on-demand (officer runs a name/person → live result) **and** as a
background ingest (scheduled refresh into local tables so screening/DL-scan
sweeps hit instantly and offline):

1. **Utah DOC** — current-supervision custody/parole status
   (`corrections.utah.gov` offender search).
2. **iCrimeWatch / OffenderWatch agency 54438** — the *statewide* Utah Sex,
   Kidnap & Child-Abuse Offender Registry (`icrimewatch.net`).

Both plug into existing frameworks rather than introducing new ones.

## Recon findings (grounded 2026-06-15 via headless browser)

The two sources are **asymmetric** — this drives the whole design.

### Utah DOC — clean public REST API
- Real endpoints (the page's reCAPTCHA v3 is **frontend-only friction**; the
  gateway itself is open):
  - List by name: `GET https://api.utah.gov/udc/v1/public/rest/offenders/name?first={f}&last={l}&index=0&pageCount=100`
  - Detail: `GET https://api.utah.gov/udc/v1/public/rest/offenders/{offenderNumber}`
- **No auth, no captcha** at the API layer. Verified HTTP 200 JSON from a
  datacenter context → **directly Worker-`fetch()`-able**.
- List response: `{ startIndex, pageCount, totalCount, maxCount, results: [{ offenderNumber, offenderName, dateOfBirth }] }`
- Detail response: `{ results: { offenderNumber, offenderName, dateOfBirth, location, housingFacility, releaseDateAndType, caseManagerName, caseManagerEmail } }`
- Coverage caveat: **only people currently under UDC supervision** (incarcerated,
  parole, probation). Pre-trial / county-jail subjects are excluded.
- There is **no bulk-list endpoint** — you can only query by name. So the
  background mode is *per-watched-person refresh*, not a full dump.

### iCrimeWatch — DataDome-protected HTML scrape
- AgencyID `54438` = **"Utah Sex Kidnap and Child Abuse Offender Registry"**
  (statewide), served by Watch Systems / OffenderWatch.
- Detail page: `https://www.icrimewatch.net/offenderdetails.php?OfndrID={id}&AgencyID=54438`
- Search: `https://www.icrimewatch.net/results.php?SubmitAllSearch=1&AgencyID=54438`
  (last-name / zip / "search all" paging).
- **Anti-bot: DataDome.** A first hit 302s to a disclaimer gate on
  `sheriffalerts.com/cap_office_disclaimer.php?office=54438&fwd={base64 target}`.
  After agreeing, the browser holds three cookies:
  - `accepted_license=NTQ0Mzg%3D` — base64("54438"), the disclaimer flag (trivial to forge)
  - `PHPSESSID=…` — normal session
  - `datadome=…` — issued only after passing DataDome's JS challenge
- A plain Worker `fetch()` (datacenter IP, no JS) **403s** — confirmed. Reliable
  scraping requires a real browser / anti-bot bypass layer (see Decision 1).
- Detail page fields (verbatim labels): `Name:`, `Registration #:` (= OfndrID),
  `Aliases:`, `Status:`, `• Age:` (with `DOB:`), `• Height:`, `• Sex:`,
  `• Weight:`, `• Race:`, `• Eyes:`, `• Hair:`, `• Scars/Tattoos:`,
  `• Description:`, address block, offenses (`• Description:` = statute + degree,
  `• Date Convicted:`, `• Conviction State:`, `• Release Date:`, `• Counts:`),
  "Other Known Addresses" + "Vehicles" tabs, photo at
  `https://docs.watchsystems.com/offices/54438/{office}-{n}.jpg`.

## Decisions made during brainstorming

- **Usage model:** Both (on-demand + background ingest) for each source.
- **iCrimeWatch posture:** Scrape aggressively. SOR data is public by law
  (Utah Code §53-29-404); the operator is a licensed LE/security agency. The
  Watch Systems ToS forbids systematic harvesting — recorded as a civil/vendor
  risk, not a blocker, per the operator's explicit decision.
- **Decision 1 — iCrimeWatch fetch layer: external scrape API (Firecrawl).**
  The Worker calls Firecrawl with a `FIRECRAWL_API_KEY` secret; Firecrawl's
  stealth-proxy + page-action support passes DataDome and the disclaimer gate
  and returns rendered HTML. Works on any Workers plan (no Browser Rendering /
  Workers-Paid dependency). The key is read from `c.env`; the SOR scan route
  returns 503 when it is unset (mirrors the `ROBOFLOW_API_KEY` pattern).

## Architecture

### Component 1 — Utah DOC custody source

A new screening adapter, no new framework.

- **`src/utils/screening/udcAdapter.ts`** — implements `ScreeningAdapter`:
  - `sourceKey: 'utah-doc'`, **new `kind: 'custody'`** (added to the `kind`
    union in `screening/types.ts`).
  - `supportsSearch: true`, `supportsWatch: true`.
  - `searchAdHoc(env, params)` → `GET api.utah.gov/.../offenders/name` by
    first/last → map `results[]` to `NormalizedCandidate`.
  - `fetchForPerson(env, person)` → same call using the person's name; this is
    what the background scan re-runs per watched person.
  - `scoreMatch` → reuse `scoring.ts` name matcher (name + DOB when present).
  - `normalize(raw)` → `NormalizedCandidate` (displayName, dob, summary =
    "UDC: {location} · {status}", raw = full detail JSON).
  - `confirmHit(env, hit)` → fetch the detail endpoint for the offenderNumber,
    upsert a `udc_custody` snapshot, and stamp custody status onto the person
    (and optionally raise an `offender_alert` of type `custody`/`parole`).
  - `coverage(env)` → live-API style: "covered" when `api.utah.gov` is
    reachable (no empty-table false-clear concern since it's not table-backed
    for search).
- **`udcAdapter` registered** in `src/utils/screening/registry.ts` `ADAPTERS[]`.
- **Migration `0121_udc_custody.sql`** — new table (use the next free integer
  prefix; live is past 0120, so confirm with `ls migrations/ | sort | tail`
  before naming):
  ```sql
  CREATE TABLE IF NOT EXISTS udc_custody (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offender_number INTEGER UNIQUE NOT NULL,
    offender_name TEXT,
    date_of_birth TEXT,
    location TEXT,
    housing_facility TEXT,
    release_date_and_type TEXT,
    case_manager_name TEXT,
    case_manager_email TEXT,
    person_id INTEGER,
    source TEXT DEFAULT 'UDC_API',
    last_seen_at TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
  Apply directly to live D1 `785de7ae` after merge (deploy migrate step is
  `continue-on-error`).
- **Background:** the existing `runScreeningScans` loop picks up `utah-doc`
  automatically because it iterates `getAdapters()`; the existing
  `screening_source_state` cadence (`scan_interval_days` / `next_run_at` /
  circuit-breaker) gates it. Custody *changes* (release dates) are the
  high-value signal, so a shorter default interval than the 180-day SOR
  default is appropriate for this source (set via the existing
  `POST /api/screening/sources/utah-doc/interval`).
- **On-demand:** flows through the existing `/api/screening` fan-out and
  `/api/screening/:type` single-source search — no new route needed for lookup.

### Component 2 — iCrimeWatch SOR source

A new scraper poller that fills the **existing** `utah_sex_offenders` table,
which the **existing** `utahSorAdapter` already reads (with its existing
`coverage()` false-clear guard). No change to the SOR adapter or its table
schema (`migrations/0096_utah_sex_offenders.sql`).

- **`src/utils/browserFetch.ts`** — thin Firecrawl client. `scrapeUrl(env, url,
  { actions?, waitFor? })`: POSTs to Firecrawl `/v2/scrape` with
  `proxy: 'stealth'`, optional page actions (check the disclaimer box + click
  Continue) and `formats: ['html']`; returns rendered HTML (or `markdown`).
  Returns a typed error when `FIRECRAWL_API_KEY` is unset so callers can 503.
  Bounded timeout + retries/backoff (mirror `roboflowAlpr.ts` resilience).
- **`src/utils/sorSources/icrimewatch.ts`** — the scraper:
  - `runIcrimewatchScan(env, { mode })` where `mode = 'incremental' | 'full' | 'name'`.
  - **Enumeration:** walk `results.php?SubmitAllSearch=1&AgencyID=54438` paged
    (and/or alphabetic last-name sweep) → collect `OfndrID`s → for each, scrape
    `offenderdetails.php?OfndrID={id}&AgencyID=54438` → parse labeled fields →
    build a row shaped like `utahSorPoller`'s `SorRow` → upsert into
    `utah_sex_offenders` via the **existing** `importSorRows`-style upsert
    (reuse / lift the upsert helper so there is one writer).
  - Politeness: per-page delay, max-records-per-run cap, incremental mode that
    stops once it hits a run of already-known unchanged `registry_id`s.
  - Logs each run to `utah_sor_runs` (existing table) with `source='ICRIMEWATCH'`.
  - Photo URL captured into `utah_sex_offenders.photo_url` (the
    `docs.watchsystems.com/offices/54438/...jpg` link).
- **Parser** `src/utils/sorSources/parseIcrimewatch.ts` — pure HTML→`SorRow`
  function (the labeled-field table is stable). Unit-tested against a saved
  fixture of the Camden Clark detail page (`tests/parseIcrimewatch.test.ts`).
- **Background:** add `runIcrimewatchScan` to the `0 */4 * * *` scheduled
  handler path **gated by its own cadence** (a full statewide scrape is heavy
  — default to a long interval / incremental, reusing the
  `screening_source_state`-style gate or a dedicated `system_config` next-run
  stamp). The existing `runUtahSorPoll` (authorized-feed path) stays as-is;
  iCrimeWatch is an additional writer to the same table.
- **On-demand:** `runIcrimewatchScan(env, { mode: 'name', last, first })` does a
  live `results.php` scrape for a single name as a fallback when the local
  table lacks the subject; the existing `utahSorAdapter.searchAdHoc` continues
  to serve instant local-table results first.

### Routes (admin triggers)

- `POST /api/sor-sources/icrimewatch/scan?mode=incremental|full` — role-gated
  (`SCAN_ROLES`), fire-and-forget via `waitUntil`; 503 when `FIRECRAWL_API_KEY`
  unset. Returns `{ configured, seen, upserted }`.
- Utah DOC needs **no** new trigger route — `POST /api/screening/scan?source=utah-doc`
  already exists (manual force) via the screening framework.
- `GET /api/sor-sources/runs` — recent `utah_sor_runs` rows (observability).

### Cron wiring

`wrangler.toml` crons are unchanged (`["0 */4 * * *", "* * * * *"]`). In the
`0 */4 * * *` branch of `scheduled()`:
- `runScreeningScans(env)` already runs → picks up the new `utah-doc` adapter.
- Add `runIcrimewatchScan(env, { mode: 'incremental' })` wrapped in `waitUntil`
  + cadence gate, alongside the existing `runUtahSorPoll`.

### Client (minimal)

- The screening / `OffenderRegistryPage` UI already renders adapter hits; a
  `custody` hit kind surfaces UDC status (location, housing, release date) with
  its own badge/label. SOR hits populate the existing registry views via
  `utah_sex_offenders`.
- One admin control: a "Run SOR import" button (calls the new scan route) on
  the screening/admin surface. Bump `client/public/sw.js` `CACHE_NAME`.

## Secrets / config

- `FIRECRAWL_API_KEY` — `wrangler secret put FIRECRAWL_API_KEY` (and `.dev.vars`
  for local). Unset → `/api/sor-sources` returns 503; everything else degrades
  to local-table reads.
- Optional `FIRECRAWL_API_URL` override (defaults to Firecrawl prod base).
- No secret needed for Utah DOC (open public API).

## Error handling & resilience

- Both sources isolated: a failing source never breaks the screening fan-out
  (existing `Promise.all` + per-adapter try/catch).
- Firecrawl/DataDome failures: bounded retries + backoff; on persistent
  failure, log to `utah_sor_runs` with `status='error'`, leave the local table
  intact, and let `utahSorAdapter.coverage()` keep reporting accurately so a
  stale/empty table never reads as a "clear."
- UDC API: timeouts via `AbortController`; per-person scan failures are
  swallowed per-row (existing scan loop pattern).
- D1 writes are idempotent upserts keyed by `offender_number` / `registry_id`.

## Testing

- `tests/parseIcrimewatch.test.ts` — pure parser against a saved detail-page
  fixture (verifies name, reg#, DOB, address, offense statute, photo URL).
- `tests/udcAdapter.test.ts` — `normalize` + `scoreMatch` against captured
  `api.utah.gov` JSON fixtures (list + detail).
- Worker typecheck + existing CI gates. (No Miniflare suite yet — matches repo
  status.)

## Phasing (two PRs)

- **Phase 1 — Utah DOC.** No new infra, no third-party dependency, ships fast.
  `udcAdapter` + `udc_custody` migration + registry registration + tests +
  client custody badge. Delivers value immediately.
- **Phase 2 — iCrimeWatch SOR.** `browserFetch.ts` (Firecrawl) +
  `icrimewatch.ts` scraper + parser + `/api/sor-sources` route + cron wiring +
  `FIRECRAWL_API_KEY` + admin button + parser tests.

## Risks / open items

- **Watch Systems ToS** prohibits systematic harvesting (civil/vendor risk).
  Documented; proceeding per operator decision. Mitigate with polite rate +
  incremental scans.
- **DataDome may still block** even via Firecrawl stealth on some runs —
  treat the SOR feed as best-effort; coverage guard prevents false clears.
- **Statewide SOR volume** unknown until first full scan — cap records/run and
  prefer incremental; surface dropped/aborted counts in `utah_sor_runs`
  (no silent truncation).
- **UDC coverage gap** (no pre-trial / county-jail) is inherent to the source —
  the custody badge labels it "UDC supervision only."
- iCrimeWatch detail markup could change — the parser is fixture-tested and
  shape-tolerant; a parse miss logs an error rather than writing garbage.
