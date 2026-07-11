# National Warrant Poller — Observability & Cleanup Design

**Date:** 2026-07-08
**Status:** Approved for planning
**Scope:** `src/utils/warrantSources/`, `src/routes/warrants.ts`, `src/index.ts` cron wiring, one new migration.

## Background

An audit of the warrant polling system (Utah state poller + national multi-source
scanner + config-driven adapters + cron) found the core scan/persistence pipeline
internally consistent — all 212 existing tests pass, and there is no showstopper
"silently disabled" bug. The problems found are **silent failure modes**: several
places where the poller degrades to doing nothing and nothing tells anyone.

Full diagnostic map (13 items) is preserved in the session that produced this
design; the 8 items in scope here are the ones with real operational impact on
the national (config-driven) poller. Three items were explicitly **out of scope**
by user decision: renumbering the duplicate `0110` migration prefix (renaming an
already-applied migration breaks D1's filename-based tracking), rewriting the
Baton Rouge migration history (already applied, correct today), and the
`reconcile.ts` unscoped `warrant_id` dedup key (separate, unrelated risk).

## Goals

1. Make every current silent-failure path in the national poller loud
   (`console.warn`/`console.error` at minimum, a persisted row where it affects
   health grading).
2. Give the A-F health grade the ability to distinguish "this source is actually
   working but found nothing today" from "this source has been silently broken."
3. Collapse the two independently-maintained "which sources are enabled"
   computations (`runScan.ts` vs the `/national-coverage` route) into one.
4. Close a real (if latent) data-integrity gap: no `UNIQUE` constraint on
   `warrant_scraper_config.source_name`.

Non-goals: changing scan cadence, adding new source families, changing the
Utah-specific poller (`utahWarrantPoller.ts`, confirmed correctly wired — not
touched), or altering the A-F grading thresholds/formula.

## Design

### 1. Adapter contract: `degraded` signal

`ChunkResult` (`src/utils/warrantSources/types.ts`) gains two optional fields:

```ts
export interface ChunkResult {
  hits: RawWarrantHit[];
  nextCursor: string | null;
  done: boolean;
  degraded?: boolean;        // true if this fetch caught an error and returned partial/empty data
  degradedReason?: string;   // short machine-readable reason, e.g. "http_500", "fetch_threw", "no_text_layer"
}
```

The `fetchAll`-mode adapter interface (used by PDF/text families) gains a parallel
optional return shape — either adopt `{ hits, degraded?, degradedReason? }` in
place of a bare `RawWarrantHit[]`, or (simpler, less churn) have `fetchAll`
throw on catastrophic failure and only use `degraded` for the partial-success
case; the implementation plan should pick whichever requires touching fewer call
sites. Preference: extend `fetchAll`'s return type to match `ChunkResult`'s
`{hits, degraded?, degradedReason?}` shape for consistency, since `runScan.ts`
already branches on `mode` and can handle both.

**`configRegistry.ts` changes** (`makeAdapter()`):
- Socrata branch: on non-OK HTTP or thrown fetch error, set `degraded: true`,
  `degradedReason` from the HTTP status or error message, in addition to the
  existing `console.warn` (already present — just wire the field through).
- ArcGIS branch: same, on non-OK HTTP or thrown error mid-loop.
- PDF families (`pdf-zuercher`/`pdf-txmuni`/`pdf-newton`/`pdf-incode`): the
  `if (!text) return [];` (no text layer / 404) and the `catch { return []; }`
  around `pdf.parse()` both currently degrade silently — add `console.warn` +
  `degraded: true` with a reason (`no_text_layer` / `pdf_parse_threw`).
- Text families (`xml-bonner`/`csv-zuercher`): the `if (!res.ok) return [];`
  and `catch { return []; }` get the same treatment (`http_<status>` /
  `fetch_threw`).

None of these become `throw` — a single bad source must still not abort the
whole batch scan (existing behavior preserved).

### 2. `runScan.ts`: aggregate degraded status

The per-source scan result (already tracks `checked/found/cleared/errors`) gains
a `degraded: boolean` field, set `true` if any chunk/call for that source in
this run reported `degraded: true`. This flows into the existing
`AllSourceScanResult.scraped[]` array consumed by `logScanResult.ts`.

### 3. `scraper_runs` schema + grading

New migration `0179_scraper_runs_degraded.sql`:

```sql
ALTER TABLE scraper_runs ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;
```

`insertScraperRunRow` (`logScanResult.ts`) signature gains a `degraded: boolean`
parameter; the `success` value written becomes:

```ts
counts.errors === 0 && !degraded ? 1 : 0
```

`computeHealthGrade` (`healthGrade.ts`) is **unchanged** — it already just
consumes `{success: boolean}` rows, and folding `degraded` into `success` at
insert time means a degraded run counts as a failure for grading purposes
without touching the grading formula. The raw `degraded` column stays queryable
on `scraper_runs` directly for diagnosis (e.g. via the existing scrapers admin
route) — a source that's erroring for real vs. one that's degrading are both
now visibly non-green, but an admin can distinguish them by querying the column.

### 4. Total-orchestrator-failure sentinel row

`src/index.ts` cron handler (~line 191-207): if `runAllSourceScans(env.DB)`
itself throws (not a per-source error — the whole call), insert one
`scraper_runs` row via the existing `insertScraperRunRow` helper with
`source_key = '__scan_orchestrator__'`, all counts 0, `errors: 1` (so it grades
as a failure), `trigger: 'cron'`, before/alongside the existing
`console.error('Warrant source scheduled scan failed:', err)`. This makes a
total-scan crash show up in health-grade history instead of vanishing.

The current double-catch structure (inner `.catch()` on the scan promise, outer
`.catch(() => {})` on the dynamic-import chain) stays — the outer catch only
guards against `import()` module-resolution failure, which is a distinct,
rarer failure mode not worth persisting a row for (it means the Worker's own
bundle is broken, not the scan).

### 5. Unmatched-family logging

`configRegistry.ts`'s `makeAdapter()` return-`null` path (family doesn't match
any known family) gets a `console.warn` naming `row.source_key` and
`row.family` before returning `null`. No behavior change — this row is still
dropped from the adapter list — just no longer silent.

