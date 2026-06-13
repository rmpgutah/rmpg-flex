# Large-source chunked ingestion for the national-warrant-pull framework

**Date:** 2026-06-13
**Status:** Design — approved, pending spec review
**Area:** `src/utils/warrantSources/` (config-driven full-list warrant sources)

## Problem

Large full-list warrant sources are only partially ingested, and the place the
cap actually bites is *not* where it appears at first glance.

There are **two stacked caps**, and the tighter one wins:

1. **Adapter `fetchAll` (arcgis)** — `for (offset = 0; offset < 50000; offset += 1000)`
   in [`configRegistry.ts`](../../../src/utils/warrantSources/configRegistry.ts)
   fetches at most **50,000** rows into memory and breaks on `!exceededTransferLimit`.
   The socrata branch has the same shape with a `1_000_000` ceiling.
2. **Leg slice (`runFullListLeg`)** — `MAX_FULL_LIST_HITS = 5000` then
   `hits.slice(0, 5000)` in [`runScan.ts`](../../../src/utils/warrantSources/runScan.ts)
   means only the **first 5,000** rows are ever stored, regardless of how many the
   adapter returned.

So the **effective ceiling today is 5,000**, not 50K and not the `200000` figure
referenced informally elsewhere (there is no `truncated = hits.length > 200000`
variable in the code — the real mechanism is the 5K slice plus a `console.warn`).

Concrete impact: the live, **enabled** Arlington TX source
(`https://gis2.arlingtontx.gov/.../MapServer/9`, family `arcgis`, seeded in
[`0107_national_warrant_pull.sql`](../../../migrations/0107_national_warrant_pull.sql))
has ~148,503 rows. Only ~5,000 are ingested; the other ~143K Arlington municipal
warrants are never stored. Baton Rouge (~113K, socrata) is disabled *inline* in
0107 (`enabled = 0`) for the same budget reason. (There is **no migration 0110**
yet — re-enabling Baton Rouge requires creating one; `0110` is the next free prefix.)

This is a **coverage gap, not corruption**: the un-fetched tail is never inserted,
so the per-source clear-sweep never wrongly clears it.

### Why naively raising the cap is wrong

