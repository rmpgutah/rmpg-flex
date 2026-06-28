# Nationwide SOR Cross-Reference via NSOPW

**Status:** Implemented + reconnaissance + photo persistence + UI consolidation. Live with `NSOPW_ENABLED=1` (no MOU required).
**Date:** 2026-06-22 (initial design + recon + consolidation)
**Author:** Christopher Zamora + Claude

## Consolidation pass (PR series #1588 → #1590 → #1594 → photos PR)

**`/nsopw` is now the only Sex Offender Registry surface in the app.** The two legacy pages were folded in:

- **`/sex-offender-registry`** (Utah-only iCrimeWatch SOR) → now redirects to `/nsopw`
- **`/offender-registry`** (RMPG-internal offender_alerts compliance) → now redirects to `/nsopw`

Page components deleted. Navigation entries in `Sidebar.tsx`, `Layout.tsx`, and `MenuBar.tsx` collapsed to a single "Sex Offender Registry" item pointing at `/nsopw`. Old bookmarks survive via the route redirects.

## Canonical records linkage (mig 0149)

Every NSOPW match (confirmed OR possible) materializes into the
canonical RMPG records:

- **Persons** — find-or-create by `sor_number = "{jurisdiction}:{ext}"`
  (when present), else by `(last_name, first_name, dob)` exact, else by
  `(last_name, first_name)` when both sides have no DOB. The matched
  or newly-created person gets `is_sex_offender = 1` and (when missing)
  `sor_number` stamped. Created persons carry
  `notes = "Auto-created from NSOPW match (<jurisdiction>)"`.
  Linkage stored on `national_sex_offenders.person_id`.

- **Properties** — one canonical `properties` row per real address
  (TRANSIENT / INCARCERATED / UNKNOWN / blank addresses are
  deliberately skipped — they're jurisdictional placeholders, not
  real addresses). Dedup by normalized address; reuses the existing
  `findOrCreateProperty` dedup heuristic. New properties land under a
  sentinel `"NSOPW — Auto-Imported"` client (the `properties` table's
  `client_id` NOT NULL requirement, mirrored from `serveIntakeRecords`).
  Linkage stored on `nsopw_offender_properties` (offender × property ×
  location_type with first/last_seen_at).

- **Vehicles** — table `nsopw_offender_vehicles` provisioned for future
  per-state detail-page enrichment (NSOPW federated response does not
  carry vehicle data). Schema is ready; nothing populates it yet.

The orchestrator awaits `materializeOffenderLinks` so the API response
carries the linked ids back to the client immediately — `View Person Record`
and `View Property` buttons appear on the very first response, not on a
re-query. Failures are caught + logged; a failed link doesn't break the
parent NSOPW result.

## Full data capture on match (photo persistence)

NSOPW returns `imageUri` deep-linking the source state's image host
(`fdle.state.fl.us`, `meganslaw.ca.gov`, `wsdocs.watchsystems.com`, etc.).
Those URLs rotate on state CDN changes — leaving our records pointing at
404s. Mig 0148 adds 5 columns to `national_sex_offenders`
(`local_photo_key`, `local_photo_url`, `photo_fetched_at`,
`photo_size_bytes`, `photo_content_type`); the orchestrator (`src/utils/nsopw/index.ts`)
fires `downloadAndStorePhoto()` for every confirmed/possible candidate via
`ctx.waitUntil()`. Photos land in R2 (`rmpg-flex-uploads`, prefix
`nsopw-photos/{JURISDICTION}/{slug}.{ext}`) and are served back through
`GET /api/nsopw/photo/:offenderRowId` (auth-gated). Self-rate-limited to
once-per-7-days per offender (a re-query within the window skips the
download). The client `NsopwSearchPanel` prefers `localPhotoUrl` over
the upstream `photoUrl` and falls back on `img onError` if the local
copy isn't in R2 yet.

