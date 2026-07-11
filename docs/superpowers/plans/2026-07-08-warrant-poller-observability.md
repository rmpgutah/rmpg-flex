# National Warrant Poller Observability & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every silent-failure path in the national (config-driven) warrant poller loud, give the A-F health grade the ability to tell "silently broken" from "quiet day," unify the two independently-computed "which sources are enabled" code paths, and close a data-integrity gap on `warrant_scraper_config`.

**Architecture:** A `degraded` boolean (plus a short machine-readable reason string) is threaded through the adapter contract (`ChunkResult` / `fetchAll` return shape) → the scan orchestrator's per-source summary → a new `scraper_runs.degraded` column, where it folds into the existing `success` bit so `computeHealthGrade` needs no changes. A cron-level sentinel row covers total-orchestrator crashes. The `/national-coverage` route is repointed at the same `getAllEnabledAdapters()` the real scan uses instead of its own hand-rolled computation.

**Tech Stack:** Cloudflare Workers (Hono), D1 (SQLite), TypeScript, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-08-warrant-poller-observability-design.md`](../specs/2026-07-08-warrant-poller-observability-design.md)

---

### Task 1: Migration — `scraper_runs.degraded` column + `warrant_scraper_config` unique index

**Files:**
- Create: `migrations/0179_scraper_runs_degraded.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0179_scraper_runs_degraded.sql
-- Adds a `degraded` signal to scraper_runs so health grading can tell "this
-- source silently returned nothing after an error" apart from "this source
-- is genuinely quiet today." Also closes a real data-integrity gap: nothing
-- has ever enforced uniqueness on warrant_scraper_config.source_name (see
-- migrations/0067_seed_multi_source_scrapers.sql's own comment about this).

ALTER TABLE scraper_runs ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;

-- Dedupe any existing collisions first (keep the lowest rowid per name),
-- then enforce uniqueness going forward via a unique index — D1/SQLite can't
-- add a column-level UNIQUE constraint to an existing table via ALTER TABLE.
DELETE FROM warrant_scraper_config
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM warrant_scraper_config GROUP BY source_name
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warrant_scraper_config_source_name
  ON warrant_scraper_config(source_name);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Then: `wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(scraper_runs)"`
Expected: a `degraded` column appears (type INTEGER, notnull=1, dflt_value=0).

Then: `wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='warrant_scraper_config'"`
Expected: `idx_warrant_scraper_config_source_name` is listed.

- [ ] **Step 3: Commit**

```bash
git add migrations/0179_scraper_runs_degraded.sql
git commit -m "feat(migrations): add scraper_runs.degraded column + warrant_scraper_config unique index"
```

---

### Task 2: Extend the adapter contract with a `degraded` signal

**Files:**
- Modify: `src/utils/warrantSources/types.ts:44-59`
- Test: `tests/warrantConfigRegistry.test.ts` (extended in Task 3)

- [ ] **Step 1: Update `ChunkResult` and `fetchAll`'s return type**

In `src/utils/warrantSources/types.ts`, replace lines 43-59:

```ts
/** One bounded window of a full-list roster, plus the cursor to resume from. */
export interface ChunkResult {
  hits: RawWarrantHit[];
  nextCursor: string | null;   // opaque resume token (arcgis: last OBJECTID; socrata: next offset)
  done: boolean;               // true = roster fully traversed this pass
  /** True if this fetch caught an error (bad HTTP status, thrown fetch/parse) and
   *  degraded to partial/empty data instead of throwing. Distinct from `errors`
   *  bookkeeping upstream — this is the adapter-level signal that something is
   *  wrong even though it chose not to abort the batch. */
  degraded?: boolean;
  /** Short machine-readable reason, e.g. "http_500", "fetch_threw", "no_text_layer". */
  degradedReason?: string;
}

/** Result of a non-chunked full-list fetch (fetchAll). */
export interface FullListResult {
  hits: RawWarrantHit[];
  degraded?: boolean;
  degradedReason?: string;
}

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  mode: SourceMode;
  fetchAll?(env: { DB: D1Database } & Record<string, unknown>): Promise<FullListResult>;
  /** Chunked full-list fetch: return one window starting after `cursor` (null = start). */
  fetchChunk?(
    cursor: string | null,
    env: { DB: D1Database } & Record<string, unknown>,
  ): Promise<ChunkResult>;
  fetchForPerson?(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
```

- [ ] **Step 2: Typecheck (expect failures — call sites not updated yet)**

Run: `npm run typecheck`
Expected: FAIL — `src/utils/warrantSources/adapters/fbi.ts`, `src/utils/warrantSources/adapters/utahCounty.ts`, `src/utils/warrantSources/configRegistry.ts`, and `src/utils/warrantSources/runScan.ts` all now have a type mismatch on `fetchAll`'s return value. This is expected; fixed in Tasks 3-5.

- [ ] **Step 3: Commit**

```bash
git add src/utils/warrantSources/types.ts
git commit -m "feat(warrants): add degraded signal + FullListResult type to adapter contract"
```

---

### Task 3: `configRegistry.ts` — degraded signal, unmatched-family logging, fail-closed logging

**Files:**
- Modify: `src/utils/warrantSources/configRegistry.ts`
- Test: `tests/warrantConfigRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/warrantConfigRegistry.test.ts` (before the final closing of the outer `describe` block, i.e. after the existing 4 `it`s inside `describe('configRegistry — PDF families', ...)`, add a new top-level `describe`):

```ts
describe('configRegistry — degraded signal', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  it('marks socrata degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 500 })) as any;
    const rows = [{ ...baseRow, source_key: 's', family: 'socrata', format: 'socrata', base_url: 'data.test', resource_id: 'r' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_500');
  });

  it('marks socrata degraded when fetch throws', async () => {
    global.fetch = (async () => { throw new Error('network down'); }) as any;
    const rows = [{ ...baseRow, source_key: 's', family: 'socrata', format: 'socrata', base_url: 'data.test', resource_id: 'r' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('fetch_threw');
  });

  it('marks arcgis degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 503 })) as any;
    const rows = [{ ...baseRow, source_key: 'a', family: 'arcgis', format: 'arcgis', base_url: 'https://gis.test/MapServer/0' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchChunk!(null, { DB: fakeDb(rows) } as any);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_503');
  });

  it('marks pdf family degraded when there is no text layer', async () => {
    global.fetch = (async () => ({ ok: false, status: 404 })) as any;
    const rows = [{ ...baseRow, source_key: 'p', family: 'pdf-zuercher', format: 'pdf', base_url: 'https://example.test/z.pdf' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchAll!({ DB: fakeDb(rows) } as any);
    expect(result.hits).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('no_text_layer');
  });

  it('marks text family (xml/csv) degraded on non-OK HTTP', async () => {
    global.fetch = (async () => ({ ok: false, status: 403 })) as any;
    const rows = [{ ...baseRow, source_key: 'x', family: 'xml-bonner', format: 'xml', base_url: 'https://example.test/w.xml' }];
    const [adapter] = await getConfigAdapters(fakeDb(rows));
    const result = await adapter.fetchAll!({ DB: fakeDb(rows) } as any);
    expect(result.hits).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('http_403');
  });

  it('logs a warning and returns null for an unmatched family', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = [{ ...baseRow, source_key: 'mystery', family: 'mystery-family', format: 'pdf', base_url: 'https://x.test/a.pdf' }];
    const adapters = await getConfigAdapters(fakeDb(rows));
    expect(adapters.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mystery'), expect.stringContaining('mystery-family'));
    warnSpy.mockRestore();
  });

  it('logs a warning when the national_warrant_sources query throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingDb: any = { prepare() { return { bind() { return this; }, async all() { throw new Error('table missing'); } }; } };
    const adapters = await getConfigAdapters(throwingDb);
    expect(adapters).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

Add `afterEach, vi` to the top import: change line 1 to:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/warrantConfigRegistry.test.ts`
Expected: FAIL — `result.degraded` is `undefined` on every new test; the "unmatched family" and "query throws" tests fail because no `console.warn` is called yet.

- [ ] **Step 3: Implement — rewrite `makeAdapter` and `getConfigAdapters`**

Replace `src/utils/warrantSources/configRegistry.ts` lines 46-142 (from the `makeAdapter` doc comment through the end of the file) with:

```ts
/** Build a full-list adapter from a config row for a config-driven family. Returns null for families not handled here (pdf/p2c land in later PRs). */
function makeAdapter(row: SourceRow): WarrantSourceAdapter | null {
  const map = safeMap(row.field_map);
  const meta = {
    key: row.source_key, display_name: row.display_name, state: row.state ?? 'US',
    county: row.jurisdiction, source_url: row.base_url ?? '', kind: (row.format as SourceKind),
    priority: ((row.priority as 1 | 2 | 3 | 4) || 3), family: row.family, category: (row.kind as WarrantCategory),
  };
  if (row.family === 'socrata') {
    return { meta, mode: 'full-list', async fetchChunk(cursor: string | null): Promise<ChunkResult> {
      const offset = cursor ? Number(cursor) : 0;
      try {
        const url = buildSocrataOffsetUrl(row.base_url ?? '', row.resource_id ?? '', offset, CHUNK_TARGET);
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          // error → retry same page, no sweep. Log so a persistently-failing
          // source isn't a silent stall (cursor stuck with errors:0 in the summary).
          console.warn(`[warrantSources.config] ${row.source_key} socrata fetch HTTP ${res.status} at offset ${offset}; retrying next tick`);
          return { hits: [], nextCursor: cursor, done: false, degraded: true, degradedReason: `http_${res.status}` };
        }
        const rows = (await res.json()) as Record<string, unknown>[];
        return {
          hits: parseSocrata(rows, map, row.source_key),
          nextCursor: String(offset + CHUNK_TARGET),
          done: rows.length < CHUNK_TARGET,   // raw row count, NOT deduped hits
        };
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} socrata fetch threw at offset ${offset}:`, err instanceof Error ? err.message : String(err));
        return { hits: [], nextCursor: cursor, done: false, degraded: true, degradedReason: 'fetch_threw' };
      }
    } };
  }
  if (row.family === 'arcgis') {
    return { meta, mode: 'full-list', async fetchChunk(cursor: string | null): Promise<ChunkResult> {
      const startOid = cursor ? Number(cursor) : 0;
      const hits: RawWarrantHit[] = [];
      let lastOid = startOid;
      try {
        // Loop ≤2000-row keyset pages until we cross the soft budget at a page
        // boundary, or the roster is exhausted (short page). A failed page mid-loop
        // returns what we have with done=false so the leg retries from lastOid.
        while (hits.length < CHUNK_TARGET) {
          const url = buildArcgisKeysetUrl(row.base_url ?? '', lastOid, ARCGIS_SERVER_PAGE);
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            // keep what we have, retry from lastOid next tick. Log so a
            // persistently-failing source isn't a silent stall.
            console.warn(`[warrantSources.config] ${row.source_key} arcgis fetch HTTP ${res.status} after OBJECTID ${lastOid}; retrying next tick`);
            return { hits, nextCursor: String(lastOid), done: false, degraded: true, degradedReason: `http_${res.status}` };
          }
          const body = (await res.json()) as { features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
          const features = body.features ?? [];
          if (features.length === 0) return { hits, nextCursor: String(lastOid), done: true };
          hits.push(...parseArcgis(body, map, row.source_key));
          const prevOid = lastOid;
          lastOid = maxObjectId(features, lastOid);
          // Defensive: a non-empty page that fails to advance the cursor (features
          // with missing/NaN OBJECTID) would otherwise re-fetch the same window
          // forever and hit the Worker CPU limit. Break instead — done:false (via
          // the post-loop return) leaves the cursor put so the leg retries next tick.
          if (lastOid <= prevOid) break;
          if (!arcgisHasMore(body, ARCGIS_SERVER_PAGE)) return { hits, nextCursor: String(lastOid), done: true };
        }
        return { hits, nextCursor: String(lastOid), done: false };
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} arcgis fetch threw after OBJECTID ${lastOid}:`, err instanceof Error ? err.message : String(err));
        return { hits, nextCursor: String(lastOid), done: false, degraded: true, degradedReason: 'fetch_threw' };
      }
    } };
  }
  const pdf = PDF_FAMILIES[row.family];
  if (pdf) {
    return { meta, mode: 'full-list', async fetchAll(): Promise<FullListResult> {
      const text = await fetchPdfText(row.base_url ?? '', { lines: pdf.lines });
      if (!text) {
        console.warn(`[warrantSources.config] ${row.source_key} pdf fetch returned no text layer (404 or unreadable PDF)`);
        return { hits: [], degraded: true, degradedReason: 'no_text_layer' };  // URL 404'd / no text layer — degrade gracefully, don't throw
      }
      try {
        return { hits: pdf.parse(text, row.source_key, row.state ?? 'US') };
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} pdf parse threw:`, err instanceof Error ? err.message : String(err));
        return { hits: [], degraded: true, degradedReason: 'pdf_parse_threw' };
      }
    } };
  }
  const textParser = TEXT_FAMILIES[row.family];
  if (textParser) {
    return { meta, mode: 'full-list', async fetchAll(): Promise<FullListResult> {
      try {
        const res = await fetch(row.base_url ?? '', { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' } });
        if (!res.ok) {
          console.warn(`[warrantSources.config] ${row.source_key} text-family fetch HTTP ${res.status}`);
          return { hits: [], degraded: true, degradedReason: `http_${res.status}` };  // 404/403 — degrade gracefully
        }
        return { hits: textParser(await res.text(), row.source_key, row.state ?? 'US') };
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} text-family fetch threw:`, err instanceof Error ? err.message : String(err));
        return { hits: [], degraded: true, degradedReason: 'fetch_threw' };
      }
    } };
  }
  console.warn(`[warrantSources.config] ${row.source_key} has unmatched family "${row.family}" — no adapter built, source is silently excluded from scans`);
  return null;
}

/** Adapters built from enabled national_warrant_sources rows (config-driven families). */
export async function getConfigAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  let rows: SourceRow[] = [];
  try {
    rows = await query<SourceRow>(db, 'SELECT * FROM national_warrant_sources WHERE enabled = 1');
  } catch (err) {
    // Fail CLOSED (not open, unlike getEnabledAdapters — see registry.ts): a
    // stale/wrong code-adapter list from a DB error is worse than dropping the
    // config-driven national sources for one tick. Must still be LOUD.
    console.warn('[warrantSources.config] national_warrant_sources query failed, failing closed to no config-driven adapters:', err instanceof Error ? err.message : String(err));
    return [];
  }
  return rows.map(makeAdapter).filter((a): a is WarrantSourceAdapter => a !== null);
}
```

Also update the import line (line 2) to add `FullListResult`:

```ts
import type { WarrantSourceAdapter, RawWarrantHit, SourceKind, WarrantCategory, ChunkResult, FullListResult } from './types';
```

- [ ] **Step 4: Update the existing "skips unknown families" test to not assert on console output**

The existing test at `tests/warrantConfigRegistry.test.ts` (`it('skips unknown families (returns no adapter)', ...)`) will now also emit a `console.warn`. It doesn't assert on `console.warn`, so it still passes unchanged — no edit needed. Confirm by running the full file (next step).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/warrantConfigRegistry.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/warrantSources/configRegistry.ts tests/warrantConfigRegistry.test.ts
git commit -m "feat(warrants): surface degraded/unmatched-family/fail-closed signals in configRegistry"
```

---

### Task 4: Update `fbi.ts` and `utahCounty.ts` adapters to the new `fetchAll` return shape

**Files:**
- Modify: `src/utils/warrantSources/adapters/fbi.ts:84-87`
- Modify: `src/utils/warrantSources/adapters/utahCounty.ts:46-54`
- Test: `tests/warrantFbi.test.ts`

- [ ] **Step 1: Check the existing FBI test's assertions on `fetchAll`'s return shape**

Run: `grep -n "fetchAll" tests/warrantFbi.test.ts`

If it asserts `await adapter.fetchAll(...)` is directly an array (e.g. `expect(hits.length)` or `expect(hits[0])` without `.hits`), those assertions need `.hits` inserted. Read the file's exact usage before editing (do this as part of Step 1) and adjust the test in Step 4 below to match whatever pattern is present — e.g. if the test does `const hits = await adapter.fetchAll(env); expect(hits).toHaveLength(2);`, change to `const { hits } = await adapter.fetchAll(env); expect(hits).toHaveLength(2);`.

- [ ] **Step 2: Update `fbi.ts`**

In `src/utils/warrantSources/adapters/fbi.ts`, replace the `fetchAll` method (around line 84-87):

```ts
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<FullListResult> {
    const items = await fetchList();
    return { hits: items.map(normalizeFbiItem).filter((h) => h.warrant_id) };
  },
```

Add `FullListResult` to the type import at the top of the file (find the existing `import type { ... } from '../types'` line and add `FullListResult` to the named imports).

- [ ] **Step 3: Update `utahCounty.ts`**

In `src/utils/warrantSources/adapters/utahCounty.ts`, replace the `fetchAll` method (around line 46-54):

```ts
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<FullListResult> {
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) return { hits: [], degraded: true, degradedReason: `http_${res.status}` };
      const body = (await res.json()) as unknown;
      return { hits: (Array.isArray(body) ? body : []).map(normalizeUtahCountyItem).filter((h) => h.warrant_id) };
    } catch {
      return { hits: [], degraded: true, degradedReason: 'fetch_threw' };
    }
  },
```

Add `FullListResult` to the type import at the top of the file.

- [ ] **Step 4: Fix any existing test assertions per Step 1's findings**

Apply the `.hits` adjustment identified in Step 1 to `tests/warrantFbi.test.ts` (and `tests/warrantFullList.test.ts` if it also exercises these two adapters' `fetchAll` directly — check with `grep -n "fetchAll" tests/warrantFullList.test.ts` first).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors referencing `fbi.ts` or `utahCounty.ts` anymore (errors in `runScan.ts` still expected — fixed in Task 5).

- [ ] **Step 6: Run the affected tests**

Run: `npx vitest run tests/warrantFbi.test.ts tests/warrantFullList.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/warrantSources/adapters/fbi.ts src/utils/warrantSources/adapters/utahCounty.ts tests/warrantFbi.test.ts tests/warrantFullList.test.ts
git commit -m "feat(warrants): migrate fbi/utahCounty adapters to FullListResult return shape"
```

---

### Task 5: `runScan.ts` — consume the new `fetchAll`/`fetchChunk` shape, aggregate `degraded`, remove dead import

**Files:**
- Modify: `src/utils/warrantSources/runScan.ts:31, 53-58, 210-319`
- Test: `tests/warrantChunked.test.ts`, `tests/warrantFullList.test.ts`

- [ ] **Step 1: Remove the dead `getEnabledAdapters` import**

In `src/utils/warrantSources/runScan.ts` line 31, change:

```ts
import { getEnabledAdapters, getAllEnabledAdapters } from './registry';
```

to:

```ts
import { getAllEnabledAdapters } from './registry';
```

- [ ] **Step 2: Add `degraded` to `ScrapedSourceSummary`**

Around line 53-58, change:

```ts
export interface ScrapedSourceSummary {
  source_key: string;
  checked: number;
  found: number;
  cleared: number;
  errors: number;
}
```

to:

```ts
export interface ScrapedSourceSummary {
  source_key: string;
  checked: number;
  found: number;
  cleared: number;
  errors: number;
  degraded: boolean;
}
```

- [ ] **Step 3: Write failing tests for degraded propagation**

Check the mocking pattern first: `grep -n "fetchChunk\|fetchAll" tests/warrantChunked.test.ts tests/warrantFullList.test.ts` to see how these tests construct fake adapters, then add two new `it` blocks matching that same pattern:

In `tests/warrantChunked.test.ts`, add a test asserting that when a fake adapter's `fetchChunk` resolves `{ hits: [], nextCursor: null, done: false, degraded: true, degradedReason: 'http_500' }`, the returned `ScrapedSourceSummary` for that source has `degraded: true`.

In `tests/warrantFullList.test.ts`, add a test asserting that when a fake adapter's `fetchAll` resolves `{ hits: [], degraded: true, degradedReason: 'fetch_threw' }`, the returned `ScrapedSourceSummary` has `degraded: true`. Also add a test confirming a normal successful `fetchAll` (`{ hits: [...] }`, no `degraded` key) produces `degraded: false` in the summary.

Write these using the exact fake-adapter construction style already present in each file (read the file's existing `it` blocks immediately before writing to match variable names/helpers).

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/warrantChunked.test.ts tests/warrantFullList.test.ts`
Expected: FAIL — `runScan.ts` doesn't compile yet (Step 2's type addition isn't populated) or `degraded` is `undefined` on the summary.

- [ ] **Step 5: Update the chunked-path leg (lines ~210-269)**

Replace the body of the chunked-path `if` block in `runFullListLeg` (starting at `if (typeof adapter.fetchChunk === 'function') {` through its `continue;`) so that `degraded` is captured and pushed:

```ts
    if (typeof adapter.fetchChunk === 'function') {
      const key = adapter.meta.key;
      let found = 0;
      let errors = 0;
      let cleared = 0;
      let degraded = false;
      try {
        const prog = await readSourceProgress(db, key);
        const cycleStartedAt = prog?.cycle_started_at ?? now();
        const cursor = prog?.cursor ?? null;

        const { hits, nextCursor, done, degraded: chunkDegraded } = await adapter.fetchChunk(cursor, { DB: db });
        degraded = chunkDegraded ?? false;
        const r = await upsertScrapedWarrantsBatch(db, hits, null);
        found = r.found;
        errors += r.errors;

        if (errors > 0) {
          // Writes were unreliable this tick. NEVER clear-sweep when we couldn't
          // store reliably — a sweep here would clear active warrants that merely
          // failed to re-store (the feature's #1 invariant: never wrongly clear).
          // Don't advance past the failed window either: persist the SAME incoming
          // cursor so the next tick retries it. The batched upsert is idempotent
          // (ON CONFLICT), so re-running the window is safe.
          await saveSourceProgress(db, key, cursor, cycleStartedAt, (prog?.rows_this_cycle ?? 0) + found);
        } else if (done) {
          // Full pass complete → clear rows of THIS source not seen during the
          // entire cycle (scoped to cycle_started_at, NOT this tick), then reset.
          cleared = await markScrapedCleared(db, key, cycleStartedAt).catch((err) => {
            console.warn(`[warrantSources.runScan.chunk] ${key} clear sweep failed:`, err instanceof Error ? err.message : String(err));
            return 0;
          });
          // Guard separately so a completion failure logs accurately (not as a
          // misleading "fetchChunk failed" in the outer catch) and doesn't inflate
          // the error count — the sweep is idempotent, so the next tick re-completes.
          await completeSourceCycle(db, key, now()).catch((err) => {
            console.warn(`[warrantSources.runScan.chunk] ${key} completeSourceCycle failed:`, err instanceof Error ? err.message : String(err));
          });
        } else {
          // Mid-cycle / truncated → persist cursor, SKIP the clear-sweep so the
          // un-ingested tail (and prior chunks) are never wrongly cleared.
          await saveSourceProgress(db, key, nextCursor, cycleStartedAt, (prog?.rows_this_cycle ?? 0) + found);
        }
      } catch (err) {
        errors++;
        console.warn(`[warrantSources.runScan.chunk] ${key} chunk tick failed:`, err instanceof Error ? err.message : String(err));
      }
      // checked:0 — the chunked leg walks the REMOTE roster, not the local persons
      // list, so the per-person 'checked' metric doesn't apply here.
      out.push({ source_key: key, checked: 0, found, cleared, errors, degraded });
      continue;
    }
```

- [ ] **Step 6: Update the `fetchAll` path (lines ~272-317)**

Replace the remainder of the `for` loop body (from `if (typeof adapter.fetchAll !== 'function') continue;` through its `out.push(...)`):

```ts
    if (typeof adapter.fetchAll !== 'function') continue;
    const runStartedAt = new Date().toISOString();
    let found = 0;
    let errors = 0;
    let cleared = 0;
    let degraded = false;
    try {
      const { hits, degraded: fetchDegraded } = await adapter.fetchAll({ DB: db });
      degraded = fetchDegraded ?? false;
      const MAX_FULL_LIST_HITS = 200000;  // raised: batched ingest handles large rosters efficiently
      const truncated = hits.length > MAX_FULL_LIST_HITS;
      const toStore = truncated ? hits.slice(0, MAX_FULL_LIST_HITS) : hits;
      if (truncated) {
        console.warn(`[warrantSources] ${adapter.meta.key} returned ${hits.length} hits; capping to ${MAX_FULL_LIST_HITS} this run.`);
      }
      try {
        found = await bulkUpsertScrapedWarrants(db, adapter.meta.key, toStore);
      } catch (err) {
        errors++;
        console.warn(
          `[warrantSources.runScan.fullList] ${adapter.meta.key} bulk upsert failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      // Clear-sweep ONLY on a clean, non-empty, NON-TRUNCATED ingest. A failed/empty fetch
      // must NOT wipe a source's active warrants (a transient hiccup would otherwise mark real
      // warrants 'cleared' — the worst false-negative for a warrant system). And on a truncated
      // roster the un-ingested tail (rows beyond the cap) wasn't refreshed this run, so sweeping
      // would wrongly clear those still-valid warrants — skip the sweep until the source fits.
      if (errors === 0 && found > 0 && !truncated) {
        cleared = await markScrapedCleared(db, adapter.meta.key, runStartedAt).catch((err) => {
          console.warn(
            `[warrantSources.runScan.fullList] ${adapter.meta.key} clear sweep failed:`,
            err instanceof Error ? err.message : String(err),
          );
          return 0;
        });
      }
    } catch (err) {
      // fetchAll itself threw — count as a single adapter-level error.
      errors++;
      console.warn(
        `[warrantSources.runScan.fullList] ${adapter.meta.key} fetchAll failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    out.push({ source_key: adapter.meta.key, checked: 0, found, cleared, errors, degraded });
  }
  return out;
}
```

- [ ] **Step 7: Fix any other `out.push`/`ScrapedSourceSummary` construction sites in the file**

Run: `grep -n "ScrapedSourceSummary\|scraped.push\|out.push" src/utils/warrantSources/runScan.ts`

The per-person leg (around line 369-460, building `summary` objects pushed via `scraped.push(summary)`) also constructs `ScrapedSourceSummary`-shaped objects. Since `degraded` is now a required field on the interface, add `degraded: false` to that object literal (the per-person leg doesn't use `fetchAll`/`fetchChunk`, so it has no degraded signal to report — it's simply never degraded by this feature's definition). Find the `summary` object initialization (around line 385-391, the block ending `errors: 0,`) and add `degraded: false,` as the next line.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no more type errors anywhere in `warrantSources/`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/warrantChunked.test.ts tests/warrantFullList.test.ts tests/warrantsSearchAll.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full warrant test suite as a regression check**

Run: `npx vitest run tests/warrant*.test.ts`
Expected: PASS (all files).

- [ ] **Step 11: Commit**

```bash
git add src/utils/warrantSources/runScan.ts tests/warrantChunked.test.ts tests/warrantFullList.test.ts
git commit -m "feat(warrants): propagate degraded signal through runScan, drop dead import"
```

---

### Task 6: `logScanResult.ts` — persist `degraded`, fold into `success`

**Files:**
- Modify: `src/utils/warrantSources/logScanResult.ts`
- Modify: `src/routes/scrapers.ts` (call site — verify backward compatibility, no edit expected)
- Test: `tests/logScanResult.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/logScanResult.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { insertScraperRunRow, logScanResult } from '../src/utils/warrantSources/logScanResult';
import type { AllSourceScanResult } from '../src/utils/warrantSources/runScan';

/** Fake D1 that records every bound INSERT so we can assert on the `success`/`degraded` values written. */
function fakeDb() {
  const inserts: unknown[][] = [];
  const db: any = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          inserts.push(args);
          return this;
        },
        async run() { return {}; },
      };
    },
  };
  return { db, inserts };
}

describe('insertScraperRunRow', () => {
  it('writes success=1 when errors=0 and not degraded', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 2, cleared: 0, errors: 0 }, 'cron', false);
    // Column order: source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger, degraded
    expect(inserts[0][3]).toBe(1);
    expect(inserts[0][9]).toBe(0);
  });

  it('writes success=0 when degraded=true even with errors=0', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 0, cleared: 0, errors: 0 }, 'cron', true);
    expect(inserts[0][3]).toBe(0);
    expect(inserts[0][9]).toBe(1);
  });

  it('writes success=0 when errors>0', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 0, cleared: 0, errors: 2 }, 'cron', false);
    expect(inserts[0][3]).toBe(0);
  });

  it('defaults degraded to false when omitted (manual-trigger call sites)', async () => {
    const { db, inserts } = fakeDb();
    await insertScraperRunRow(db, 'src-a', { checked: 1, found: 1, cleared: 0, errors: 0 }, 'manual');
    expect(inserts[0][3]).toBe(1);
    expect(inserts[0][9]).toBe(0);
  });
});

describe('logScanResult', () => {
  it('passes each scraped source summary\'s degraded flag through to its row', async () => {
    const { db, inserts } = fakeDb();
    const result: AllSourceScanResult = {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 1, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'src-a', checked: 0, found: 0, cleared: 0, errors: 0, degraded: true },
        { source_key: 'src-b', checked: 0, found: 3, cleared: 0, errors: 0, degraded: false },
      ],
    } as AllSourceScanResult;
    await logScanResult(db, result, 'cron');
    const bySourceKey = Object.fromEntries(inserts.map((args) => [args[0], args]));
    expect(bySourceKey['src-a'][3]).toBe(0);  // degraded → success=0
    expect(bySourceKey['src-b'][3]).toBe(1);  // clean → success=1
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/logScanResult.test.ts`
Expected: FAIL — `insertScraperRunRow` doesn't accept a 5th `degraded` parameter yet, and the INSERT doesn't include a `degraded` column.

- [ ] **Step 3: Implement**

Replace `src/utils/warrantSources/logScanResult.ts` in full:

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { execute } from '../db';
import type { AllSourceScanResult } from './runScan';

/**
 * Single-row scraper_runs INSERT shared by the cron path (logScanResult,
 * below) and the manual-trigger path (logManualRun in src/routes/scrapers.ts)
 * so the two callers can't drift out of sync on column list/order or the
 * success-derivation rule.
 *
 * `degraded` defaults to false so existing manual-trigger call sites (which
 * don't have a per-adapter degraded signal to report) keep compiling and
 * behaving exactly as before.
 */
export function insertScraperRunRow(
  db: D1Database,
  sourceKey: string,
  counts: { checked: number; found: number; cleared: number; errors: number },
  trigger: 'cron' | 'manual',
  degraded = false,
): Promise<unknown> {
  const now = new Date().toISOString();
  // success=1 only when the run had zero errors AND wasn't degraded — a source
  // that caught a fetch/parse failure and quietly returned an empty result set
  // must not still grade as a clean success (see healthGrade.ts).
  const success = counts.errors === 0 && !degraded ? 1 : 0;
  return execute(
    db,
    `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger, degraded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceKey, now, now, success,
    counts.checked, counts.found, counts.cleared, counts.errors, trigger, degraded ? 1 : 0,
  );
}

/**
 * Writes one scraper_runs row for the Utah leg plus one per scraped source,
 * from the result of runAllSourceScans(). Used by the cron sweep (which
 * genuinely has both a Utah result AND a scraped-source array from one
 * call to runAllSourceScans).
 */
export async function logScanResult(
  db: D1Database,
  result: AllSourceScanResult,
  trigger: 'cron' | 'manual',
): Promise<void> {
  const inserts = [
    insertScraperRunRow(db, 'utah-warrant-watch', {
      checked: result.utah.persons_checked,
      found: result.utah.new_warrants_found,
      cleared: result.utah.warrants_cleared,
      errors: result.utah.errors,
    }, trigger, false),
    ...result.scraped.map((s) =>
      insertScraperRunRow(db, s.source_key, {
        checked: s.checked, found: s.found, cleared: s.cleared, errors: s.errors,
      }, trigger, s.degraded),
    ),
  ];

  // Each row insert is independent — one bad row (transient D1 error) must
  // not prevent the rest of the sources' scraper_runs history from being
  // recorded, since that history is the sole input to health grading.
  const results = await Promise.allSettled(inserts);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const sourceKey = i === 0 ? 'utah-warrant-watch' : result.scraped[i - 1].source_key;
      console.error(`scraper_runs insert failed for ${sourceKey}:`, r.reason);
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logScanResult.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression-check the manual-trigger call sites in `src/routes/scrapers.ts`**

Run: `grep -n "insertScraperRunRow\|logManualRun" src/routes/scrapers.ts`

Confirm every call passes exactly 4 args (`db, sourceKey, counts, trigger`) — the new 5th `degraded` param has a default, so these compile unchanged. No edits needed; this step is a verification, not a modification. If any call site unexpectedly already passes a 5th argument, stop and re-read that call site before proceeding (would indicate a merge conflict with unrelated work, not something this plan anticipated).

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/warrantSources/logScanResult.ts tests/logScanResult.test.ts
git commit -m "feat(warrants): fold degraded into scraper_runs.success, add degraded column write"
```

---

### Task 7: `src/index.ts` cron — sentinel row on total-orchestrator failure

**Files:**
- Modify: `src/index.ts:191-207`
- Test: `test-workers/warrantCronFailure.test.ts` (new file)

- [ ] **Step 1: Read the existing Miniflare test setup pattern**

Run: `sed -n '1,40p' test-workers/warrantsNationalCoverage.test.ts` (or similarly-named existing file) to copy the exact D1/env bootstrap pattern used by `test-workers/` tests (they use `vitest.workers.config.mts` with Miniflare bindings, distinct from the plain-Node `tests/` directory).

- [ ] **Step 2: Write the failing test**

Create `test-workers/warrantCronFailure.test.ts`, matching the import/setup style found in Step 1 (adjust binding setup to match exactly — the sketch below assumes `env.DB` is a real Miniflare D1 binding with the `scraper_runs` table already migrated in, which should already be true given how the existing `test-workers/` suite bootstraps):

```ts
import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

describe('cron: warrant scan orchestrator failure', () => {
  it('inserts a __scan_orchestrator__ scraper_runs row when runAllSourceScans throws', async () => {
    vi.doMock('../src/utils/warrantSources/runScan', () => ({
      runAllSourceScans: vi.fn().mockRejectedValue(new Error('boom')),
    }));

    const env = getMiniflareBindings(); // replace with this repo's actual helper, per Step 1's findings
    const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} } as any;

    await worker.scheduled({ cron: '0 */4 * * *' } as any, env, ctx);

    const row = await env.DB.prepare(
      `SELECT * FROM scraper_runs WHERE source_key = '__scan_orchestrator__' ORDER BY started_at DESC LIMIT 1`,
    ).first();
    expect(row).toBeTruthy();
    expect(row.success).toBe(0);
    expect(row.errors).toBe(1);

    vi.doUnmock('../src/utils/warrantSources/runScan');
  });
});
```

Note for the implementer: this test uses `vi.doMock` on a dynamically-`import()`ed module, which is fragile with Miniflare's isolated module registry. If `vi.doMock` doesn't intercept the dynamic import in this repo's Miniflare setup (check by running it — see Step 3), fall back to a simpler unit-level test instead: extract the sentinel-row-insertion logic into a small named function first (see Step 4's `logOrchestratorFailure` helper) and test *that* function directly with a fake D1, exactly like Task 6's `fakeDb()` pattern, rather than trying to trigger it through the full `scheduled()` handler. Prefer the extracted-function approach if there's any doubt — it's more reliable and still proves the behavior.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantCronFailure.test.ts`
Expected: FAIL (either on the assertion, since the sentinel row doesn't exist yet, or on the mock not being wired — resolve per Step 2's fallback note before proceeding).

- [ ] **Step 4: Implement — extract a small named helper and call it from the cron handler**

In `src/utils/warrantSources/logScanResult.ts`, add a new exported function (after `insertScraperRunRow`, before `logScanResult`):

```ts
/**
 * Records a total-orchestrator-failure row (runAllSourceScans itself threw,
 * not a per-source error) so a full scan crash shows up in scraper_runs /
 * health-grade history instead of vanishing into console.error only.
 */
export function logOrchestratorFailure(db: D1Database, trigger: 'cron' | 'manual', err: unknown): Promise<unknown> {
  console.error('Warrant source scheduled scan failed:', err);
  return insertScraperRunRow(db, '__scan_orchestrator__', { checked: 0, found: 0, cleared: 0, errors: 1 }, trigger, false)
    .catch((insertErr) => console.error('__scan_orchestrator__ scraper_runs insert failed:', insertErr));
}
```

In `src/index.ts`, replace lines 194-203:

```ts
      ctx.waitUntil(
        import('./utils/warrantSources/runScan').then((m) =>
          m.runAllSourceScans(env.DB).then((result) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logScanResult(env.DB, result, 'cron').catch((err) =>
                console.error('scraper_runs logging failed:', err),
              ),
            ),
          ).catch((err) => {
            console.error('Warrant source scheduled scan failed:', err);
          }),
        ).catch(() => {}),
      );
```

with:

```ts
      ctx.waitUntil(
        import('./utils/warrantSources/runScan').then((m) =>
          m.runAllSourceScans(env.DB).then((result) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logScanResult(env.DB, result, 'cron').catch((err) =>
                console.error('scraper_runs logging failed:', err),
              ),
            ),
          ).catch((err) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logOrchestratorFailure(env.DB, 'cron', err),
            ),
          ),
        ).catch(() => {}),
      );
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantCronFailure.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full Miniflare + Node suites as a regression check**

Run: `npm run typecheck && npx vitest run --config vitest.workers.config.mts && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/utils/warrantSources/logScanResult.ts test-workers/warrantCronFailure.test.ts
git commit -m "feat(warrants): persist a scraper_runs sentinel row on total orchestrator failure"
```

---

### Task 8: `/national-coverage` route — use `getAllEnabledAdapters` as the single source of truth

**Files:**
- Modify: `src/routes/warrants.ts:11, 316-334`
- Test: `tests/warrantsSearchAll.test.ts` or `test-workers/warrantsNationalCoverage.test.ts` (whichever already covers this route — check first)

- [ ] **Step 1: Find the existing coverage-route test**

Run: `grep -rln "national-coverage" tests/ test-workers/`

Read whichever file(s) match to see the current assertions (they'll assert on `state_sources`/`states_covered` shape) so Step 5 doesn't accidentally break them.

- [ ] **Step 2: Write/extend the failing test**

In the file found in Step 1, add a test asserting that a source present only in `getAllEnabledAdapters`'s "always-on" set (FBI, family `'fbi'`) is correctly excluded from state counts (since `meta.state === 'US'`), and that a config-driven `national_warrant_sources` row for a given state increments that state's count — this should already pass with the *old* code too, so the real new-behavior assertion is: mock/stub `getAllEnabledAdapters` (or seed a `warrant_scraper_config` row) such that a code adapter like `ada-county-id` (family `'ada-county'`, not in the hand-rolled old query's adapter list logic) is enabled, and assert it now appears in `state_sources['ID']` — cross-check against the current test file's existing mocking approach and mirror it exactly; if the existing test seeds D1 directly (most likely, given this is a `test-workers/` Miniflare test), add a row to `warrant_scraper_config` for `ada-county-id` with `enabled=1` and assert `body.state_sources.ID >= 1`.

- [ ] **Step 3: Run to verify current behavior / establish baseline**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalCoverage.test.ts` (adjust path per Step 1)
Expected: the pre-existing tests PASS (baseline); the new one may already pass since `getEnabledAdapters` already includes Ada County when configured — if so, this task is a refactor-only change and the "new" test simply documents the unification. That's fine; note it and proceed — the safety net is still valuable for the refactor in Step 4.

- [ ] **Step 4: Implement — replace the route's hand-rolled computation**

In `src/routes/warrants.ts`, change the import on line 11 from:

```ts
import { getEnabledAdapters } from '../utils/warrantSources/registry';
```

to:

```ts
import { getAllEnabledAdapters } from '../utils/warrantSources/registry';
```

Replace lines 316-334 (from the `warrants.get('/national-coverage', ...)` handler start through the always-adapters `for` loop):

```ts
warrants.get('/national-coverage', async (c) => {
  const db = getDb(c.env);

  // Single source of truth: the SAME enabled-adapter computation the real
  // scan uses (getAllEnabledAdapters — code adapters gated by
  // warrant_scraper_config, the always-on FBI/Utah-County adapters, and
  // config-driven national_warrant_sources rows, deduped by meta.key). This
  // route used to recompute this independently and could drift from what
  // actually gets scanned; it no longer can.
  const adapters = await getAllEnabledAdapters(db);

  const stateSources = new Map<string, number>();
  for (const adapter of adapters) {
    if (adapter.meta.state === 'US') continue;  // federal (FBI) isn't state-specific coverage
    const code = adapter.meta.state.toUpperCase();
    stateSources.set(code, (stateSources.get(code) ?? 0) + 1);
  }
```

- [ ] **Step 5: Confirm the unused `query` import (if any) and Utah-guard comment still make sense**

Run: `grep -n "^import\|query<" src/routes/warrants.ts | head -20`

The `configRows` query that was removed (`SELECT state, enabled FROM national_warrant_sources ...`) is no longer needed — confirm no other code in this route file depends on a variable named `configRows` or `codeAdapters` (the replaced block's local names). The subsequent Utah special-case block (originally lines 336-349) is unchanged and still references `stateSources`, which still exists — no further edits needed there.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalCoverage.test.ts` (or whichever path Step 1 found)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/warrants.ts
git commit -m "refactor(warrants): route /national-coverage through getAllEnabledAdapters, remove duplicate computation"
```

(Include the test file in this commit if Step 2 modified one: `git add <test file path>`.)

---

### Task 9: Migration history documentation cleanup

**Files:**
- Modify: `migrations/README.md`
- Modify: `migrations/0110_warrant_source_chunking.sql` (comment only, no DDL change)

- [ ] **Step 1: Read the current duplicate-prefix list in `migrations/README.md`**

Run: `grep -n -B2 -A2 "duplicate" migrations/README.md | head -60`

Find the existing list format (it already documents other dup prefixes per CLAUDE.md's "20 duplicate-prefix entries" note) and match its exact bullet style.

- [ ] **Step 2: Add the `0110` entry**

Add one bullet to that list (matching the existing format found in Step 1):

```markdown
- `0110_national_warrant_pdf_sources.sql` + `0110_warrant_source_chunking.sql` — both real, both applied; apply in lexicographic filename order (pdf-sources first). `0110_warrant_source_chunking.sql` is the actual source of truth for Baton Rouge (`socrata-brla-citycourt`)'s current `enabled=1` state — two earlier files (`0107_national_warrant_pull.sql`, `0110_national_warrant_pdf_sources.sql`) both describe it as staying disabled; that's stale, this file's UPDATE is what's live.
```

- [ ] **Step 3: Add a one-line clarifying comment to `0110_warrant_source_chunking.sql`**

Read the file first: `grep -n "brla\|Baton" migrations/0110_warrant_source_chunking.sql`

Directly above the `UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt'` line, add:

```sql
-- NOTE: this UPDATE is the actual source of truth for Baton Rouge's enabled
-- state — earlier migrations (0107, 0110_national_warrant_pdf_sources) both
-- describe it staying disabled; that description is stale as of this file.
-- See migrations/README.md's duplicate-prefix notes for the full trail.
```

- [ ] **Step 4: Verify no DDL changed**

Run: `git diff migrations/0110_warrant_source_chunking.sql`
Expected: only comment lines added, zero SQL statement changes.

- [ ] **Step 5: Commit**

```bash
git add migrations/README.md migrations/0110_warrant_source_chunking.sql
git commit -m "docs(migrations): clarify duplicate 0110 prefix and Baton Rouge enable trail"
```

---

### Task 10: End-to-end health-grade documentation test

**Files:**
- Test: `tests/warrantConfigRegistry.test.ts` or a new `tests/healthGradeDegraded.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/healthGradeDegraded.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeHealthGrade } from '../src/utils/warrantSources/healthGrade';

describe('computeHealthGrade — degraded runs grade as failures', () => {
  it('grades a run of all-degraded rows as F, even though none had errors', () => {
    // These rows simulate what insertScraperRunRow writes when degraded=true:
    // success is already folded to 0 at write time (see logScanResult.ts),
    // so computeHealthGrade's contract/formula needs no changes — this test
    // documents that end-to-end behavior explicitly.
    const runs = Array.from({ length: 20 }, () => ({ success: false }));
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('a mix of 18 clean successes and 2 degraded-turned-failures still grades A (90% >= 85%... verify threshold)', () => {
    const runs = [
      ...Array.from({ length: 18 }, () => ({ success: true })),
      ...Array.from({ length: 2 }, () => ({ success: false })),
    ];
    // 18/20 = 90% → falls in the >=85% band per healthGrade.ts's documented thresholds.
    expect(computeHealthGrade(runs)).toBe('B');
  });
});
```

- [ ] **Step 2: Run to verify it passes (no implementation change expected — this documents existing, unchanged `computeHealthGrade` behavior)**

Run: `npx vitest run tests/healthGradeDegraded.test.ts`
Expected: PASS immediately, since `computeHealthGrade` itself is untouched by this plan (per the design's explicit non-goal). If the second test's expected grade doesn't match, recompute using the exact thresholds in `src/utils/warrantSources/healthGrade.ts` (`>=95% A, >=85% B, >=70% C, >=50% D, else F`) and fix the test's expected value — do not change `healthGrade.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/healthGradeDegraded.test.ts
git commit -m "test(warrants): document that degraded runs fold into health-grade failures end-to-end"
```

---

### Task 11: Full regression pass + live migration application

**Files:** none (verification only)

- [ ] **Step 1: Full local verification**

Run:
```bash
npm run typecheck
npx vitest run
npx vitest run --config vitest.workers.config.mts
cd client && npx tsc --noEmit && cd ..
```
Expected: all PASS, zero new failures compared to the pre-plan baseline (192 test files / 1651+ tests passing, per the session's earlier `git commit` output).

- [ ] **Step 2: Confirm no other call sites break**

Run: `grep -rn "\.fetchAll(" src/ | grep -v node_modules`

Confirm every remaining `fetchAll` call site (in `runScan.ts`, and any test helpers) destructures `.hits` from the result rather than treating it as a bare array. Fix any stragglers found.

- [ ] **Step 3: Open a PR (per this repo's standard flow — see CLAUDE.md/memory: feature branch + `gh pr create`, not direct push to main)**

```bash
git push -u origin HEAD
gh pr create --title "fix(warrants): make national poller failures loud, unify enabled-adapter logic" --body "$(cat <<'EOF'
## Summary
- Adapters now report a `degraded` signal (with reason) instead of silently swallowing fetch/parse failures into empty results.
- A degraded run now grades as a failure in scraper_runs/health-grade, closing a false-green blind spot.
- A total-orchestrator crash (not just a per-source error) now persists a scraper_runs sentinel row instead of only console.error.
- `/national-coverage` now uses the exact same enabled-adapter computation as the real scan (`getAllEnabledAdapters`), removing a duplicate/driftable computation.
- New migration 0179: `scraper_runs.degraded` column + a UNIQUE index on `warrant_scraper_config.source_name` (closing a real dedup gap).
- Cleanup: dead import removed, duplicate migration-0110 prefix documented (not renamed — already live), Baton Rouge enable-trail clarified with a comment.

Design: docs/superpowers/specs/2026-07-08-warrant-poller-observability-design.md
Plan: docs/superpowers/plans/2026-07-08-warrant-poller-observability.md

## Test plan
- [x] `npm run typecheck` clean
- [x] `npx vitest run` (Node suite) clean
- [x] `npx vitest run --config vitest.workers.config.mts` (Miniflare suite) clean
- [ ] After merge: apply migration 0179 to live D1 via `scripts/apply-migration.sh 0179_scraper_runs_degraded.sql`, verify via `pragma_table_info('scraper_runs')` and the unique-index query in the migration.
EOF
)"
```

- [ ] **Step 4: After merge — apply the migration to live D1**

Run (per CLAUDE.md's schema-change checklist):
```bash
scripts/apply-migration.sh 0179_scraper_runs_degraded.sql
```

Then verify:
```bash
wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='scraper_runs'"
wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='warrant_scraper_config'"
```
Expected: `scraper_runs`'s CREATE TABLE (or the tracked ALTER) shows the `degraded` column; the unique index is listed.
