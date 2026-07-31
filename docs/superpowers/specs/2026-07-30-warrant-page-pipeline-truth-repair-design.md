# Warrant Page — Pipeline Truth Repair

**Date**: 2026-07-30
**Status**: Approved (scope + stuck-row policy confirmed by operator)
**Author**: Claude (with Christopher Zamora)

## Context

A live walkthrough of https://rmpgutah.us/warrants (all seven tabs, admin account,
API probed directly with the session token) found the page renders confidently while
reporting values that are wrong, frozen, or structurally impossible. Nothing here is
inferred from reading code — every defect below was reproduced against live
production and its mechanism confirmed in source.

The unifying failure mode is **not** missing features. It is that three independent
contracts silently disagree, and every disagreement fails *quietly* — `undefined`
becomes `NaN` or an empty state, a killed isolate leaves a row claiming to be
running, and a shadowed route returns a plausible 400. The page never says "I don't
know"; it says `0`, `Never`, `LOW`, `—`.

**Scope (operator-selected): data and pipeline truth only.** IA and layout repair are
explicitly out of scope — the empty 640 px detail pane, clipped/stretched selects,
Screening's duplicated inner `WATCHLIST`/`SOURCES` sub-tabs, and Watch List's missing
empty states are recorded in "Observed but out of scope" below and left untouched.

## Root Cause 1 — Scan runs can never finalize (P0)

`warrant_watch_runs` has **20 rows, 100% `status='running'`, `completed_at` NULL,
`persons_checked = 0`**, oldest `2026-07-28T16:00`. Confirmed live via
`GET /warrants/watch/runs`.

The write path is correct. `runUtahWarrantScan` (`src/utils/utahWarrantPoller.ts`)
INSERTs a `'running'` row at line 563, then finalizes it at line 762 *after* the
per-person loop. The loop is the problem:

- `DEFAULT_MAX_PERSONS_PER_RUN = 150` (line 70)
- `await sleep(BASE_DELAY_MS + jitter)` between every person, `BASE_DELAY_MS = 8_000` (lines 66, 736)

Minimum wall clock ≈ `149 × 8s = 19.9 min`, up to ~25 min with jitter, before any
upstream fetch time. Per Cloudflare's published limits, **Cron Triggers have a hard
15-minute wall-time cap**, and `waitUntil()` extends an HTTP request by only **30
seconds**. The finalize UPDATE at line 762 is therefore unreachable by construction
on any run with more than a handful of persons — as is the
`warrant_scraper_config` health write at line 795, which is why
`last_success_at` for `utah-warrant-watch` is frozen at `2026-07-24`.

Each stuck row keeps the `persons_checked = 0` the INSERT wrote, which is exactly
what live data shows.

The manual trigger is worse: `src/routes/warrants.ts:120` calls
`runUtahWarrantScan(db).catch(...)` — a **bare floating promise with no
`waitUntil`** — so it is killed the moment the response returns. This explains the
three orphaned runs inside three minutes (an operator clicking "Run Scan Now").

### Downstream symptoms all explained by Root Cause 1

| Symptom | Mechanism |
|---|---|
| "UTAH WARRANT POLL: RUNNING…" banner effectively permanent | reads a `running` row that never closes |
| **That banner overlays the tab strip and eats every tab click** | banner is injected *above* the strip, shifting it 23 px; DOM hit-test at the Screening tab's own centre returns the banner (`isSelfOrChild: false`) |
| Watch List: "0 PERSONS MONITORED", "LAST SCAN: **Never**" | no run has ever had `completed_at` set |
| All 20 Scan History cards: "In progress… 0/0/0/0" | `persons_checked` etc. never updated past INSERT defaults |
| Scrapers health grades (`ada-county-id` F/0%) | line 795 config health write unreachable |

### Fix

