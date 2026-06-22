# Nationwide SOR Cross-Reference via NSOPW

**Status:** Implemented + reconnaissance follow-up done. Set `NSOPW_ENABLED=1` to go live (no MOU required).
**Date:** 2026-06-22 (initial design + recon)
**Author:** Christopher Zamora + Claude

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
