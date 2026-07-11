# Sex Offender Registry — Per-State Detail Enrichment

Date: 2026-07-04

## Context

NSOPW (`src/utils/nsopw/*`) already federates queries to all 50 states/territories
and persists every hit to `national_sex_offenders` (migration 0146/0147), including
a `detail_url` — the jurisdiction's own deep-link to the offender's public record.
But the federated response itself never carries `offense`, `risk_level`, `tier`, or
`registration_status` — those columns exist on the table but are only ever
populated if something fetches and parses the state's own detail page.

Building full independent per-state registry scrapers (crawling entire state
rosters) was considered and rejected: most state registries run on OffenderWatch
or similar platforms with anti-bot protection (the existing iCrimeWatch/Utah SOR
integration already hit DataDome for exactly this reason — see
`project-udc-icrimewatch-sor-sources` memory). Fetching a single, specific,
already-known `detail_url` for a *confirmed* NSOPW hit is a fundamentally
different (and much lower-risk) access pattern than crawling a directory listing.

Scope for this PR: **6 states** — Utah, Idaho, Nevada, Wyoming, Colorado, Arizona
(RMPG's Salt Lake City home turf + bordering states). No new states beyond these
six in this pass; the framework is built to make adding a 7th state a small,
isolated addition later.

## Architecture

New directory `src/utils/sorEnrichment/`, mirroring the existing `warrantSources/`
adapter framework's shape (same `key`/`fetchX(env)` pattern, familiar to anyone
who's touched that code):

- **`types.ts`** — `SorEnrichmentAdapter` interface: `{ state: string,
  parseDetailPage(html: string): ParsedEnrichment }`. `ParsedEnrichment = {
  offense: string | null, risk_level: string | null, tier: number | null,
  registration_status: string | null }`. Deliberately synchronous/pure —
  the adapter only parses HTML it's handed; it never fetches. Fetching is the
  runner's job (one place to handle timeouts/retries/user-agent, not six).
- **`adapters/utah.ts`, `idaho.ts`, `nevada.ts`, `wyoming.ts`, `colorado.ts`,
  `arizona.ts`** — one file per state. Each does **label-driven, tolerant text
  extraction** (regex/string-search over the raw HTML for label patterns like
  `/Offense[:\s]+([^<\n]+)/i`), not brittle CSS selectors — because none of
  these parsers can be built against a live sample in this session (no browser
  fetch available to me right now). This mirrors the SL County Assessor
  integration's own documented approach: "parser tolerant by design: label-driven
  + raw-data catch-all." Every adapter also stores the *first 2000 characters*
  of unmatched HTML into a `raw_snippet` field on the run-log row (see below) so
  a human can diff real captured pages against the heuristic later and tighten
  the regex once live data is seen.
- **`registry.ts`** — `ADAPTERS: Record<string, SorEnrichmentAdapter>` keyed by
  two-letter state code, exactly the 6 states above. `getAdapterForJurisdiction(code)`
  returns `undefined` for anything outside the 6 — the runner skips those rows
  entirely (no fail-open/fail-closed ambiguity; unsupported states are simply
  not attempted).
- **`runner.ts`** — `enrichPendingOffenders(db, env, opts?)`: queries
  `national_sex_offenders WHERE jurisdiction IN (UT,ID,NV,WY,CO,AZ) AND
  detail_url IS NOT NULL AND offense IS NULL` (i.e., has a URL, hasn't been
  enriched yet), capped to a bounded batch size per invocation (mirrors the
  warrant poller's `MAX_PERSONS_PER_RUN` pattern — an unbounded fetch loop in a
  Worker request is a timeout risk). For each row: fetch `detail_url` (bounded
  timeout, single retry), look up the adapter by `jurisdiction`, run
  `parseDetailPage`, `UPDATE national_sex_offenders SET offense=?,
  risk_level=?, tier=?, registration_status=?, updated_at=datetime('now')
  WHERE id=?`. A per-row failure (network error, unparseable page) is caught,
  logged to the run-log table, and does NOT abort the batch — matches the
  existing warrant-poller pattern of isolating failures per-item.

### New table: `sor_enrichment_runs`

Audit/run-log only — this is not a "list of sources" table like
`national_warrant_sources` (there's nothing to configure per-state beyond the
adapter code itself; no `enabled`/`priority` knobs needed for a 6-state fixed
set in this pass).

```sql
CREATE TABLE IF NOT EXISTS sor_enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_id INTEGER NOT NULL,      -- national_sex_offenders.id
  jurisdiction TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error_message TEXT,
  parsed_offense TEXT,
  parsed_risk_level TEXT,
  raw_snippet TEXT,                  -- first 2000 chars of HTML, for later parser tuning
  attempted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sor_enrichment_offender ON sor_enrichment_runs(offender_id);
```

### Route: on-demand trigger

`POST /api/nsopw/enrich` (new handler in `src/routes/nsopw.ts`, admin-gated) —
runs `enrichPendingOffenders` synchronously for one bounded batch and returns a
summary `{attempted, succeeded, failed}`. No new UI in this pass — this is a
backend capability first; a "Enrich now" button in the existing NSOPW screening
UI is a natural follow-up but out of scope here (YAGNI — ship the pipe first,
wire a button once it's proven against live pages).

### Cron

Rides the existing `*/30 * * * *` bucket in `src/index.ts`'s `scheduled`
handler (`event.cron === '*/30 * * * *'` branch, `wrangler.toml:309`) — no new
cron trigger. This is a low-frequency, non-urgent backfill sweep, so the
30-minute bucket fits better than the per-minute bucket (already carrying 14
essential sweeps per project memory) or the 4-hour bucket (reserved for the
heavier Utah warrant sync).

## Testing

Miniflare route test for `POST /api/nsopw/enrich` (auth/role gate, runs against
a seeded `national_sex_offenders` row with a fake `detail_url`, using a stubbed
`fetch` — no real network calls in tests, consistent with the Utah-trigger
test's approach in the warrant-scraper-ops work). Pure-function unit tests for
each of the 6 `parseDetailPage` implementations against small inline HTML
fixtures written to approximate each state's known page structure — these are
necessarily synthetic (same caveat as the SL Assessor fixtures) and should be
replaced with real captured samples once a human confirms actual page HTML
post-merge.

## Out of scope (explicitly deferred)

- States 7+ beyond the initial 6.
- A "verify this parser against a live sample" step — I cannot fetch live
  state registry pages from this session. The synthetic-fixture caveat above
  applies to every one of the 6 parsers.
- Any UI changes (the "Enrich now" button, a status column in the SOR list).
- Firecrawl fallback for states whose detail pages turn out to require JS
  rendering or bot-challenge bypass — if a live test post-merge shows a given
  state's page can't be fetched with a plain `fetch()`, that becomes a
  follow-up, not silently baked into this PR.