1. **Deadline guard inside the loop.** Capture a monotonic start; before each
   `sleep`, if elapsed exceeds `RUN_WALL_BUDGET_MS` (10 min — comfortably inside the
   15 min cron cap with headroom for the sweep and cursor write), break out of the
   loop and finalize normally as `completed` with a `partial: true` marker in
   `error_message`. The existing `persons_cursor_id` resume cursor already advances
   so the next tick covers the next slice. This is self-correcting regardless of how
   slow the upstream becomes, which a smaller fixed slice size alone is not.
2. **Lower `DEFAULT_MAX_PERSONS_PER_RUN` to 60** (`60 × 10s = 10 min`) so the common
   path finishes on the slice cap rather than tripping the deadline. The deadline
   stays as the hard backstop.
3. **Stale-run reaper**, on the existing cron: rows with `status='running'` AND
   `started_at` older than `STALE_RUN_TIMEOUT_MS` (20 min) become
   `status='failed'`, `completed_at = started_at + timeout`,
   `error_message = 'run did not finalize within the execution window'`. This is the
   operator-approved **reconcile + backfill**: its first tick closes out all 20
   existing rows, so Watch List immediately shows a truthful LAST SCAN instead of
   `Never`, and the banner stops claiming a three-day-old run is live.
4. **`warrants.ts:120` gets `c.executionCtx.waitUntil(...)`** instead of a floating
   promise. Because `waitUntil` only buys 30 s, the manual trigger passes a short
   deadline (20 s) — it does a real bounded slice and finalizes honestly rather than
   pretending to start a full scan it cannot finish.

Parsing note: `started_at` is written as an ISO-8601 UTC string
(`new Date().toISOString()`) while sibling columns use zone-less
`datetime('now')`. The reaper must use `parseD1TimestampMs` per the CLAUDE.md
invariant so the timeout comparison cannot skew on a non-UTC host.

## Root Cause 2 — Sources tab reads five field names the API does not emit (P1)

`GET /warrants/scrapers` emits per source: `warrant_count`, `last_scrape_at`,
`consecutive_errors`, `state`. `WarrantsPage.tsx` reads:

| Client reads (line) | API actually emits | Live symptom |
|---|---|---|
| `s.active_count` (2415) | `warrant_count` | **`NaN`** in "Active Warrants" tile |
| `s.total_count` (2416) | `warrant_count` | **`NaN`** in "Total Indexed" tile |
| `s.active_warrants` (2454) | `warrant_count` | "N active" never renders on any state card |
| `s.last_scraped_at` (2418, 2457) | `last_scrape_at` | **"RECENTLY SCRAPED 0"** despite populated timestamps; every card styled "not recent" |
| `s.consecutive_failures` (2456) | `consecutive_errors` | error styling never renders |

`undefined` inside `reduce((sum, s) => sum + s.active_count, 0)` yields `NaN`, and
`NaN.toLocaleString()` renders the literal string `"NaN"`. The two tiles that do
work (`Total Sources`, via `.length`) are precisely the two that don't touch a
drifted name — which is what made the two `NaN`s reproducible and diagnostic.

Note the same component reads `active_count` at 2415 and `active_warrants` at 2454
for one value, 39 lines apart. Neither is right.

**Utah missing from its own state grid**: `utah-warrant-watch` has `state: ""`, and
`stateCodes` is built with `.filter(Boolean)`, so the home jurisdiction is dropped.
19 sources collapse to 9 state groups — hence `states_covered: 10` disagreeing with
9 rendered cards.

### Fix

Introduce a single `ScraperSource` type in `client/src/types/` matching the actual
`/warrants/scrapers` payload, and read through it everywhere. Correct all five
names. Give sources with an empty `state` an explicit `'UT'` for
`utah-warrant-watch` (it is the Utah source) and group anything else stateless under
a `'—'` bucket that renders rather than vanishes, so no source can ever be silently
dropped from a count again.

Because these are the drift class the whole page suffers from, the type is the
deliverable — not the five renamed reads.