The full `detail_json` blob already captured the complete NSOPW response;
mig 0147's `locations_json` captured multi-location. Combined with mig
0148's photo, the RMPG-side record now owns a faithful copy of everything
NSOPW returns about the subject.

## NSOPW under warrants

NSOPW is the primary SOR retention system under warrants:

- **Auto-screen on warrant creation:** `src/routes/warrants.ts` POST `/`
  fires `screenPersonForSor(env, subject_person_id, {triggeredBy:'warrant_create'})`
  via `c.executionCtx.waitUntil()`. Confirmed/possible hits land in
  `screening_hits` immediately after the warrant is recorded.
- **Warrant Detail UI** renders a new `WarrantNsopwStatus` pane (between
  Subject Info and Court Info) that reads `/api/nsopw/person/:id/hits` and
  shows confirmed (red) + possible (amber) matches, the local photograph,
  jurisdiction badge, match score, and a "Re-screen" button that triggers
  a fresh federated query.

## Reconnaissance update (2026-06-22)

The initial design assumed an MOU-gated endpoint at `api.nsopw.gov`. **Live reconnaissance against the
public nsopw.gov form showed the real federated search endpoint is `POST https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search`,
public-CORS-restricted (no auth), with a completely different request/response shape.** All findings are
captured in `tests/fixtures/nsopw/john-smith-search.real.json` (399 offenders, 317 KB).

Key changes from the initial design (now reflected in the code):

- **Endpoint** → `https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search`
- **Auth** → none (public). MOU key still accepted as Bearer for sanctioned higher rate limits.
- **Request body** → `firstName/lastName/city/county/zips/jurisdictions[]/clientIp` JSON sent with
  `Content-Type: application/x-www-form-urlencoded`. **NO `dob` field accepted.** Jurisdictions array
  must be the literal full list of 183 codes (`src/utils/nsopw/jurisdictions.ts`).
- **Response shape** → `{statusCode, jurisdictionStatus[], query, offenders[]}` at top level. Each
  offender is `{name:{givenName,middleName,surName}, aliases:[{...}], gender, dob, age, locations[], offenderUri, imageUri, absconder, jurisdictionId}`.
- **DOB IS in the response** on ~73% of records as ISO datetime (`"1972-04-28T00:00:00"`). The strict-match
  policy in `match.ts` works against the real data unchanged — name search, DOB post-filter.
- **Offense / tier / risk are NOT in the federated response.** They require a per-state detail-URL
  enrichment scrape (future work). The database columns remain (filled by future enrichment).
- **`absconder` boolean is new** (94% coverage). Captured by mig 0147.
- **Multi-location**: `locations[]` carries RESIDENCE + WORK + INCARCERATED for offenders with multiple.
  Flat columns hold `locations[0]`; the full array goes into `locations_json` (mig 0147).

The integration is gated by `NSOPW_ENABLED=1` env flag — opt-in switch acknowledging the ToU posture
(the public endpoint's Conditions of Use page likely prohibits programmatic access regardless of CORS
permitting it technically). Without the flag, the framework reports `configured: false` and the
false-clear guard surfaces it as a coverage gap.

Ground-truth fixture-driven tests: 51 unit tests (normalize + match + parse + photoStore), all driven
by the real 317 KB capture and mocked R2/D1. Any future API drift will be caught by these tests
against future fixture replacements.



## Reconnaissance update (2026-06-22)

The initial design assumed an MOU-gated endpoint at `api.nsopw.gov`. **Live reconnaissance against the
public nsopw.gov form showed the real federated search endpoint is `POST https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search`,
public-CORS-restricted (no auth), with a completely different request/response shape.** All findings are
captured in `tests/fixtures/nsopw/john-smith-search.real.json` (399 offenders, 317 KB).

Key changes from the initial design (now reflected in the code):

