# National Warrant Search — Backend Fix

Date: 2026-07-04

## Context

`client/src/pages/NationalWarrantSearchPage.tsx` is a fully-built client page
(coverage map, filters, PDF export) that calls two endpoints neither of which
exist on the Worker: `GET /api/warrants/national-coverage` and
`POST /api/warrants/national-search`. This is the same class of bug as the
earlier court-lookups/fleet-expenses/scraper-ops audit — complete UI, zero
backend.

This is a separate, narrower fix from the eventual `NationalWarrantSearchPage`
+ `WarrantsPage` merge (deferred — see conversation). The existing
`POST /search-all` route (consumed by `WarrantsPage`'s "Search All" tab) is
**also** stubbed (hardcoded empty local/utah arrays, zero filtering on
`scraped_warrants`), but it's a different consumer and out of scope here —
noted as known related debt, not fixed in this pass.

## Data sources searched

- **`scraped_warrants`** — national/federated source hits (has `first_name`,
  `last_name`, `date_of_birth`, `age`, `state`, `warrant_type`,
  `offense_level`, `charge_description`, `status`, `bail_amount`,
  `photo_url`, `case_number`, `issue_date`, `court_name`).
- **`warrants`** (local RMPG records) — `subject_first_name`,
  `subject_last_name`, `subject_dob`, `warrant_type`, `offense_level`,
  `charge_description`, `bond_amount`/`bail_amount`, `issued_date`,
  `issuing_court`. Populates the response's `local[]` bucket.
- **`national_warrant_sources`** (config-driven sources) + the code-resident
  `ADAPTERS` array (`src/utils/warrantSources/registry.ts`) — used only by
  `national-coverage` to compute per-state source/warrant counts, not
  searched directly (their data lands in `scraped_warrants` once scraped).

## `GET /api/warrants/national-coverage`

- A static, in-file list of all 50 states + DC (`{code, name}` pairs) is the
  base — every state appears in the response even with zero sources, so the
  coverage map can render "no coverage" states distinctly from "not yet
  checked."
- Per state: `state_sources[code]` = count of `national_warrant_sources` rows
  with that `state` (case-insensitive) plus any code-resident `ADAPTERS`
  entries matching that state, `enabled = 1` only. `state_warrants[code]` =
  `COUNT(*) FROM scraped_warrants WHERE state = ? AND status = 'active'`.
  `state_status[code]` = `'active'` if `state_sources[code] > 0`, else
  `'disabled'` (no data-driven concept of `'pending'` exists yet — the client
  type allows it, but nothing in this pass produces it).
- `states[]` = the full 50+DC list mapped to `{stateCode, stateName,
  available: state_status[code] === 'active', message}` — `message` is set
  only for `disabled` states, e.g. `"No active sources configured"`.
- `sources` = total enabled source count across all states. `states_covered`
  = count of states with `state_status === 'active'`. `active_warrants` =
  `SUM(state_warrants)`.

## `POST /api/warrants/national-search`

**Validation**: at least one of `first_name`/`last_name`/`state` must be
non-empty (matches the client's "at least one field" rule at
`NationalWarrantSearchPage.tsx:375`) — 400 otherwise.

**Strict match policy** (per explicit requirement): a bare last-name search
across 50 states of scraped data would flood results with unrelated people
sharing a common surname. So:

- `last_name` (when provided) is matched via case-insensitive substring
  (`LIKE '%value%'`) — same looseness as today's local search, since spelling
  variants are common in scraped OCR/HTML data.
- `first_name` (when provided) same substring match.
- **If `dob` is provided in the request**: a candidate row is only included
  if EITHER its own `date_of_birth`/`subject_dob` matches exactly, OR — for
  rows that only carry `age` (not a DOB) — the age computed from the query's
  `dob` (as of today) falls within that row's stated `age` ± 1 year (accounts
  for a birthday having passed/not passed since the record was last scraped).
  A row with neither a DOB nor an age field, when `dob` was supplied, is
  **excluded** — this is the crux of the strict-match requirement: no DOB on
  either side means no basis to confirm identity, so it doesn't get returned
  as if it were confirmed.
- **If `dob` is NOT provided**: no age/DOB filtering happens at all — matches
  fall back to name (+ state, if given) only, same as the existing client
  behavior when a user doesn't know a DOB.
- `state`, `offense_level`, `warrant_type` — exact match (case-insensitive)
  when provided.
- `charge_keyword` — substring match against `charge_description` /
  `charge`/`offense_description`.

**Response**: `{total, search_time_ms, by_state: Record<STATE, Warrant[]>,
local: Warrant[]}`. `scraped_warrants` rows are grouped into `by_state` keyed
by their own `state` column (uppercased); `warrants` (local) rows always go
into `local[]` regardless of state (they're RMPG's own jurisdiction).
`search_time_ms` is measured via `Date.now()` at request start/end (Workers
runtime — `Date.now()` is fine here, this is production route code, not a
resumable script).

**Capture all data, read-only**: each `Warrant` in the response is `SELECT *`
from its source row (`scraped_warrants` or `warrants`) mapped to the client's
`Warrant` type field names where they differ (e.g. `date_of_birth` → `dob`,
`charge_description` → `charge`), plus every other column passed through
under its own name rather than dropped — this endpoint is a pure read; it
never sets `status`, `cleared_at`, or any other field. Clearing a warrant
stays governed exclusively by the existing scraper's documented invariant in
`src/utils/warrantSources/runScan.ts` ("never wrongly clear" — a source's
clear-sweep only runs after a full, error-free scan cycle). This search route
has no clear-sweep logic of its own and must not be given any in a later pass
without re-deriving that same safety property.

## Testing

Miniflare route tests for both endpoints: `national-coverage` seeded with a
handful of `national_warrant_sources`/`scraped_warrants` rows across 2-3
states, asserting the full 51-entry `states[]` list and correct
active/disabled split. `national-search` seeded with rows that exercise every
branch of the strict-match policy: exact DOB match (included), DOB mismatch
(excluded), no-DOB-on-record-but-age-matches-query-DOB (included),
no-DOB-and-no-age-when-query-has-DOB (excluded), no-DOB-in-query-at-all
(name-only fallback, included regardless of record's DOB/age).

## Out of scope (explicitly deferred)

- Merging `NationalWarrantSearchPage` and `WarrantsPage` into one page/route.
- Fixing `POST /search-all` (separate, also-stubbed endpoint, different
  consumer — `WarrantsPage`'s own "Search All" tab).
- Adding new warrant source adapters/scrapers (a separate, later request).
- A `'pending'` coverage state — nothing in current data distinguishes
  "source exists but hasn't run yet" from "source configured and enabled";
  this is a future refinement once `national_warrant_sources` gains a
  last-run timestamp check, not invented here.