## Root Cause 3 — Three source counts disagree (P1)

Header chip `SOURCES 20/21`, Sources tab `19 TOTAL SOURCES / 18 enabled`,
`national-coverage` `sources: 19`. Three numbers, one concept.

`national-coverage` returns `sources` as a **scalar `19`**, while `/scrapers`
returns `sources` as a **19-element array** — the same key name carrying two
different types across two endpoints, which is what makes this drift so easy to
reintroduce.

### Fix

`/warrants/scrapers` becomes the single source of truth for "how many sources exist
and how many are enabled". The header chip and the Sources tab both derive from it.
`national-coverage`'s scalar `sources` is renamed `source_count` in its response so
the name can never again be mistaken for the array, and the Sources tab stops
reading it for counts.

## Root Cause 4 — Two endpoints are dead, shadowed by `GET /:id` (P1)

Confirmed live: `GET /warrants/summary-report` → `400 {"error":"Invalid warrant id"}`,
`PUT /warrants/batch-update` → same. `/:id` is registered at lines 986/1073;
`summary-report` at 1401 and `batch-update` at 1250 come after.

The comment at `warrants.ts:968` asserts Hono's radix trie "prioritizes static
segments regardless of declaration order". For these two paths that is not the
observed behavior — production returns the `/:id` handler's validation error.

### Fix

Move both registrations above `/:id`, matching the file's own stated convention that
`/:` routes come last. Correct the comment at line 968 to say declaration order *is*
load-bearing here, so the next person doesn't re-add a literal path below `/:id` on
the strength of a promise production doesn't keep. Add a route-order regression test
asserting both return non-400.

## Root Cause 5 — Four list columns are structurally dead (P1)

All four render an identical value on every row in production.

**`SOURCE` → `—` always.** `stateFromSource()`
(`client/src/utils/warrantListHelpers.ts:44`) matches `^([a-z]{2})_` but real keys
are `ada-county-id` — hyphen-separated with the state as a **suffix**. The Worker
has a *second, different* implementation (`warrants.ts:914`, `^([a-z]{2})[-_]`)
which is also prefix-anchored and, verified against the live keys, resolves
**nothing**: `ada` is three letters so the pattern never matches, and
`ada-county-id`, `natrona-county-wy`, `ohio-drc-pval` and `utah-warrant-watch` all
return null. Only the legacy `ut_district` shape ever worked. So `?state=` filters
match nothing, and two implementations of one derivation are both broken.

**`FRESHNESS` → ✏️ always.** `/unified` returns no scrape timestamp on any row, so
`freshnessClass(null)` always falls through to `'manual'`.

**`AGE` → `8w` always.** Computed from `created_at` (batch insert time), not the
warrant's issue date. `/unified`'s scraped-row reshape (`warrants.ts:877-904`) omits
`issue_date` entirely — while *using* it as a `created_at` fallback one line later
at 901.

**`PRIORITY` → `LOW` always.** `computePriorityScore` yields < 40 for every row.

### Fix

1. **One shared source→state parser.** A single exported helper, used by both Worker
   and client, that parses the real `slug-county-<state>` and `<state>_thing` shapes
   and returns `null` — never a bogus two-letter guess — when it cannot tell. Delete
   both existing implementations. Unit-test it against the real live source keys
   (`ada-county-id`, `natrona-county-wy`, `ohio-drc-pval`, `utah-warrant-watch`).
2. **`/unified` reshape carries `issue_date`** through to the row (it is already read
   at line 901), and `age_days` is computed from issue date with `created_at` only as
   an explicit fallback.
3. **`/unified` reshape carries a scrape timestamp** (`last_scrape_at` / `fetched_at`)
   so `FRESHNESS` has an input.
4. **`sortKeyMap`'s `issued_date → 'created_at'` lie is removed** — sorting by issue
   date sorts by issue date. This is a silent-wrong-answer fix, not cosmetic.
