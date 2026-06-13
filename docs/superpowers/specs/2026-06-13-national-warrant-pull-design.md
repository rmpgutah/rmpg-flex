# National Warrant Pull — Design Spec

- **Date**: 2026-06-13
- **Status**: Draft — pending user review
- **Author**: Claude (brainstormed with Christopher Zamora)
- **Subsystem**: `src/utils/warrantSources/*` (generalized), `src/routes/warrants.ts`, `client/src/pages/NationalWarrantSearchPage.tsx`
- **Migration**: `0107_national_warrant_pull` (next free prefix; 0106 = screening, on main)
- **Branch**: `claude/national-warrant-pull` (off origin/main)

## 1. Context & Motivation

The user asked to "rebuild, configure, design, and create a full-scale national warrant pull based off the Utah warrant poll rules." Two facts shape the build:

1. **There is no free, comprehensive national warrant API.** NCIC is CJIS-restricted (law-enforcement-only; private/third-party access is prohibited). Commercial "national" databases rely on voluntary county reporting (~38% of counties). A genuine national pull is therefore a **federation** of public sources: a federal fugitive layer + a per-jurisdiction (state/county/city) layer.
2. **The codebase is already ~80% scaffolded.** `src/utils/warrantSources/` is a mature multi-source adapter framework (`WarrantSourceAdapter` interface, registry, `runAllSourceScans` orchestrator, `scraped_warrants` store, `warrant_scraper_config` per-source state, `reconcile.ts` dedup, `chargeNormalize.ts`, confirmed-only promotion to canonical `warrants`). The `NationalWarrantSearchPage` is a complete UI shell whose backend endpoints (`/api/warrants/national-search`, `/national-coverage`) **do not exist**.

So "national warrant pull" = **generalize the existing framework to national scale + wire the orphaned UI**, applying the proven Utah poll rules uniformly. A 6-agent verified-discovery sweep produced the concrete source inventory in §4.

## 2. Goals / Non-Goals

### Goals
- Generalize `warrantSources/` so adding most sources is **a config row, not new code** (config-driven parser families).
- Support **full-list** sources (fetch the whole list once, match locally) in addition to the existing **per-person** sources.
- Add **PDF warrant-list parsing** (many sheriffs publish PDFs) and a **normalization layer** producing clean English-readable text.
- Background **pull engine** on the Utah rules (age-match, namesake guard, lifecycle, confirmed-only promotion, watch-log, circuit-breakers, cron).
- Wire the **national search + coverage** endpoints the `NationalWarrantSearchPage` already calls.
- Maximize verified public-source coverage; tag civil vs criminal; respect robots/ToS.

### Non-Goals
- NCIC / CJIS integration (legally unavailable to RMPG as a private entity).
- CAPTCHA-walled or ToS-forbidden sources (San Diego, Maricopa, AZ DPS, FDLE-fed FL, Allegheny PA, Douglas NE) — explicitly skipped.
- OpenSanctions aggregator (CC-BY-NC non-commercial) — out unless RMPG licenses it.
- Building all ~40 sources in one PR — phased (§12).

## 3. Locked Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Data sources | Federated **public** sources: State/County/City DBs in HTML + PDF + JSON, normalized to readable plain text |
| Coverage scope | **Maximize source count** (as many verified public sources as feasible), framework scales via config |
| Engine | **Both** background pull + on-demand national search/coverage UI |
| Civil warrants (NY tax/child-support) | **Opt-in** via a `kind` tag, off by default |
| OpenSanctions | **Out** (commercial license) |
| Model | The **Utah poll rules** applied uniformly across all adapters |

## 4. Verified Source Inventory (6-agent live-fetched sweep)

Every source below was verified by live fetch. Organized by **parser family** (the leverage: one parser → many sources).

### Config-driven families (a source = a config row)
- **Generic Socrata** (`{portal}/resource/{id}.json`, field-map): Baton Rouge LA `data.brla.gov/3j5u-jyar` (113K, criminal), Norfolk VA `data.norfolk.gov/cab7-wvn5`*, NYS Tax `data.ny.gov/v7ua-z23v` (432K, **civil**), NYS Child-Support `data.ny.gov/8pp4-isha` (72K, **civil**).
- **Generic ArcGIS FeatureServer** (`{layer}/query?...f=json`, field-map, epoch-ms dates, `resultOffset` paging): Arlington TX `gis2.arlingtontx.gov/.../MapServer/9`; (Newport News VA, Las Vegas-vendor — flaky, defer).
- **CentralSquare P2C legacy** (`{base}/wantedlist.aspx?LastName=A..Z`, server-side): Union NC, Fauquier VA, Warner Robins GA, +many.
- **CentralSquare P2C cloud** (`{agency}.policetocitizen.com/WantedPersons/Catalog` SPA → `/api` JSON; WAF needs browser headers): Guilford NC (540K), Forsyth, Rowan, +many.
- **Zuercher/CentralSquare PDF** (`Printed on <date>` + `Last, First Name`): McKenzie ND, Codington SD, Tuscarawas OH, Harrison OH.
- **TX-Municipal/CivicPlus PDF** (4-col `Name|WarrantDate|BalanceDue|Offense`, browser-UA): Killeen, Bell Mead, Taylor TX.