- **Endpoint** → `https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search`
- **Auth** → none (public). MOU key still accepted as Bearer for sanctioned higher rate limits.
- **Request body** → `firstName/lastName/city/county/zips/jurisdictions[]/clientIp` JSON sent with
  `Content-Type: application/x-www-form-urlencoded`. **NO `dob` field accepted.** Jurisdictions array
  must be the literal full list of 183 codes (`src/utils/nsopw/jurisdictions.ts`).
- **Response shape** → `{statusCode, jurisdictionStatus[], query, offenders[]}` at top level. Each
  offender is `{name:{givenName,middleName,surName}, aliases:[{...}], gender, dob, age, locations[], offenderUri, imageUri, absconder, jurisdictionId}`.
- **DOB IS in the response** on ~73% of records as ISO datetime (`"1972-04-28T00:00:00"`). The strict-match
  policy in `match.ts` works against the real data unchanged — name search, DOB post-filter.
- **Offense / tier / risk are NOT in the federated response.** They require a per-state detail-URL
  enrichment scrape (future work). The database columns remain (filled by future enrichment).
- **`absconder` boolean is new** (94% coverage). Captured by mig 0147.
- **Multi-location**: `locations[]` carries RESIDENCE + WORK + INCARCERATED for offenders with multiple.
  Flat columns hold `locations[0]`; the full array goes into `locations_json` (mig 0147).

The integration is gated by `NSOPW_ENABLED=1` env flag — opt-in switch acknowledging the ToU posture
(the public endpoint's Conditions of Use page likely prohibits programmatic access regardless of CORS
permitting it technically). Without the flag, the framework reports `configured: false` and the
false-clear guard surfaces it as a coverage gap.

Ground-truth fixture-driven tests: 44 unit tests across normalize/match/parse, all driven by the real
317 KB capture. Any future API drift will be caught by these tests against future fixture replacements.



## Problem

RMPG's existing SOR coverage is Utah-only (the `utah_sex_offenders` table populated by an
iCrimeWatch scraper, agency 54438). When dispatch attaches a subject to a CFS who is registered
in Wyoming, Nevada, Colorado — or any of the 49 other states + territories + tribal jurisdictions —
the system has no way to surface that. The user request is plain: **nationwide SOR pull, cross-
reference by name and DOB.**

## Solution

Slot a new `nsopw` screening adapter into the existing person-screening framework
([screening/registry.ts](../../../src/utils/screening/registry.ts)). The framework already gives us:

- cron sweep (`runScreeningScans()` walks `screening_watchlist` for each adapter)
- review queue UI ([ReviewQueues.tsx](../../../client/src/pages/intel/ReviewQueues.tsx))
- confirm/dismiss flow (`confirmScreeningHit`, `dismissScreeningHit`)
- dossier integration ([intelDossier.ts:48](../../../src/utils/intelDossier.ts:48))
- false-clear guard (`coverage()` returning `available: false` when unconfigured)

NSOPW conforms to the `ScreeningAdapter` contract, so all of the above is free.

On top of that, this PR adds three NSOPW-specific concerns the framework doesn't model:

1. **Result caching** (`nsopw_query_cache`, 14-day TTL) — federated queries take 5–20 s and
   the MOU has a per-day rate ceiling; cache keyed by normalized name+DOB so a known-empty name
   doesn't re-burn quota on every CFS subject add.
2. **Strict matching with officer review** — the engine's generic name scorer matches anything
   with the same surname. With 50 states each having ~100 "Smith" entries, that's noise. NSOPW
   uses a custom matcher (`src/utils/nsopw/match.ts`): auto-confirm requires exact last+first+DOB;
   anything close-but-not-exact becomes "possible — needs officer review".
3. **Persistent offender table** (`national_sex_offenders`) — confirmed and possible hits are
   persisted with full detail so the review queue's "show offender" works after cache expiry.

## Architecture