5. Re-check `computePriorityScore` against rows that now have a real issue date;
   an all-`LOW` distribution is expected to change once age is no longer a constant.
   If it is still uniform after that, treat the scoring weights as a separate finding
   rather than tuning them blind here.

## Root Cause 6 — `/unified` loads both whole tables and swallows its own errors (P2)

`SELECT * FROM warrants` and `SELECT * FROM scraped_warrants` with **no `LIMIT`**
(lines 868, 876), then filters, sorts and paginates in JS. Pagination is cosmetic —
the cost is paid before the first row is skipped.

Its catch block returns `200 {warrants: [], total: 0}` (line 964) — the exact
silent-empty-swallow the 2026-07-21 rebuild eliminated for `GET /` but never
removed here. A DB failure is indistinguishable from "no warrants".

### Fix

Push the filters that can be expressed in SQL (`archived_at`, `status`, `type`,
`source`, `person_id`) into both queries, and bound each with `LIMIT`. The
cross-table merge, derived-field computation and final sort stay in JS — they span
two heterogeneous tables and cannot be done in one D1 statement — but they no longer
start from the full tables. The catch block returns a real 500 with `log.error` +
`logErrorToDb`, matching `GET /`.

Any `IN (...)` list added here must go through `queryInChunks`/`chunkBindings` per
the D1 100-bound-parameter cap in CLAUDE.md.

## Corrections made during implementation

Recorded because each one was a claim in an earlier revision of this spec that
turned out to be wrong when checked against the code or the live API:

1. **`/warrants/scrapers` field drift had a simpler root cause than described.**
   A CORRECT `ScraperSource` type already existed in `client/src/types/scrapers.ts`
   and `AdminWarrantScrapersTab` was already using it successfully.
   `WarrantsPage.tsx` declared a **local duplicate** that was wrong. The fix is to
   delete the duplicate and import the canonical type — not to write a new one.
   Rewriting it honestly then surfaced **four further** drift sites `tsc` caught
   immediately (`CoverageSourceCard`, the detail table).
2. **The Worker's source→state regex does not return `"AD"`.** `ada` is three
   letters, so `^([a-z]{2})[-_]` never matches; verified it returns **null** for
   every live source key. The defect is equally severe (no state ever resolves,
   so `?state=` matches nothing) but it is an honest null, not a bogus code.
3. **`POST /watch/scan` was not missing `waitUntil`.** It already used
   `c.executionCtx.waitUntil`. The real defect is that `waitUntil` grants only
   **30 seconds** while its own comment described a "~80s+" run, so it was killed
   every time. Fixed by passing a short wall budget, not by adding `waitUntil`.
4. **"ALL SOURCES DETAIL (19)" is a collapsed `<details>`.** The empty body was
   correct behavior. **Finding withdrawn.**
5. **The four dashboard tiles spinning forever was load latency, not a defect.**
   They resolved on a second look. **Finding withdrawn.**
6. **Renaming `national-coverage`'s scalar `sources` to `source_count` is
   withdrawn.** Its only consumer already types it correctly as a number, and the
   header chip counts a genuinely DIFFERENT population (enabled code `ADAPTERS` +
   `national_warrant_sources` rows) from the Sources tab
   (`warrant_scraper_config` rows). They are not one number; collapsing them would
   be wrong. This spec's framing of that finding was too glib.
7. **The tab-strip overlay is fixed by `pointer-events-none`, not by z-index.**
   The strip is purely informational, so it never needs pointer events. The exact
   stacking cause is still unexplained; making the strip click-transparent removes
   the failure mode without touching layout geometry, which is the safer fix on a
   dispatch nav bar. Confirmed in a real browser that an overlay at those
   coordinates steals the click with `pointer-events: auto` and passes it through
   with `none`.