### Bespoke parsers (own family each)
- **FBI Wanted** (JSON `api.fbi.gov/wanted/v1/list`, browser-UA, `field_offices` filter) — federal.
- **Utah County JSON** (`sheriff.utahcounty.gov/api/mostWanted` + detail) — home turf.
- **St. Louis MN PDF** (block layout, 652 rows); **Kootenai ID PDF** (per-person block, felony+misd, huge → stream); **PSIMS PDF** (Hancock IL, **has DOB**); **Kanawha WV PDF**; **Newton GA PDF** (**has DOB**, myocv CDN); **Humboldt CA PDF** (dated DocumentCenter id → scrape link from page).
- **Per-site full-list HTML** (shared column-map helper): Morgan AL (10.8K, `char=`+`grp=` paging), Montgomery PA (city-grouped), Onondaga NY (6.1K, ASPX postback), Oneida NY, Goodhue MN, Black Hawk IA, Wood WI, Wayne PA (cards).
- **JS/XHR full-list** (hit underlying endpoint where found, else headless): Flathead MT, Anne Arundel MD, Chesterfield VA, Hamilton TN, Galveston TX.

### Existing (fold in unchanged)
- ASPX search (per-person): **Ada County ID**, **Natrona County WY** (`_aspnet.ts` helper).
- Statewide per-person: **warrants.utah.gov** (Chrome-UA; bot-blocks bulk — per-person only).

### Skipped (verified — legal/technical)
San Diego (Turnstile CAPTCHA), Maricopa (CAPTCHA), AZ DPS (ToS "any other purpose" + 5-cap), FDLE & FDLE-fed FL sheriffs (ToS), Allegheny PA (no public access), Douglas NE (bot-block), Sublette WY & St. Joseph MO (image-only PDFs, no text layer), NCAWARE (LE-only), all data-broker/SEO sites, **OpenSanctions (CC-BY-NC commercial license)**.

`*` Norfolk already partially wired.

## 5. Architecture — generalized `warrantSources/` framework

### 5.1 Dual-mode adapter (extend existing `WarrantSourceAdapter`)
The current interface is per-person only (`fetchForPerson`). Add a mode discriminator and a full-list method:
```ts
export interface WarrantSourceAdapter {
  meta: SourceMeta;                       // existing
  mode: 'full-list' | 'per-person';       // NEW
  fetchAll?(env): Promise<RawWarrantHit[]>;          // NEW — full source list, once per run
  fetchForPerson?(person, env): Promise<RawWarrantHit[]>;  // existing — name search
}
```
`SourceMeta` gains: `family` (parser id), `kind: 'criminal' | 'civil' | 'wanted'`, `format: 'json'|'socrata'|'arcgis'|'p2c-legacy'|'p2c-cloud'|'html'|'pdf'|'aspx'`, `coverage_state(s)`.

### 5.2 Config-driven source registry
New D1 table `national_warrant_sources` — each row is a source for a config-driven family:
```
source_key PK, family, state, jurisdiction, base_url, resource_id,
field_map (JSON), mode, format, kind, enabled, priority, created_at
```
At boot the registry **merges code-defined adapters (bespoke) with config-row adapters (families)**: a family factory `makeAdapter(family, configRow)` produces a `WarrantSourceAdapter` from a config row. So the long tail of Socrata/ArcGIS/P2C/Zuercher-PDF/TX-muni-PDF sources is **data**. Bespoke parsers (FBI, Utah County, St. Louis, Kootenai, PSIMS, Kanawha, per-site HTML) stay code adapters in the registry.