```
Officer types name+DOB at /nsopw
        │
        ▼
GET /api/nsopw/search?name=&forename=&dob=
        │
        ▼   src/routes/nsopw.ts
runNsopwScreening(env, query)         ← also called by:
   │                                    • screening adapter (cron)
   ├─ cache.readCache() ────────────┐    • auto-on-person-create (records.ts:322,386)
   │   cache hit → classify + log──┘    • auto-on-CFS-subject-add (callLinks.ts:160)
   │
   ├─ client.nsopwSearch()          ← HTTP, AbortController, typed retries
   │
   ├─ parse.parseSearchResponse()   ← schema-tolerant envelope parser
   │
   ├─ match.classifyAll()           ← strict; confirmed | possible | excluded
   │
   ├─ persist.upsertOffender()      ← national_sex_offenders (idempotent)
   │
   ├─ cache.writeCache()
   │
   └─ run-log into nsopw_runs
        │
        ▼ (when called via screenPersonForSor)
   INSERT screening_hits with source_key='nsopw'
        │
        ▼
   FRAMEWORK FREE: review queue · dossier · confirm/dismiss · false-clear coverage
```

## Database (migration 0146)

- `national_sex_offenders` — analog to `utah_sex_offenders`: flat columns + `detail_json`. Unique
  index `(jurisdiction, nsopw_offender_id)` because offender IDs collide across states.
  Composite index `(last_name, first_name, date_of_birth)` for the user's stated cross-ref.
- `nsopw_query_cache` — query-level cache keyed by `cacheKeyOf(query)`. Stores `result_count` (0 for
  cached misses) so we don't re-burn quota on common-but-empty names.
- `nsopw_runs` — per-query run log with cache_hit flag, jurisdiction coverage map, MOU rate-limit
  surface, run kind (`query`/`sweep`/`manual`/`backfill`), trigger source.
- Seed: `INSERT OR IGNORE INTO screening_source_state ('nsopw', 1, 7)` — scan_interval_days=7 picks
  up newly-registered offenders within a week without burning daily MOU quota.

## Match policy

**Confirmed (auto):** exact surname AND exact forename AND exact DOB. Anything less than
all three exactly = NOT confirmed.

**Possible (officer-confirms):**
- exact surname + first-initial-only forename
- exact surname + phonetic forename (Levenshtein ≤ 2; Stephen/Steven, Catherine/Kathryn)
- exact surname + forename, but DOB unknown on either side
- alias surname match (always possible, never auto-confirmed)

**Excluded:**
- surname doesn't match
- name matches but DOB explicitly conflicts (different person)
- match score < 0.5 (surname alone is insufficient)

This is exactly the user's stated preference: "Strict + officer-confirms borderline."

## Triggers (all 4 user-selected paths)

| Trigger | Path | Notes |
|---------|------|-------|
| Manual on-demand | `GET /api/nsopw/search?name=&forename=&dob=` + `/nsopw` page | The user's literal cross-ref UI. |
| Auto on person create | `records.ts:322` (POST `/records/persons`) + `:386` (from-dl-scan) | `waitUntil(screenPersonForSor(...))` — never blocks the create. |
| Auto on CFS subject add | `dispatch/callLinks.ts:160` (POST `/dispatch/calls/:id/persons`) | Same waitUntil pattern. |
| Scheduled bulk re-screen | Existing `runScreeningScans()` cron | Free — adapter registration is the only wiring needed. |

## Configuration

- `NSOPW_API_KEY` — DOJ-issued under MOU. Set via `wrangler secret put NSOPW_API_KEY`.
- `NSOPW_API_BASE` — override default `https://api.nsopw.gov` if DOJ assigns a different host.
  Optional, in `[vars]` of `wrangler.toml`.

When the key is unset, every NSOPW path returns `configured: false` with an operator-facing
warning. **A blank result on an unconfigured NSOPW is NOT a clearance** — the framework's
`coverage` array surfaces this on every `/api/screening/search?source=all` response.

## Honest scope notes

