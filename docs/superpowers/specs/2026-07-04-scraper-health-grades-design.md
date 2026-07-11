# Warrant Scraper Health Grades — Design

Date: 2026-07-04

## Context

The warrant-scraper-ops work (PR #2593) explicitly deferred health-grade
computation: `metrics_24h.health_grade` always ships as `null` (see
`src/routes/scrapers.ts`'s `zeroedMetrics()`), because no run-history table
existed to compute a grade from. The client papers over this by defaulting
`null` to `'F'` in three places (`ScrapersTab.tsx:219,294`,
`AdminWarrantScrapersTab.tsx:279`), so every source — healthy or not, ever-run
or never-run — displays the worst possible grade. That's the bug being fixed.

Separately, only the Utah source (`runUtahWarrantScan`, wired into the
existing `0 */4 * * *` cron bucket) runs automatically. The generic scraped
sources (Ada County, Natrona, and the config-driven Socrata/ArcGIS sources)
only ever run when an admin manually clicks "trigger now" in
`ScrapersTab.tsx`. A function that already runs *all* of them —
`runAllSourceScans()` in `src/utils/warrantSources/runScan.ts` — exists and
returns Utah's result plus a `ScrapedSourceSummary[]` (one entry per scraped
source, with `checked/found/cleared/errors` counts), but nothing calls it.
Building grades without fixing this would mean most sources never accumulate
history and stay perpetually ungraded — so both problems are fixed together.

## Architecture

### New table: `scraper_runs`

```sql
CREATE TABLE IF NOT EXISTS scraper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  success INTEGER NOT NULL,      -- 1 if errors=0 for this source this run
  checked INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  cleared INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trigger TEXT NOT NULL           -- 'cron' | 'manual'
);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_source_key ON scraper_runs(source_key, started_at);
```

One row per source per scan attempt — both the periodic cron sweep and a
manual admin trigger write here, distinguished by `trigger`.

### Cron: wire `runAllSourceScans` into the existing 4-hour bucket

`src/index.ts`'s `0 */4 * * *` branch currently calls `runUtahWarrantScan`
directly. Replace that call with `runAllSourceScans(env.DB)` — it already
runs the Utah leg internally (unchanged, same function, same
`warrant_watch_runs` logging it does today) plus every enabled scraped
source. After the call resolves, write one `scraper_runs` row per entry in
its `scraped: ScrapedSourceSummary[]` array (`trigger: 'cron'`), plus one row
for Utah itself (keyed `utah-warrant-watch`, derived from the returned
`WatchRunResult.errors`/`status`). This doesn't change Utah's own scan
behavior or its existing logging — it only adds the new `scraper_runs` audit
rows alongside what already happens.

### Manual trigger: log to the same table

`POST /:key/trigger` (already built) gets one more line after each of its
three success/failure branches (Utah special-case, code-resident adapter,
config-driven adapter): write a `scraper_runs` row for that single source,
`trigger: 'manual'`, `checked`/`found`/`cleared`/`errors` taken from whatever
summary the adapter path returned (or `errors: 1` on the caught-exception
502 path).

### Grading

New pure function `computeHealthGrade(runs: {success: boolean}[]): ScraperHealthGrade | null` in a new
`src/utils/warrantSources/healthGrade.ts`:

- Zero rows → `null` ("no data yet" — the client shows "N/A", never "F").
- Otherwise, success rate over up to the last 20 rows for that source:
  `>=95%` → A, `>=85%` → B, `>=70%` → C, `>=50%` → D, else F.
- 20 is an arbitrary-but-reasonable window (roughly 3+ days of 4-hourly cron
  runs) — small enough that a source's grade reacts to recent behavior,
  large enough that one bad run doesn't swing A→F.

`GET /` and `GET /health` in `src/routes/scrapers.ts` query the last 20
`scraper_runs` rows per source (one query, grouped/limited per `source_key`
in application code — D1 doesn't have a clean single-query "top N per group"
without a window function, and this repo's `query()` helper doesn't wrap
those; a per-source query in a loop is fine at this scale, same pattern
already used for `warrant_count` before the N+1 fix — except here we already
learned that lesson, so this will batch via one query ordered by
`source_key, started_at DESC` and group client-side in JS) and call
`computeHealthGrade`. `success_rate`, `total_runs`, `avg_duration_ms` in
`metrics_24h` get populated from the same rows instead of staying zeroed.

### Client fix

`ScrapersTab.tsx:219,294` and `AdminWarrantScrapersTab.tsx:279`: change
`s.metrics_24h?.health_grade || 'F'` to `s.metrics_24h?.health_grade ?? null`,
and render `null` as a distinct "N/A" badge/state rather than falling into
whatever the A–F badge styling does for an unrecognized value. The grade
filter dropdown (`ScrapersTab.tsx:499`) gets an "N/A" option alongside A–F.

## Testing

- Pure-function tests for `computeHealthGrade` (empty array → null, various
  success-rate boundaries → correct letter, off-by-one at each threshold).
- Miniflare route tests for `GET /` and `GET /health` verifying grade
  computation against seeded `scraper_runs` rows (a source with 20/20
  successes → A, a source with 8/20 → D, a source with zero rows → null).
- A Node-suite test for the cron-branch logging logic (not the whole
  `scheduled` handler — extract the "write scraper_runs rows from an
  AllSourceScanResult" step into its own small testable function rather than
  inlining it directly in `src/index.ts`, matching this repo's existing
  pattern of keeping `index.ts`'s scheduled branches as thin dispatchers).
- Manual UI smoke check: trigger a source, confirm it moves from "N/A" to a
  real grade after one run.

## Out of scope (explicitly deferred)

- Percentile latency (`p50_duration_ms`/`p95_duration_ms` in `metrics_24h`)
  beyond a simple average — precise percentiles need more rows than a
  20-row window meaningfully supports; average is good enough for now.
- Any change to the Socrata/ArcGIS/PDF adapter fetch logic itself — this is
  purely about recording and grading what already happens.
- A UI for browsing individual `scraper_runs` history rows (only the
  aggregated grade/rate surfaces in this pass).