### 6. Fail-closed path gets logged

`getConfigAdapters` (`configRegistry.ts`)'s `catch { return []; }` around the
`national_warrant_sources` query gets a `console.warn` matching the existing
pattern in `getEnabledAdapters` (`registry.ts`). Fail-closed behavior is
**kept as-is** (not changed to fail-open) — dropping all national sources on a
DB error is the safer failure mode than scanning with a possibly-stale adapter
list. Only the logging gap closes.

### 7. Single source of truth for "which sources are enabled"

`src/routes/warrants.ts`'s `/national-coverage` handler currently recomputes
enabled sources itself (`getEnabledAdapters(db)` + a direct
`national_warrant_sources WHERE enabled=1` query, then hand-merges). Replace
this with a call to the same `getAllEnabledAdapters(db)` used by
`runScan.ts:377`, so the coverage endpoint reports exactly what the real scan
would use — including the "always-on" FBI/Utah-County force-include and the
existing dedup-by-`meta.key` logic. The route's existing Utah special-case
comment/guard (`warrants.ts:337-345`) is preserved since it addresses a
different concern (Utah's dedicated poller isn't a `national_warrant_sources`
row at all).

### 8. Cleanup

- Remove the unused `getEnabledAdapters` import in `runScan.ts:31` (only
  `getAllEnabledAdapters` is used in that file).
- Migration `0179` (same file as the `degraded` column, since both are small
  schema tweaks to source-management tables) also adds:
  ```sql
  -- Dedupe any existing collisions first (keep lowest rowid), then enforce going forward.
  DELETE FROM warrant_scraper_config
  WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM warrant_scraper_config GROUP BY source_name
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_warrant_scraper_config_source_name
    ON warrant_scraper_config(source_name);
  ```
  (A `UNIQUE INDEX` is used instead of an inline `UNIQUE` column constraint
  since D1/SQLite can't add a column constraint via `ALTER TABLE`, and this
  table already exists.)
- `migrations/README.md`: add a one-line note under the existing
  duplicate-prefix list documenting that `0110_national_warrant_pdf_sources.sql`
  and `0110_warrant_source_chunking.sql` are both real, apply in lexicographic
  order (the pdf-sources file first), and that
  `0110_warrant_source_chunking.sql` is the actual source of truth for Baton
  Rouge's current `enabled` state (not the two earlier files that mention it
  staying disabled). No SQL files are renamed or modified beyond this doc note
  and one clarifying comment.

## Testing

- `tests/warrantConfigRegistry.test.ts`: add cases asserting `degraded: true`
  is set (with the right `degradedReason`) for Socrata/ArcGIS non-OK HTTP,
  thrown fetch errors, and unmatched `family` (assert the `console.warn`
  fires — via a spy — and `null` is still returned).
- `tests/warrantSocrata.test.ts` / `tests/warrantArcgis.test.ts`: extend with
  degraded-path assertions if these files test at the adapter level rather
  than the parser level (check current coverage before adding — may already
  be covered by the configRegistry tests above).
- `tests/warrantPdfIncode.test.ts` / similar PDF test files: add a
  no-text-layer / parse-throw case asserting `degraded: true`.
- New test (`tests/logScanResult.test.ts` or extend existing): assert
  `insertScraperRunRow` writes `success=0` when `degraded=true` even with
  `errors=0`.
- New test: `computeHealthGrade` behavior unchanged (no new test needed there
  since its input contract doesn't change) — but add a scenario test showing
  a run of all-degraded rows grades as low/F despite `errors=0` throughout,
  to document the intended end-to-end behavior.
- `test-workers/` or a targeted unit test for the `index.ts` cron sentinel-row
  logic (mock `runAllSourceScans` to throw, assert a
  `source_key='__scan_orchestrator__'` row gets inserted).
- Existing `tests/warrantsSearchAll.test.ts` / national-coverage tests: verify
  still-passing after routing `/national-coverage` through
  `getAllEnabledAdapters`.

## Migration checklist (per CLAUDE.md)

After merge, apply `0179_scraper_runs_degraded.sql` directly to live D1
(`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) via `scripts/apply-migration.sh`, then
verify via `pragma_table_info('scraper_runs')` (expect `degraded` column) and
confirm the unique index via
`SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='warrant_scraper_config'`.