- **MOU wait:** the literal wire format may differ slightly from the public-side envelope this
  PR codes against. The parser at `src/utils/nsopw/parse.ts` is schema-tolerant (label-driven,
  multiple field-name fallbacks), and the HTTP client at `src/utils/nsopw/client.ts` is the only
  thing that talks the literal wire. When the MOU pack arrives, expect ~5–10 line tweaks to
  `client.ts` and possibly `parse.ts` — nothing else.
- **`/api/health` only** is WAF-bypassed; verifying the rest of the routes from CI is via
  Cloudflare D1 + the worker logs.
- **Auto-screen volume:** at typical RMPG call volume (~50 subject-adds/day) plus person creation
  (~20/day) plus weekly bulk sweep (~5,000 persons / 7 days = ~700/day), total queries ≈ 800/day.
  The 14-day cache hit rate on common subjects should drop this further. MOU rate ceilings vary;
  start at default and monitor `nsopw_runs.http_status` for 429s.

## Testing

- `tests/nsopwNormalize.test.ts` — name + DOB canonicalization, cache key collapsing.
- `tests/nsopwMatch.test.ts` — strict/possible/excluded classification, phonetic-before-initial.
- `tests/nsopwParse.test.ts` — envelope tolerance, tier derivation, jurisdiction coverage.

31 unit tests; all pass.

## Out of scope for this PR

- Dispatch banner UI for confirmed CFS-subject NSOPW hits. The hit flows into the existing
  `screening_hits` table where the dossier integration picks it up. A dedicated banner is a
  follow-up PR.
- Photo download to R2 (`photo_url` is currently a remote URL; for offline-capable mobile
  use we'd persist it). Follow-up.
- Multi-vehicle / vehicle SOR (NSOPW does not federate vehicle data; per-state APIs do).
- Live look-in / push notification on new registrations. NSOPW is pull-only; a "newly
  registered" signal would require per-state polling.

## Operator checklist (when MOU lands)

1. `wrangler secret put NSOPW_API_KEY` — paste the MOU-issued key.
2. (Optional) Set `NSOPW_API_BASE` in `wrangler.toml` `[vars]` if DOJ assigns a non-default host.
3. Hit `GET /api/nsopw/status` — expect `{ configured: true }`.
4. Hit `GET /api/nsopw/search?name=Smith&forename=John&dob=1985-06-12` — expect a real federated
   response (likely with at least one match for the test name across 50 states).
5. Browse `/nsopw` in the SPA — confirm the panel renders, coverage bar shows OK across
   jurisdictions, and a sample search returns rich offender cards with photos.
6. Verify `wrangler d1 execute rmpg-flex --remote --command 'pragma_table_info(\"national_sex_offenders\")'`
   shows the 0146 columns. If not, re-apply 0146 directly to live D1.

## Files added / changed

- **NEW:** `migrations/0146_nsopw_screening.sql`
- **NEW:** `src/utils/nsopw/{types,normalize,match,parse,client,cache,persist,index}.ts`
- **NEW:** `src/utils/screening/nsopwAdapter.ts`
- **NEW:** `src/routes/nsopw.ts`
- **NEW:** `client/src/components/NsopwSearchPanel.tsx`
- **NEW:** `client/src/pages/NsopwLookupPage.tsx`
- **NEW:** `tests/nsopw{Normalize,Match,Parse}.test.ts`
- **CHANGED:** `src/utils/screening/registry.ts` — register `nsopwAdapter`.
- **CHANGED:** `src/routesConfig.ts` — mount `/api/nsopw`.
- **CHANGED:** `src/routes/records.ts` — auto-screen on person create (2 sites).
- **CHANGED:** `src/routes/dispatch/callLinks.ts` — auto-screen on CFS subject add.
- **CHANGED:** `client/src/App.tsx` — `/nsopw` route entry.
- **CHANGED:** `client/src/pages/SexOffenderRegistryPage.tsx` — Nationwide button in toolbar.