Additionally fixed, found while in the code and squarely in the "truth" scope:
`GET /warrants/dashboard/stats` caught every error and returned `200` with all six
stats **zeroed** — a DB failure rendered as "ACTIVE WARRANTS 0 / SOURCES 0/0"
behind a calm green LED. And `fetchCoverage` had `catch { /* silent */ }`, making
a failed load identical on screen to zero configured sources.

## UI scope (added by operator mid-implementation)

Originally out of scope; the operator extended the work to the UI. Fixed:

- Detail pane held a fixed 45% with nothing selected, hiding BAIL/ATTEMPTS/DATE
  behind a scrollbar; list now takes full width until a row is selected.
- Filter selects clipped their own placeholders at 96 px ("All Statu",
  "All Sour", "All Severit"); widened.
- The "By state" select had no width class in a flex-wrap row, stretching to
  962 px and reading as a broken empty bar; given a width.

Still open from the UI list, deliberately:

- Scrapers "LAST HOUR: RUNS, NEW" renders no values because
  `/scrapers/health` returns `last_hour_runs`/`last_hour_inserted` as **hardcoded
  zeros**, and that route's comment states the per-run history table needed to
  compute them does not exist. Faking a number is worse than the blank.
- Watch List has no empty state below its tiles.
- Screening's inner `WATCHLIST`/`SOURCES` sub-tabs still duplicate the outer tabs.
- The 23 px layout shift when the poll strip appears (a misclick hazard
  independent of the click-blocking, which is fixed).

## Observed but explicitly out of scope

Recorded so they are not lost, deliberately not fixed here:

- List table needs 1324 px in a 987 px container (BAIL/ATTEMPTS/DATE hidden behind
  horizontal scroll) while a 640 px "WARRANT DETAIL" pane sits permanently empty.
- Filter selects clipped ("All Statu", "All Severit"); three selects stretched to
  full width (962 px "By state", "All States", "All Grades") read as broken empty rows.
- Screening's inner `WATCHLIST`/`SOURCES` sub-tabs duplicate the outer tabs.
- Watch List has no empty state — a blank void below the tiles.
- Scrapers "LAST HOUR: RUNS, NEW" renders labels with no values; LIVE FEED still
  shows "Waiting for events…" (the `TODO(user-contribution)` from the 2026-07-21 spec).
- Sources "ALL SOURCES DETAIL (19)" is a header over an empty body.
- The tab-strip layout shift itself (23 px) is a misclick hazard independent of the
  overlay; only the click-blocking overlay is fixed here.

## Testing

- `test-workers/warrants.test.ts` (exists): add route-order regression asserting
  `GET /summary-report` and `PUT /batch-update` do not return 400 `Invalid warrant id`.
- New unit tests for the shared source→state parser against the real live source keys,
  including the `null` case — the current bug is a wrong *answer*, so a test that only
  checks "returns something" would still pass.
- New unit test for the reaper's timeout boundary using `parseD1TimestampMs`, covering
  the ISO-vs-`datetime('now')` mixed-format case.
- `/unified` test asserting a DB error produces 500, not `200 {warrants: []}` — assert
  the *branch*, and confirm it goes red when the catch is restored.
- Full suites are the gate, not targeted runs (CLAUDE.md): `npm run typecheck`,
  `npx vitest run`, `npm run test:worker`, `cd client && npx tsc --noEmit && npx vitest run`.
  Never run root and client vitest concurrently.
- Live re-verification after deploy, against the same evidence that opened each finding:
  `watch/runs` shows non-`running` statuses; Watch List LAST SCAN is a date; no `NaN`
  on Sources; UT present in the state grid; SOURCE/AGE/FRESHNESS vary across rows;
  tab clicks land while the poll banner is visible.

## Deploy notes

No schema change — no migration, so the `continue-on-error` migration hazard does not
apply. The reaper writes only to existing `warrant_watch_runs` columns
(`status`, `completed_at`, `error_message`).

The reaper's first production tick mutates 20 live rows from `running` to `failed`.
That is the intended backfill, and it is the one irreversible step in this work.