### 5.3 fetch → parse → normalize pipeline
- **fetch**: HTTP with browser UA; reuse `warrant_scraper_config` etag/last-modified caching + `resilience.ts` (timeout/retry/circuit).
- **parse**: per-family parser in `warrantSources/parse/` — `socrata.ts`, `arcgis.ts`, `p2cLegacy.ts`, `p2cCloud.ts`, `pdfZuercher.ts`, `pdfTxMuni.ts`, `pdfStLouis.ts`, `pdfKootenai.ts`, `pdfPsims.ts`, `pdfKanawha.ts`, `htmlTable.ts`, plus existing `parse/` for Ada/Natrona.
- **PDF**: add **`unpdf`** (Workers/serverless-compatible, pure-JS) to extract text from PDF buffers; family parsers consume the text. Large PDFs (Kootenai ~335MB) are size-capped/streamed; oversize → skip + circuit note.
- **normalize**: `warrantSources/normalize.ts` → clean English-readable output (`Last, First M` name, trimmed/expanded charge text via `chargeNormalize.ts`, ISO dates from epoch-ms/various, bond as number+remark, offense level). Output = the existing `RawWarrantHit` shape → `scraped_warrants`.

### 5.4 Storage
Reuse **`scraped_warrants`** (source_key, warrant_id, names, dob, age, charge_description, court, case#, bond, issue_date, **state**, status, person_id, first/last_seen, cleared_at) + add one **`kind`** column (`criminal|civil|wanted`, default `criminal`). `state` already exists — use it for the coverage map. Reuse **`warrant_scraper_config`** for per-source last_run/last_error/circuit (keyed by source_key). No change to capped tables (`scraped_warrants` is not capped).

## 6. Pull Engine — Utah rules, uniform (`runNationalWarrantScan`)
Generalize `runAllSourceScans`:
1. For each **enabled full-list** source: `fetchAll` → parse → normalize → upsert into `scraped_warrants` with first/last-seen lifecycle; per-source **clear-sweep** (rows not seen this run → `status='cleared'`).
2. For each **enabled per-person** source (Ada/Natrona/Utah): for each watch-population person, `fetchForPerson` (existing throttle/pacing).
3. **Match** local watch-population persons against stored `scraped_warrants` on the **Utah rules**: surname required, ±1yr age-match (`AGE_MATCH_TOLERANCE`), namesake/middle-initial guard, DOB-less attribution policy.
4. **Confirmed** matches (`reconcile.ts` confidence) → promote to canonical `warrants` (`external_source_key`, `external_warrant_id`, `auto_created=1`, `confirmed=1`, `type='arrest'`) → existing **officer-safety alert** path; emit `warrant_watch_log` found/cleared events; write `warrant_watch_runs`.
5. Per-source **circuit-breaker** (derived from consecutive errors, as today); `enabled=0` or oversize → skip.
6. Cron: **generalize `runAllSourceScans` in place** — it's already invoked by the 4-hourly `scheduled()` (src/index.ts:388) and the manual-scan route, so extending it to drive the full registry needs **no new hook**. Throttle remote per-person sources; full-list/JSON sources are cheap and run every cycle.

Watch population = the same filtered persons the Utah poller uses (org/business filters, ≤30-char names, LIMIT batch) ∪ optionally `intel_watchlist`/`screening_watchlist` persons.

## 7. National Search + Coverage Backend (exact UI contract)
`NationalWarrantSearchPage` already calls:
- **`POST /api/warrants/national-search`** body `{ first_name, last_name, dob, state, offense_level, warrant_type, charge_keyword }` → query cached `scraped_warrants` (all sources, `kind` filter) + FBI + optional live per-person; respond grouped by state + local. Reuse the `search-all` response conventions.
- **`GET /api/warrants/national-coverage`** → `{ sources, states_covered, active_warrants, state_status: Record<USPS, 'live'|'partial'|'none'>, state_sources: Record<USPS, number>, state_warrants: Record<USPS, number> }`, computed from `national_warrant_sources` + registry + `warrant_scraper_config` + `scraped_warrants` counts. Drives the SVG coverage map.

Wire `NationalWarrantSearchPage` into the router + nav (it exists but is unrouted); reuse pure-black tokens. SW `CACHE_NAME` bump.

## 8. Routes (`src/routes/warrants.ts`)
Add: `POST /national-search`, `GET /national-coverage`, `GET /national/sources` (registry + state), `POST /national/scan` (fire-and-forget `waitUntil` + 202), `GET /national/runs`. Roles: READ for search/coverage/sources/runs; SCAN (admin/mgr/sup) for scan. Defensive empty fallbacks (no 500s pre-migration). **Ship-gate**: confirm these new paths route to the live worker (per the proxy/zone-routing model — verify like `/api/screening` was).

## 9. Data Model — `migrations/0107_national_warrant_pull.sql`
- `CREATE TABLE IF NOT EXISTS national_warrant_sources (...)` (the config registry, §5.2) + seed the PR1 source rows.
- `ALTER TABLE scraped_warrants ADD COLUMN kind TEXT DEFAULT 'criminal';` (boot-reconciler tolerant; not a capped table). Add `source_state TEXT` if absent.
- Reuse `warrant_scraper_config`, `warrant_watch_runs`, `warrant_watch_log`, `warrants`. Apply directly to live D1 `785de7ae` post-merge (drift rule).

## 10. Legal / ToS Guardrails
Browser User-Agent on all fetches; per-source `enabled` toggle; skip CAPTCHA/ToS-forbidden sources (hard-coded skip list, §4); public-records framing in provenance (`scraped_source`, `scraped_raw`); `warrants.utah.gov` stays per-person; civil sources `kind='civil'` opt-in; OpenSanctions excluded (license). Respect robots where a source signals it; honor click-through "public records" terms (no auth-bypass).

## 11. Testing
- **Fixture-per-parser**: capture a real sample (JSON/HTML/PDF) per family (discovery agents saved several) under `tests/fixtures/warrants/`; unit-test `parse → normalize` against each → assert the normalized `RawWarrantHit` fields. Worker vitest (`tests/*.test.ts`).
- **Pure normalization** (`normalize.ts`, name/charge/date/bond) → full TDD.
- **Match scoring** (age-match/namesake) → reuse/extend existing tests.
- No live network in tests; live scraping verified manually post-deploy.

## 12. Phasing (multi-PR program)
- **PR 1 — framework + config-driven core (this spec's first plan):** dual-mode adapter + `national_warrant_sources` registry + family factory + normalize layer + `national-search`/`coverage` backend + route NationalWarrantSearchPage. Families: **FBI**, **generic-Socrata** (Baton Rouge + Norfolk), **generic-ArcGIS** (Arlington), **Utah County JSON**, **P2C-legacy** (Union NC + 2 config rows), **per-site HTML** (Morgan AL, Goodhue MN). ~10 live sources end-to-end. (Existing Ada/Natrona/Utah fold in.) **No PDF yet.**
- **PR 2 — PDF wave:** `unpdf` + PDF families (Zuercher: McKenzie/Codington/Tuscarawas/Harrison; TX-muni: Killeen/Bell Mead/Taylor; St. Louis MN; Kootenai ID; PSIMS Hancock IL; Kanawha WV; Newton GA; Humboldt CA).
- **PR 3 — JS/WAF + breadth:** P2C-cloud (browser headers), JS/XHR sources (Flathead/Galveston/Hamilton/Onondaga/Anne Arundel), + many more config rows for the existing families; civil sources (NY) behind the opt-in toggle.

## 13. Deployment & Ship-Gates
1. Feature branch → `gh pr create` → `pr-tests.yml` → merge → `deploy.yml`.
2. Apply `0107` directly to live D1 `785de7ae`; verify with `pragma_table_info`.
3. **Verify `/api/warrants/national-*` routing live** (browser, WAF blocks curl) — same gate `/api/screening` cleared.
4. Add `unpdf` to worker deps (PR2); confirm it bundles under wrangler/esbuild for Workers.
5. Bump `client/public/sw.js` `CACHE_NAME`.
6. Post-deploy: `national-coverage` returns the registry; run `national/scan`; confirm a known name in `national-search`.

## 14. Open Questions / Future
- Headless rendering for JS/WAF sources (P2C-cloud, Galveston) — a Browser-Rendering binding vs hitting discovered XHR endpoints (prefer XHR). Decide in PR3.
- Per-source legal review cadence (ToS can change); a periodic re-verify.
- Civil-warrant UX (separate tab/filter) — PR3.
- De-dupe across overlapping sources (a person on FBI + a county) — `reconcile.ts` extension.

## 15. Sources (verification)
FBI Wanted API `api.fbi.gov/wanted/v1/list`; Socrata SODA (`data.brla.gov`, `data.ny.gov`, `data.norfolk.gov`); ArcGIS (`gis2.arlingtontx.gov`); CentralSquare P2C (`*/wantedlist.aspx`, `*.policetocitizen.com`); Zuercher PDFs (McKenzie/Codington/Tuscarawas/Harrison); TX-muni PDFs (Killeen/Bell Mead/Taylor); St. Louis MN, Kootenai ID, Hancock IL (PSIMS), Kanawha WV, Newton GA, Humboldt CA PDFs; full-list HTML (Morgan AL, Montgomery PA, Onondaga/Oneida NY, Goodhue MN, Black Hawk IA, Wood WI, Wayne PA); Utah County `sheriff.utahcounty.gov/api/mostWanted`. All live-fetched 2026-06-12/13.