At 148K rows a single cron invocation would fetch ~148 sequential pages into memory
and issue hundreds of thousands of D1 round-trips. The full-list leg runs inside
the same `runAllSourceScans` chain as the **Utah** leg (RMPG's home jurisdiction),
so a wall-clock / CPU / D1 blow-out on a scraped source would starve Utah. A single
Worker cron tick physically cannot write 148K rows to D1. **Chunked ingestion across
cron invocations is the only real path to full coverage.**

### The real hard problem: the clear-sweep assumes a full-roster pass

[`markScrapedCleared`](../../../src/utils/warrantSources/store.ts) marks every row
of a source whose `last_seen_at < runStartedAt` as `cleared`. That logic assumes
**each run sees the entire roster**. The moment we ingest in chunks (rows 0–4,999
this tick, 5,000–9,999 next tick), a per-run sweep on the next tick would wrongly
clear the previous chunk. Chunked ingestion therefore requires a **cycle-aware**
clear-sweep that fires only when a full pass over the roster completes.

## Goals

- **Full coverage** of large full-list sources (Arlington ~148K, Baton Rouge ~113K)
  ingested incrementally across cron ticks.
- **Never starve Utah** — the home-jurisdiction leg must always run.
- **Never wrongly clear** the un-ingested tail or a prior cycle's still-valid rows.
- **Bounded per-tick cost** — a fixed work budget per source per invocation.
- Applied **uniformly** to the arcgis and socrata config families; small full-list
  sources (FBI, Utah County, Norfolk) keep working unchanged.

## Non-goals

- Per-person matching/promotion of full-list hits (already handled by the
  reconcile/search paths in a later PR; full-list hits store with `person_id = null`).
- Changing the Utah poller path (kept byte-identical, per the runScan.ts contract).
- Changing per-person adapters.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Coverage target | **True full coverage via cross-invocation chunking** |
| Per-tick cadence | **5,000 rows/tick, batched writes** (Arlington full cycle ≈ 30 ticks ≈ 5 days; Baton Rouge ≈ 23 ticks ≈ 4 days at 6 ticks/day) |
| `UNIQUE INDEX` on `scraped_warrants(source_key, warrant_id)` | **Yes**, with an idempotent dedup pre-step |
| Cycle-completion gate authorship | **Claude implements it**, with tests |
| Utah-first reorder | **Yes** — Utah leg runs before the full-list leg |

## Architecture

### 1. New adapter capability — `fetchChunk`

Add to `WarrantSourceAdapter` in
[`types.ts`](../../../src/utils/warrantSources/types.ts):

```ts
fetchChunk?(
  cursor: string | null,
  env: { DB: D1Database } & Record<string, unknown>,
): Promise<{
  hits: RawWarrantHit[];
  nextCursor: string | null;   // opaque resume token (ArcGIS: last OBJECTID; Socrata: next offset)
  done: boolean;               // true = roster fully traversed this pass
}>;
```

The adapter stays a pure "give me the next window from this token" function — no DB
writes, no clear-sweep knowledge — so it is unit-testable by feeding a cursor and
asserting the request URL + the `done` flag. The **leg owns all stateful decisions**
(persist cursor, when to sweep). A full-list adapter may implement `fetchChunk`
(chunked) and/or `fetchAll` (one-shot); the leg **prefers `fetchChunk`** when present.

The arcgis + socrata branches of `makeAdapter` are converted to `fetchChunk`. Small
code adapters (FBI, Utah County) keep `fetchAll` and the existing one-shot path.
Norfolk (socrata, small) becomes chunked but returns `done: true` on its first chunk —
behaviourally identical to today.

### 2. New persisted state — `national_warrant_source_progress`

A sidecar table (migration `0110`) keeps runtime cursor/cycle state out of the
config table and works for any full-list source keyed by `source_key`:

```sql
CREATE TABLE IF NOT EXISTS national_warrant_source_progress (
  source_key        TEXT PRIMARY KEY,
  cursor            TEXT,                       -- opaque resume token; NULL = start of a fresh pass
  cycle_started_at  TEXT,                       -- ISO ts when the current full pass began
  last_full_cycle_at TEXT,                      -- ISO ts of the last completed pass (observability)
  rows_this_cycle   INTEGER NOT NULL DEFAULT 0, -- running count for logging
  updated_at        TEXT DEFAULT (datetime('now'))
);
```

### 3. The cycle gate (heart of the design) — `runFullListLeg`

Per tick, for an adapter with `fetchChunk`:

1. Read progress → `(cursor, cycle_started_at)`. None ⇒ fresh cycle:
   `cursor = null`, `cycle_started_at = now`.
2. `fetchChunk(cursor)` → `{ hits, nextCursor, done }`.
3. Batched-upsert `hits` (capped at the 5K chunk budget) → `found`.
4. **Gate:**
   - **`done` →** `markScrapedCleared(db, key, cycle_started_at)` (clears only rows
     not seen during the *entire* pass = genuinely removed warrants). Reset progress:
     `cursor = null`, `cycle_started_at = now`, `last_full_cycle_at = now`,
     `rows_this_cycle = 0`.
   - **not `done` (mid-cycle/truncated) →** persist `cursor = nextCursor`, increment
     `rows_this_cycle`, and **skip the clear-sweep entirely.**

`done: false` **is** the truncation signal propagating up from the adapter
(addresses the task's point about the adapter signalling truncation up to the leg).
The sweep is scoped to `cycle_started_at`, **not** the per-tick `runStartedAt`: a row
ingested in chunk 0 on day 1 (`last_seen_at` > `cycle_started_at`) survives the sweep
that fires when the pass finishes on day 5. Only rows whose `last_seen_at` predates
the *current* cycle get cleared.

This **replaces** both stale caps — the adapter's `offset < 50000` loop and the leg's
`MAX_FULL_LIST_HITS = 5000` slice. 5K becomes the per-tick *chunk budget*, not a
coverage ceiling. The one-shot `fetchAll` path keeps a modest safety cap (small
rosters only).

#### Fetch-error semantics (safe-direction failure)

If `fetchChunk`'s HTTP fetch fails mid-cycle, it returns
`{ hits: [], nextCursor: cursor, done: false }` — cursor **unchanged**, `done: false`.
The leg therefore neither sweeps nor advances: it retries the same window next tick.
This is critical — falsely declaring `done: true` on an error would clear-sweep
against `cycle_started_at` while most of the cycle's roster is not yet re-touched,
wrongly clearing ~100K still-valid warrants. A permanently broken source simply never
completes a cycle, so its clear-sweep never runs (stale rows linger rather than being
wrongly cleared) — the safe direction for officer-safety monitoring, consistent with
the registry's existing FAIL-OPEN policy.

### 4. Pagination mechanics

- **ArcGIS — keyset by OBJECTID** (robust to mid-cycle deletions, unlike offset):
  `where=OBJECTID>{cursor}&outFields=*&orderByFields=OBJECTID%20ASC&resultRecordCount=5000&f=json`.
  `cursor` = max OBJECTID in the returned page; `done` = short page
  (`features.length < PAGE && !exceededTransferLimit`). OBJECTID is always present in
  ArcGIS feature attributes.
- **Socrata — offset**, matching the existing `$order=:id` stable sort:
  `?$limit=5000&$offset={cursor}&$order=:id`. `cursor` = `offset + 5000`;
  `done` = `rows.length < PAGE`. (Offset paging at 5K steps is acceptable here;
  keyset on the opaque `:id` adds complexity for no real gain at this scale.)

### 5. Batched writes — `upsertScrapedWarrantsBatch`

New helper in [`store.ts`](../../../src/utils/warrantSources/store.ts). With the new
`UNIQUE INDEX` on `(source_key, warrant_id)` it can use batched
`INSERT ... ON CONFLICT(source_key, warrant_id) DO UPDATE SET ...` via D1 `batch()`
(`executeBatch`), reducing a 5K chunk from ~10,000 round-trips to a few dozen. The
per-row `upsertScrapedWarrant` stays for the per-person leg and as a fallback. The
unique index also turns the existing per-row `SELECT id ...` from a table scan into a
lookup as `scraped_warrants` grows past 250K rows.

### 6. Utah-first reorder

Move the Utah leg ahead of the full-list leg in `runAllSourceScans`. The header
comment notes the legs have "no correctness coupling"; this reorder is
resource-starvation defense-in-depth on top of the now-bounded 5K chunk budget. The
per-person scraped leg + reconcile/promote stays where it is; only the relative order
of the (now-bounded) full-list leg and the Utah leg changes.

## Migration `0110_warrant_source_chunking.sql`

```sql
-- 0110: chunked ingestion for large full-list warrant sources.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).

CREATE TABLE IF NOT EXISTS national_warrant_source_progress ( ... );  -- as above

-- NULL-safe dedup before the UNIQUE index (warrant_id is nullable; a NULL in a
-- NOT IN subquery would poison the predicate, so exclude NULL-keyed rows).
DELETE FROM scraped_warrants
 WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM scraped_warrants
      WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
      GROUP BY source_key, warrant_id
   );

-- Reuse the name 0067/baseline already created for this exact tuple, so this is a
-- no-op on live (and a safety-net if 0067 silently never landed there).
CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_src_wid
  ON scraped_warrants(source_key, warrant_id);

-- Re-enable Baton Rouge now that chunking makes its ~113K roster budget-safe.
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
```

Arlington is already `enabled = 1`; no change needed there — raising the caps is what
unlocks its full coverage.

## Testing

The existing fake-DB harness in
[`warrantFullList.test.ts`](../../../tests/warrantFullList.test.ts) records SQL
strings, so the cycle gate is testable without Miniflare. `runFullListLeg` gains an
optional injectable `now()` (like `runAllSourceScans`'s `delayMs`) for deterministic
timestamps.

- **Mid-cycle (`done: false`)** → cursor persisted; **no** `status='cleared'` SQL emitted.
- **Final chunk (`done: true`)** → clear-sweep fires, scoped to `cycle_started_at`;
  progress reset (cursor NULL, new cycle_started_at).
- **Resume** → second invocation reads the persisted cursor and calls `fetchChunk`
  with it.
- **Fetch error mid-cycle** → cursor unchanged, no sweep.
- **Budget cap** → a chunk larger than the budget is sliced.
- **Pure helpers** (arcgis keyset URL builder, socrata offset URL builder, cursor
  advance / `done` derivation) unit-tested directly.
- Small `fetchAll` adapters (FBI / Utah County) unaffected — existing tests stay green.

## Files touched

| File | Change |
|---|---|
| `src/utils/warrantSources/types.ts` | Add optional `fetchChunk` to `WarrantSourceAdapter` + its return type |
| `src/utils/warrantSources/configRegistry.ts` | Convert arcgis + socrata branches to `fetchChunk` (keyset / offset); remove the 50K / 1M internal caps |
| `src/utils/warrantSources/runScan.ts` | Chunked path + cycle gate in `runFullListLeg`; remove `MAX_FULL_LIST_HITS` slice for chunked adapters; Utah-first reorder; injectable `now()` |
| `src/utils/warrantSources/store.ts` | New `upsertScrapedWarrantsBatch` (batched ON CONFLICT upsert) |
| `migrations/0110_warrant_source_chunking.sql` | Progress table + dedup + UNIQUE index + re-enable Baton Rouge |
| `tests/warrantChunked.test.ts` (new) | Cycle-gate + resume + error + budget tests |
| `tests/warrantArcgis.test.ts` / `warrantSocrata.test.ts` | Extend for keyset/offset chunk URL + `done` derivation |

## Rollout

1. Merge via PR (pr-tests.yml: worker typecheck + client typecheck/tests/build).
2. After merge, **apply `0110` directly to live D1 `785de7ae`** and verify
   `pragma_table_info('national_warrant_source_progress')` + the unique index.
3. Verify true counts:
   `.../MapServer/9/query?where=1=1&returnCountOnly=true&f=json` (Arlington ≈ 148,503).
4. Observe over several 4-hourly ticks: `national_warrant_source_progress.cursor`
   advances; `rows_this_cycle` climbs; `last_full_cycle_at` sets on cycle completion;
   the Utah leg's `warrant_watch_runs` row keeps landing each tick (no starvation).
5. Bump `client/public/sw.js` `CACHE_NAME` only if any client file changes (this is
   Worker-only, so likely not needed).

## Risks & mitigations

- **Wrong-clear on error** → `fetchChunk` returns `done:false` on fetch failure
  (documented above); cycle never completes on a broken source.
- **Multi-day cycle latency** → acceptable for municipal rosters (they change slowly);
  5K/tick chosen explicitly over weeks-long conservative cadence.
- **Unique-index creation fails on existing dups** → idempotent dedup `DELETE` runs
  first in the same migration.
- **OBJECTID gaps/reordering on ArcGIS** → keyset `OBJECTID >` is monotonic and gap-safe.
