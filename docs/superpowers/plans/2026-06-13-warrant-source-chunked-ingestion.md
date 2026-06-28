# Large-source Chunked Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest large full-list warrant sources (Arlington ~148,503 rows, Baton Rouge ~113K) to full coverage by fetching a bounded window per cron tick and advancing a persisted cursor, with the clear-sweep deferred until a full pass completes — without starving the Utah leg.

**Architecture:** A new optional `fetchChunk(cursor)` adapter method returns `{ hits, nextCursor, done }`. The arcgis branch pages by keyset (`OBJECTID > cursor`, ≤2000 rows/server-fetch — the live `maxRecordCount` — looping until it crosses a ~5K budget at a page boundary); the socrata branch pages by `$offset`. `runFullListLeg` reads/advances per-source progress in a new `national_warrant_source_progress` table and runs `markScrapedCleared` scoped to `cycle_started_at` **only when `done`**. `runAllSourceScans` runs the Utah leg first. Writes are batched via D1 `batch()` against a new UNIQUE index.

**Tech Stack:** Cloudflare Workers + Hono + D1, TypeScript, vitest (in-memory fake-DB harness, no Miniflare).

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0110_warrant_source_chunking.sql` (create) | Progress table; dedup + UNIQUE index on `scraped_warrants(source_key,warrant_id)`; re-enable Baton Rouge |
| `src/utils/warrantSources/types.ts` (modify) | Add `fetchChunk` + `ChunkResult` to the adapter contract |
| `src/utils/warrantSources/paging.ts` (create) | Pure URL/cursor/done helpers for arcgis (keyset) + socrata (offset) |
| `src/utils/warrantSources/configRegistry.ts` (modify) | arcgis + socrata branches build `fetchChunk` adapters using `paging.ts`; drop the 50K/1M internal caps |
| `src/utils/warrantSources/store.ts` (modify) | `readSourceProgress` / `saveSourceProgress` / `completeSourceCycle` + `upsertScrapedWarrantsBatch` |
| `src/utils/warrantSources/runScan.ts` (modify) | Chunked cycle gate in `runFullListLeg` (+ injectable `now()`); Utah-first reorder in `runAllSourceScans` |
| `tests/warrantPaging.test.ts` (create) | Pure paging-helper unit tests |
| `tests/warrantChunked.test.ts` (create) | Cycle-gate: mid-cycle no-sweep, final-chunk sweep+reset, resume, fetch-error |
| `tests/warrantConfigChunk.test.ts` (create) | `fetchChunk` integration (stubbed fetch) for arcgis keyset loop + socrata offset |

**Module constants** (define once in `paging.ts`, import elsewhere):
- `ARCGIS_SERVER_PAGE = 2000` (live `maxRecordCount` for Arlington's layer)
- `CHUNK_TARGET = 5000` (soft per-tick budget; the arcgis loop stops at the first page boundary ≥ this)

---

## Task 1: Migration 0110 — progress table, unique index, re-enable Baton Rouge

**Files:**
- Create: `migrations/0110_warrant_source_chunking.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0110: chunked ingestion for large full-list warrant sources.
-- Adds per-source pagination progress, a UNIQUE index enabling batched upserts,
-- and re-enables Baton Rouge (~113K) now that chunking keeps it budget-safe.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).

CREATE TABLE IF NOT EXISTS national_warrant_source_progress (
  source_key         TEXT PRIMARY KEY,
  cursor             TEXT,                        -- opaque resume token; NULL = start of a fresh pass
  cycle_started_at   TEXT,                        -- ISO ts when the current full pass began
  last_full_cycle_at TEXT,                        -- ISO ts of the last completed pass (observability)
  rows_this_cycle    INTEGER NOT NULL DEFAULT 0,  -- running count for logging
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- A UNIQUE index on (source_key, warrant_id) already exists from 0067 /
-- baseline (idx_scraped_warrants_src_wid). We keep a defensive IF NOT EXISTS
-- under the SAME name so it's a true no-op on live but still a safety-net on any
-- D1 where 0067 silently never landed (deploy migration step is continue-on-error).
-- Dedup FIRST so the index can't fail on pre-existing dups. NULL-safe: warrant_id
-- is nullable, and a NULL anywhere in a NOT IN subquery poisons the whole predicate
-- (deletes nothing), so we exclude NULL-keyed rows from both sides.
DELETE FROM scraped_warrants
 WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM scraped_warrants
      WHERE source_key IS NOT NULL AND warrant_id IS NOT NULL
      GROUP BY source_key, warrant_id
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_src_wid
  ON scraped_warrants(source_key, warrant_id);

-- Re-enable Baton Rouge (disabled inline in 0107 for the per-hit budget reason).
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
```

- [ ] **Step 2: Apply locally and verify the table + index exist**

Run:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/eloquent-rosalind-b3a425" && npm run migrate:local
```
Expected: migration applies without error (a re-run may report the `ADD COLUMN`-free DDL as already-applied — that's fine; all statements here are `IF NOT EXISTS` / idempotent).

- [ ] **Step 3: Commit**

```bash
git add migrations/0110_warrant_source_chunking.sql
git commit -m "feat(warrants): mig 0110 — source-progress table, scraped_warrants unique index, re-enable Baton Rouge"
```

---

## Task 2: Adapter contract — add `fetchChunk`

**Files:**
- Modify: `src/utils/warrantSources/types.ts`

- [ ] **Step 1: Add the `ChunkResult` type and the optional method**

In `types.ts`, replace the `WarrantSourceAdapter` interface (currently lines 43–48) with:

```ts
/** One bounded window of a full-list roster, plus the cursor to resume from. */
export interface ChunkResult {
  hits: RawWarrantHit[];
  nextCursor: string | null;   // opaque resume token (arcgis: last OBJECTID; socrata: next offset)
  done: boolean;               // true = roster fully traversed this pass
}

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  mode: SourceMode;
  fetchAll?(env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
  /** Chunked full-list fetch: return one window starting after `cursor` (null = start). */
  fetchChunk?(
    cursor: string | null,
    env: { DB: D1Database } & Record<string, unknown>,
  ): Promise<ChunkResult>;
  fetchForPerson?(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; this is an additive optional member).

- [ ] **Step 3: Commit**

```bash
git add src/utils/warrantSources/types.ts
git commit -m "feat(warrants): add optional fetchChunk to WarrantSourceAdapter"
```

---

## Task 3: Pure paging helpers (`paging.ts`)

**Files:**
- Create: `src/utils/warrantSources/paging.ts`
- Test: `tests/warrantPaging.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/warrantPaging.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildArcgisKeysetUrl, buildSocrataOffsetUrl, maxObjectId, arcgisHasMore,
  ARCGIS_SERVER_PAGE, CHUNK_TARGET,
} from '../src/utils/warrantSources/paging';

describe('paging helpers', () => {
  it('builds an arcgis keyset URL ordered by OBJECTID after the cursor', () => {
    const url = buildArcgisKeysetUrl('https://h/svc/MapServer/9', 4200, 2000);
    expect(url).toContain('/query?');
    expect(url).toContain('where=OBJECTID%3E4200');        // OBJECTID>4200, encoded
    expect(url).toContain('orderByFields=OBJECTID%20ASC');
    expect(url).toContain('resultRecordCount=2000');
    expect(url).toContain('outFields=*');
    expect(url).toContain('f=json');
  });

  it('starts an arcgis scan from OBJECTID>0 when cursor is 0', () => {
    expect(buildArcgisKeysetUrl('https://h/9', 0, 2000)).toContain('where=OBJECTID%3E0');
  });

  it('builds a socrata offset URL with a stable :id order', () => {
    const url = buildSocrataOffsetUrl('data.x.gov', 'ab12-cd34', 10000, 5000);
    expect(url).toBe('https://data.x.gov/resource/ab12-cd34.json?$limit=5000&$offset=10000&$order=:id');
  });

  it('maxObjectId returns the largest OBJECTID, falling back when empty', () => {
    const feats = [{ attributes: { OBJECTID: 7 } }, { attributes: { OBJECTID: 19 } }, { attributes: { OBJECTID: 11 } }];
    expect(maxObjectId(feats, 0)).toBe(19);
    expect(maxObjectId([], 42)).toBe(42);
  });

  it('arcgisHasMore is true on a full page or exceededTransferLimit, false on a short final page', () => {
    expect(arcgisHasMore({ features: new Array(2000).fill({}), exceededTransferLimit: true }, 2000)).toBe(true);
    expect(arcgisHasMore({ features: new Array(2000).fill({}) }, 2000)).toBe(true);  // full page → assume more
    expect(arcgisHasMore({ features: new Array(37).fill({}) }, 2000)).toBe(false);   // short page → done
    expect(arcgisHasMore({ features: [] }, 2000)).toBe(false);
  });

  it('exposes the page-size constants', () => {
    expect(ARCGIS_SERVER_PAGE).toBe(2000);
    expect(CHUNK_TARGET).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantPaging.test.ts`
Expected: FAIL — cannot resolve `../src/utils/warrantSources/paging`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/warrantSources/paging.ts
// Pure pagination helpers for chunked full-list sources. No I/O — the adapters
// call fetch() and feed the responses here so the URL/cursor/done logic is
// unit-testable in isolation.

/** Live maxRecordCount for the Arlington ArcGIS layer — the server caps every
 *  query at this many rows regardless of resultRecordCount, so we page by it. */
export const ARCGIS_SERVER_PAGE = 2000;

/** Soft per-tick ingest budget. The arcgis loop stops at the first server-page
 *  boundary at or beyond this count, so a tick stores ~5000–6000 rows. */
export const CHUNK_TARGET = 5000;

interface ArcgisLikeBody { features?: unknown[]; exceededTransferLimit?: boolean }

/** Keyset page after `afterOid`, ordered by OBJECTID so deletions can't make us
 *  skip rows (unlike resultOffset paging). */
export function buildArcgisKeysetUrl(baseUrl: string, afterOid: number, pageSize: number): string {
  const where = encodeURIComponent(`OBJECTID>${afterOid}`);
  const order = encodeURIComponent('OBJECTID ASC');
  return `${baseUrl}/query?where=${where}&outFields=*&orderByFields=${order}` +
         `&resultRecordCount=${pageSize}&returnGeometry=false&f=json`;
}

/** Socrata offset page with a stable :id sort (matches the pre-chunking code). */
export function buildSocrataOffsetUrl(baseUrl: string, resourceId: string, offset: number, pageSize: number): string {
  return `https://${baseUrl}/resource/${resourceId}.json?$limit=${pageSize}&$offset=${offset}&$order=:id`;
}

/** Largest OBJECTID among features; `fallback` when there are none. */
export function maxObjectId(features: { attributes?: Record<string, unknown> }[], fallback: number): number {
  let max = fallback;
  for (const f of features) {
    const v = Number(f.attributes?.OBJECTID);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/** Whether more rows likely remain after this arcgis page: a full page (== the
 *  server cap) or an explicit exceededTransferLimit means keep going; a short
 *  page means the roster is exhausted. */
export function arcgisHasMore(body: ArcgisLikeBody, pageSize: number): boolean {
  if (body.exceededTransferLimit === true) return true;
  return (body.features?.length ?? 0) >= pageSize;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantPaging.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/warrantSources/paging.ts tests/warrantPaging.test.ts
git commit -m "feat(warrants): pure keyset/offset paging helpers + tests"
```

---

## Task 4: Convert arcgis + socrata config adapters to `fetchChunk`

**Files:**
- Modify: `src/utils/warrantSources/configRegistry.ts`
- Test: `tests/warrantConfigChunk.test.ts`

- [ ] **Step 1: Write the failing test (stubbed fetch)**

```ts
// tests/warrantConfigChunk.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getConfigAdapters } from '../src/utils/warrantSources/configRegistry';

afterEach(() => vi.unstubAllGlobals());

// Minimal fake D1 returning one source row for getConfigAdapters().
function dbWithSource(row: Record<string, unknown>) {
  const mk = () => ({ bind: () => mk(), all: async () => ({ results: [row] }), first: async () => null, run: async () => ({ meta: {} }) });
  return { prepare: () => mk() } as any;
}

const ARCGIS_ROW = {
  source_key: 'arcgis-arlington-tx', family: 'arcgis', display_name: 'Arlington', state: 'TX',
  jurisdiction: 'Arlington', base_url: 'https://h/svc/MapServer/9', resource_id: null,
  field_map: '{"first":"FirstName","last":"LastName","case_no":"CitationNumber"}',
  mode: 'full-list', format: 'arcgis', kind: 'criminal', enabled: 1, priority: 2,
};

function arcgisPage(oidStart: number, count: number, exceeded: boolean) {
  const features = Array.from({ length: count }, (_, i) => ({
    attributes: { OBJECTID: oidStart + i, FirstName: 'A', LastName: 'B', CitationNumber: `C${oidStart + i}` },
  }));
  return { ok: true, json: async () => ({ features, exceededTransferLimit: exceeded }) };
}

describe('arcgis fetchChunk', () => {
  it('keyset-loops up to the budget then returns done=false with the last OBJECTID', async () => {
    // 2000 + 2000 + 2000 = 6000 ≥ CHUNK_TARGET(5000); third page still full → not done.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(arcgisPage(1, 2000, true))
      .mockResolvedValueOnce(arcgisPage(2001, 2000, true))
      .mockResolvedValueOnce(arcgisPage(4001, 2000, true));
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!(null, { DB: dbWithSource(ARCGIS_ROW) });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.hits.length).toBe(6000);
    expect(res.done).toBe(false);
    expect(res.nextCursor).toBe('6000');          // last OBJECTID seen
    expect(fetchMock.mock.calls[0][0]).toContain('where=OBJECTID%3E0');
    expect(fetchMock.mock.calls[1][0]).toContain('where=OBJECTID%3E2000');
  });

  it('resumes from the cursor and reports done on a short final page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(arcgisPage(6001, 37, false));
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!('6000', { DB: dbWithSource(ARCGIS_ROW) });

    expect(fetchMock.mock.calls[0][0]).toContain('where=OBJECTID%3E6000');
    expect(res.hits.length).toBe(37);
    expect(res.done).toBe(true);
    expect(res.nextCursor).toBe('6037');
  });

  it('on a fetch error mid-loop keeps what it has and stays not-done with the cursor unmoved past failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(arcgisPage(1, 2000, true))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ARCGIS_ROW));
    const res = await adapter.fetchChunk!(null, { DB: dbWithSource(ARCGIS_ROW) });

    expect(res.hits.length).toBe(2000);
    expect(res.done).toBe(false);
    expect(res.nextCursor).toBe('2000');          // resume after the rows we DID get
  });
});

describe('socrata fetchChunk', () => {
  const ROW = { ...ARCGIS_ROW, source_key: 'socrata-x', family: 'socrata', format: 'socrata',
    base_url: 'data.x.gov', resource_id: 'ab12-cd34',
    field_map: '{"first":"first","last":"last","case_no":"fileno"}' };

  it('fetches one offset page and advances the offset cursor', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ first: 'A', last: 'B', fileno: `F${i}` }));
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => rows });
    vi.stubGlobal('fetch', fetchMock);

    const [adapter] = await getConfigAdapters(dbWithSource(ROW));
    const res = await adapter.fetchChunk!('0', { DB: dbWithSource(ROW) });

    expect(fetchMock.mock.calls[0][0]).toBe('https://data.x.gov/resource/ab12-cd34.json?$limit=5000&$offset=0&$order=:id');
    expect(res.done).toBe(false);                 // full page → more remain
    expect(res.nextCursor).toBe('5000');
  });

  it('reports done on a short page', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ first: 'A', last: 'B', fileno: `F${i}` }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => rows }));
    const [adapter] = await getConfigAdapters(dbWithSource(ROW));
    const res = await adapter.fetchChunk!('5000', { DB: dbWithSource(ROW) });
    expect(res.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantConfigChunk.test.ts`
Expected: FAIL — `adapter.fetchChunk` is undefined (adapters still expose `fetchAll`).

- [ ] **Step 3: Rewrite the arcgis + socrata branches in `makeAdapter`**

In `configRegistry.ts`: update the imports at the top, then replace **both** the socrata branch (currently lines 24–41) and the arcgis branch (currently lines 42–57) with the `fetchChunk` versions below. Leave `safeMap`, `meta`, `getConfigAdapters`, and the final `return null` untouched.

Add to the imports:
```ts
import { buildArcgisKeysetUrl, buildSocrataOffsetUrl, maxObjectId, arcgisHasMore, ARCGIS_SERVER_PAGE, CHUNK_TARGET } from './paging';
import type { ChunkResult } from './types';
```

Socrata branch (replaces lines 24–41):
```ts
  if (row.family === 'socrata') {
    return { meta, mode: 'full-list', async fetchChunk(cursor: string | null): Promise<ChunkResult> {
      const offset = cursor ? Number(cursor) : 0;
      try {
        const url = buildSocrataOffsetUrl(row.base_url ?? '', row.resource_id ?? '', offset, CHUNK_TARGET);
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { hits: [], nextCursor: cursor, done: false };  // error → retry same page, no sweep
        const rows = (await res.json()) as Record<string, unknown>[];
        return {
          hits: parseSocrata(rows, map, row.source_key),
          nextCursor: String(offset + CHUNK_TARGET),
          done: rows.length < CHUNK_TARGET,   // raw row count, NOT deduped hits
        };
      } catch {
        return { hits: [], nextCursor: cursor, done: false };
      }
    } };
  }
```

ArcGIS branch (replaces lines 42–57):
```ts
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
          if (!res.ok) return { hits, nextCursor: String(lastOid), done: false };
          const body = (await res.json()) as { features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
          const features = body.features ?? [];
          if (features.length === 0) return { hits, nextCursor: String(lastOid), done: true };
          hits.push(...parseArcgis(body, map, row.source_key));
          lastOid = maxObjectId(features, lastOid);
          if (!arcgisHasMore(body, ARCGIS_SERVER_PAGE)) return { hits, nextCursor: String(lastOid), done: true };
        }
        return { hits, nextCursor: String(lastOid), done: false };
      } catch {
        return { hits, nextCursor: String(lastOid), done: false };
      }
    } };
  }
```

Also add `RawWarrantHit` to the existing type import from `./types` if not already present (it imports `RawWarrantHit` today — keep it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantConfigChunk.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing arcgis/socrata parse tests (regression)**

Run: `npx vitest run tests/warrantArcgis.test.ts tests/warrantSocrata.test.ts`
Expected: PASS (parse helpers unchanged).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/warrantSources/configRegistry.ts tests/warrantConfigChunk.test.ts
git commit -m "feat(warrants): arcgis/socrata config adapters page via fetchChunk (keyset/offset)"
```

---

## Task 5: Store helpers — progress + batched upsert

**Files:**
- Modify: `src/utils/warrantSources/store.ts`
- Test: `tests/warrantChunked.test.ts` (created here, extended in Task 6)

- [ ] **Step 1: Write the failing test for the store helpers**

```ts
// tests/warrantChunked.test.ts
import { describe, it, expect } from 'vitest';
import {
  readSourceProgress, saveSourceProgress, completeSourceCycle, upsertScrapedWarrantsBatch,
} from '../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../src/utils/warrantSources/types';

// Fake D1 that records every SQL string from prepare().run() and batch().
export function fakeDb(progressRow: Record<string, unknown> | null = null) {
  const runs: string[] = [];
  const batched: string[] = [];
  const mk = (sql: string): any => ({
    __sql: sql,
    bind: (..._a: unknown[]) => mk(sql),
    first: async () => (/national_warrant_source_progress/i.test(sql) ? progressRow : null),
    run: async () => { runs.push(sql); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  });
  const DB: any = {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: { __sql: string }[]) => { for (const s of stmts) batched.push(s.__sql); return stmts.map(() => ({ meta: {} })); },
  };
  return { DB, runs, batched };
}

const hit = (id: string): RawWarrantHit => ({ source_key: 's', warrant_id: id, full_name: 'A B' });

describe('source progress helpers', () => {
  it('readSourceProgress returns null when no row exists', async () => {
    const { DB } = fakeDb(null);
    expect(await readSourceProgress(DB, 's')).toBeNull();
  });

  it('saveSourceProgress upserts cursor + cycle_started_at keyed by source_key', async () => {
    const { DB, runs } = fakeDb();
    await saveSourceProgress(DB, 's', '6000', '2026-06-13T00:00:00.000Z', 6000);
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && /ON CONFLICT\(source_key\)/i.test(s))).toBe(true);
  });

  it('completeSourceCycle resets cursor to NULL and stamps last_full_cycle_at', async () => {
    const { DB, runs } = fakeDb();
    await completeSourceCycle(DB, 's', '2026-06-18T00:00:00.000Z');
    const sql = runs.find(s => /national_warrant_source_progress/i.test(s))!;
    expect(sql).toMatch(/last_full_cycle_at/);
    expect(sql).toMatch(/cursor\s*=\s*NULL|cursor[^,]*NULL/i);
  });
});

describe('upsertScrapedWarrantsBatch', () => {
  it('batches inserts via ON CONFLICT and returns the found count', async () => {
    const { DB, batched } = fakeDb();
    const res = await upsertScrapedWarrantsBatch(DB, [hit('w1'), hit('w2'), hit('w3')], null);
    expect(res.found).toBe(3);
    expect(res.errors).toBe(0);
    expect(batched.every(s => /INSERT INTO scraped_warrants/i.test(s) && /ON CONFLICT\(source_key, warrant_id\)/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantChunked.test.ts`
Expected: FAIL — the four helpers are not exported from `store.ts`.

- [ ] **Step 3: Append the helpers to `store.ts`**

Add `executeBatch` and `query` to the existing import (`import { queryFirst, execute, executeBatch, query } from '../db';`), then append:

```ts
// ── Per-source pagination progress (chunked full-list ingestion) ─────────────

export interface SourceProgress {
  cursor: string | null;
  cycle_started_at: string | null;
  rows_this_cycle: number;
}

/** Read a source's pagination progress, or null if it has never run. */
export async function readSourceProgress(db: D1Database, sourceKey: string): Promise<SourceProgress | null> {
  return queryFirst<SourceProgress>(
    db,
    'SELECT cursor, cycle_started_at, rows_this_cycle FROM national_warrant_source_progress WHERE source_key = ?',
    sourceKey,
  );
}

/** Advance progress mid-cycle: persist the new cursor + running count, keeping
 *  the current cycle_started_at. Keyed by the source_key PRIMARY KEY. */
export async function saveSourceProgress(
  db: D1Database,
  sourceKey: string,
  cursor: string | null,
  cycleStartedAt: string,
  rowsThisCycle: number,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO national_warrant_source_progress
       (source_key, cursor, cycle_started_at, rows_this_cycle, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_key) DO UPDATE SET
       cursor = excluded.cursor,
       cycle_started_at = excluded.cycle_started_at,
       rows_this_cycle = excluded.rows_this_cycle,
       updated_at = datetime('now')`,
    sourceKey, cursor, cycleStartedAt, rowsThisCycle,
  );
}

/** Complete a full pass: reset cursor to NULL, start the next cycle's timestamp,
 *  stamp last_full_cycle_at, and zero the running count. */
export async function completeSourceCycle(
  db: D1Database,
  sourceKey: string,
  newCycleStartedAt: string,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO national_warrant_source_progress
       (source_key, cursor, cycle_started_at, last_full_cycle_at, rows_this_cycle, updated_at)
     VALUES (?, NULL, ?, datetime('now'), 0, datetime('now'))
     ON CONFLICT(source_key) DO UPDATE SET
       cursor = NULL,
       cycle_started_at = excluded.cycle_started_at,
       last_full_cycle_at = datetime('now'),
       rows_this_cycle = 0,
       updated_at = datetime('now')`,
    sourceKey, newCycleStartedAt,
  );
}

// ── Batched upsert (chunked full-list ingestion) ─────────────────────────────
// Relies on the UNIQUE index on (source_key, warrant_id) from migration 0110 so
// it can use ON CONFLICT in a D1 batch() — orders of magnitude fewer round-trips
// than the per-row SELECT-then-write upsertScrapedWarrant (kept for the
// per-person leg). Sub-batched so one bad statement-set can't abort the rest.
const SCRAPED_UPSERT_SQL = `
  INSERT INTO scraped_warrants (
    source_key, warrant_id, full_name, first_name, last_name, middle_name,
    date_of_birth, age, city, state, warrant_type, charge_description,
    court_name, case_number, bail_amount, issue_date, photo_url, detail_url,
    person_id, status, cleared_at, first_seen_at, last_seen_at, scraped_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    'active', NULL, datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT(source_key, warrant_id) DO UPDATE SET
    status='active', cleared_at=NULL,
    last_seen_at=datetime('now'), scraped_at=datetime('now'),
    full_name=excluded.full_name, first_name=excluded.first_name,
    last_name=excluded.last_name, middle_name=excluded.middle_name,
    date_of_birth=excluded.date_of_birth, age=excluded.age,
    city=excluded.city, state=excluded.state,
    warrant_type=excluded.warrant_type, charge_description=excluded.charge_description,
    court_name=excluded.court_name, case_number=excluded.case_number,
    bail_amount=excluded.bail_amount, issue_date=excluded.issue_date,
    photo_url=excluded.photo_url, detail_url=excluded.detail_url,
    person_id=excluded.person_id`;

export async function upsertScrapedWarrantsBatch(
  db: D1Database,
  hits: RawWarrantHit[],
  personId: number | null,
): Promise<{ found: number; errors: number }> {
  let found = 0;
  let errors = 0;
  const BATCH = 100;
  for (let i = 0; i < hits.length; i += BATCH) {
    const slice = hits.slice(i, i + BATCH);
    const statements = slice.map((h) => {
      const fullName = h.full_name ?? ([h.first_name, h.last_name].filter(Boolean).join(' ').trim() || null);
      return {
        sql: SCRAPED_UPSERT_SQL,
        bindings: [
          h.source_key, h.warrant_id, fullName, h.first_name ?? null, h.last_name ?? null, h.middle_name ?? null,
          h.date_of_birth ?? null, h.age ?? null, h.city ?? null, h.state ?? null, h.warrant_type ?? null,
          h.charge_description ?? null, h.court_name ?? null, h.case_number ?? null, h.bail_amount ?? null,
          h.issue_date ?? null, h.photo_url ?? null, h.detail_url ?? null, personId ?? null,
        ],
      };
    });
    try {
      await executeBatch(db, statements);
      found += slice.length;
    } catch (err) {
      errors += slice.length;
      console.warn(
        `[warrantSources.store] batch upsert failed (${slice.length} rows):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { found, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantChunked.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/warrantSources/store.ts tests/warrantChunked.test.ts
git commit -m "feat(warrants): source-progress helpers + batched scraped_warrants upsert"
```

---

## Task 6: Cycle gate in `runFullListLeg` + injectable clock

**Files:**
- Modify: `src/utils/warrantSources/runScan.ts`
- Test: `tests/warrantChunked.test.ts` (extend)

- [ ] **Step 1: Write the failing cycle-gate tests (append to `tests/warrantChunked.test.ts`)**

```ts
import { runFullListLeg } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter } from '../src/utils/warrantSources/types';

const chunkAdapter = (res: { hits: any[]; nextCursor: string | null; done: boolean }): WarrantSourceAdapter => ({
  meta: { key: 's', display_name: 'S', state: 'US', county: null, source_url: '', kind: 'arcgis', priority: 2 },
  mode: 'full-list',
  async fetchChunk() { return res; },
});

describe('runFullListLeg — chunked cycle gate', () => {
  const NOW = () => '2026-06-13T00:00:00.000Z';

  it('mid-cycle (done=false): advances cursor, NO clear-sweep', async () => {
    const { DB, runs, batched } = fakeDb(null);
    const adapter = chunkAdapter({ hits: [hit('w1'), hit('w2')], nextCursor: '6000', done: false });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(summary[0].found).toBe(2);
    expect(batched.length).toBeGreaterThan(0);                                   // rows were upserted
    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(false);  // NO sweep
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && !/last_full_cycle_at/i.test(s))).toBe(true);
  });

  it('final chunk (done=true): clear-sweep fires + cycle resets', async () => {
    const { DB, runs } = fakeDb({ cursor: '6000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 6000 });
    const adapter = chunkAdapter({ hits: [hit('w7')], nextCursor: '6037', done: true });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(true);    // sweep
    expect(runs.some(s => /national_warrant_source_progress/i.test(s) && /last_full_cycle_at/i.test(s))).toBe(true);  // reset
  });

  it('resume: passes the persisted cursor into fetchChunk', async () => {
    const { DB } = fakeDb({ cursor: '4000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 4000 });
    let seenCursor: string | null = 'UNSET';
    const adapter: WarrantSourceAdapter = {
      meta: { key: 's', display_name: 'S', state: 'US', county: null, source_url: '', kind: 'arcgis', priority: 2 },
      mode: 'full-list',
      async fetchChunk(cursor) { seenCursor = cursor; return { hits: [], nextCursor: cursor, done: false }; },
    };
    await runFullListLeg(DB, [adapter], { now: NOW });
    expect(seenCursor).toBe('4000');
  });

  it('batch errors on a done=true chunk: NO clear-sweep, NO cycle complete, retries same cursor', async () => {
    // Force every D1 batch() to fail → upsertScrapedWarrantsBatch reports errors>0.
    // Even though the adapter says done=true, the gate must NOT sweep/complete
    // (a sweep would wrongly clear active warrants that just failed to re-store).
    const { DB, runs } = fakeDb({ cursor: '6000', cycle_started_at: '2026-06-09T00:00:00.000Z', rows_this_cycle: 6000 });
    DB.batch = async () => { throw new Error('D1_ERROR: transient'); };
    const adapter = chunkAdapter({ hits: [hit('w7')], nextCursor: '6037', done: true });
    const summary = await runFullListLeg(DB, [adapter], { now: NOW });

    expect(summary[0].errors).toBeGreaterThan(0);
    expect(runs.some(s => /UPDATE scraped_warrants SET status='cleared'/i.test(s))).toBe(false);  // NO sweep despite done
    expect(runs.some(s => /last_full_cycle_at/i.test(s))).toBe(false);                            // NOT completed
    // cursor persisted UNCHANGED (retry same window) → a progress upsert without last_full_cycle_at
    expect(runs.some(s => /INSERT INTO national_warrant_source_progress/i.test(s) && !/last_full_cycle_at/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantChunked.test.ts`
Expected: FAIL — `runFullListLeg` doesn't accept an opts arg / has no chunked branch.

- [ ] **Step 3: Update imports + signature, add the chunked branch**

In `runScan.ts`, extend the store import:
```ts
import {
  upsertScrapedWarrant, markScrapedCleared, upsertScrapedWarrantsBatch,
  readSourceProgress, saveSourceProgress, completeSourceCycle,
} from './store';
```

Replace the `runFullListLeg` signature line (currently `export async function runFullListLeg(\n  db: D1Database,\n  adapters: WarrantSourceAdapter[],\n): Promise<ScrapedSourceSummary[]> {`) with:
```ts
export async function runFullListLeg(
  db: D1Database,
  adapters: WarrantSourceAdapter[],
  opts: { now?: () => string } = {},
): Promise<ScrapedSourceSummary[]> {
  const now = opts.now ?? (() => new Date().toISOString());
```

Then, immediately inside the `for (const adapter of adapters) {` loop, BEFORE the existing
`if (adapter.mode !== 'full-list' || typeof adapter.fetchAll !== 'function') continue;` line,
insert the chunked branch:
```ts
    if (adapter.mode !== 'full-list') continue;

    // ── Chunked path (cursor-driven; large rosters across many ticks) ────────
    if (typeof adapter.fetchChunk === 'function') {
      const key = adapter.meta.key;
      let found = 0;
      let errors = 0;
      let cleared = 0;
      try {
        const prog = await readSourceProgress(db, key);
        const cycleStartedAt = prog?.cycle_started_at ?? now();
        const cursor = prog?.cursor ?? null;

        const { hits, nextCursor, done } = await adapter.fetchChunk(cursor, { DB: db });
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
      out.push({ source_key: key, checked: 0, found, cleared, errors });
      continue;
    }

```
Keep the existing `if (... typeof adapter.fetchAll !== 'function') continue;` and the entire one-shot `fetchAll` body below it **unchanged** (FBI / Utah County small rosters still use it, including its `MAX_FULL_LIST_HITS` safety cap).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantChunked.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Regression — the original full-list test still passes**

Run: `npx vitest run tests/warrantFullList.test.ts`
Expected: PASS (fetchAll adapters routed to the unchanged one-shot branch).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/warrantSources/runScan.ts tests/warrantChunked.test.ts
git commit -m "feat(warrants): cycle-aware clear-sweep gate for chunked full-list ingestion"
```

---

## Task 7: Utah-first reorder in `runAllSourceScans`

**Files:**
- Modify: `src/utils/warrantSources/runScan.ts`

- [ ] **Step 1: Move the Utah leg ahead of the scraped/full-list legs**

In `runAllSourceScans`, the Utah block currently sits at the END (the `let utah: WatchRunResult; if (opts.skipUtah) {...} else { utah = await runUtahWarrantScan(db); }` block, ~lines 412–424, just before `return { utah, scraped }`).

Move that entire block to run **first** — immediately after the `const delayMs = ...` line and before the `// ── Scraped leg ──` comment. **Guard the Utah call** so a throw can't abort the now-following scraped legs (the legs are documented as independent; `runUtahWarrantScan`'s initial `warrant_watch_runs` INSERT is outside its own try/catch, so it *can* throw). Wrap the non-skip path:
```ts
  } else {
    try {
      utah = await runUtahWarrantScan(db);
    } catch (err) {
      // Utah runs first now; a throw must NOT abort the independent scraped/
      // full-list legs. Degrade to a failed result and continue.
      console.warn('[warrantSources.runScan] Utah leg threw:', err instanceof Error ? err.message : String(err));
      utah = { run_id: 'utah-error', status: 'failed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 1 };
    }
  }
```
Update the two header comments:
- The file header "Order:" paragraph (lines 20–22) → describe Utah-first: *"Order: the Utah leg runs FIRST so a large chunked scraped source can never consume the tick's budget before RMPG's home jurisdiction is scanned; the scraped + full-list legs follow."*
- The step list in the `runAllSourceScans` docblock (the "1. Scraped leg … 2. Utah leg …" comment) → renumber so Utah is step 1.

The returned object `{ utah, scraped }` and all leg logic are otherwise unchanged. `opts.skipUtah` still short-circuits the Utah fetch.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Full worker test suite (no regressions)**

Run: `npm test`
Expected: PASS — all prior tests (incl. `warrantFullList`, `warrantArcgis`, `warrantSocrata`) plus the new `warrantPaging`, `warrantConfigChunk`, `warrantChunked`.

- [ ] **Step 4: Commit**

```bash
git add src/utils/warrantSources/runScan.ts
git commit -m "feat(warrants): run Utah leg first so large scraped sources can't starve it"
```

---

## Task 8: Final verification

- [ ] **Step 1: Typecheck + full suite**

Run:
```bash
npm run typecheck && npm test
```
Expected: typecheck PASS; vitest all-pass (baseline was 515 passed / 1 skipped — expect the new tests added on top, none failing).

- [ ] **Step 2: Confirm the two stale caps are gone**

Run: `grep -rn "MAX_FULL_LIST_HITS\|offset < 50000\|1_000_000" src/utils/warrantSources/`
Expected: `MAX_FULL_LIST_HITS` appears ONLY in the `fetchAll` one-shot branch of `runScan.ts` (the chunked path doesn't use it); the `offset < 50000` and `1_000_000` adapter loops are GONE from `configRegistry.ts`.

- [ ] **Step 3: Post-merge live steps (record in the PR body, do NOT run from here)**

```
1. Apply 0110 to live D1 785de7ae (deploy migration step is continue-on-error):
   - CREATE TABLE national_warrant_source_progress
   - NULL-safe dedup DELETE + CREATE UNIQUE INDEX idx_scraped_warrants_src_wid (no-op on live where 0067/baseline already created it)
   - UPDATE national_warrant_sources SET enabled=1 WHERE source_key='socrata-brla-citycourt'
   Verify: pragma_table_info('national_warrant_source_progress') and the unique index exist.
2. Confirm true count: https://gis2.arlingtontx.gov/.../MapServer/9/query?where=1=1&returnCountOnly=true&f=json  → 148503
3. Over several 4-hourly ticks, watch national_warrant_source_progress: cursor advances,
   rows_this_cycle climbs, last_full_cycle_at sets on completion; Utah warrant_watch_runs
   keeps landing each tick (no starvation).
```
No `client/public/sw.js` bump needed — this is Worker-only.

---

## Self-Review

**Spec coverage:** progress table + re-enable Baton Rouge (Task 1) ✓; `fetchChunk` contract (Task 2) ✓; keyset/offset paging incl. the 2000 server cap (Tasks 3–4) ✓; batched upsert + UNIQUE index (Tasks 1, 5) ✓; cycle-aware clear-sweep gate + truncation-skip + fetch-error semantics (Tasks 4, 6) ✓; Utah-first (Task 7) ✓; tests for mid-cycle/final/resume/error/budget (Tasks 3–6) ✓; removal of both stale caps (Tasks 4, 8) ✓; live rollout steps (Task 8) ✓.

**Type consistency:** `ChunkResult { hits, nextCursor, done }` (Task 2) is the return type used by both adapters (Task 4) and destructured identically in the leg (Task 6). `SourceProgress { cursor, cycle_started_at, rows_this_cycle }` (Task 5) matches the `SELECT` columns and the `prog?.cycle_started_at` / `prog?.rows_this_cycle` reads (Task 6). `upsertScrapedWarrantsBatch` returns `{ found, errors }` (Task 5), destructured as such in Task 6. Constants `ARCGIS_SERVER_PAGE` / `CHUNK_TARGET` defined once in `paging.ts` (Task 3), imported by `configRegistry.ts` (Task 4). `now: () => string` opt added in Task 6 and used by the Task 6 tests.

**Placeholder scan:** every code/SQL step shows full content; no TBD/TODO; the one-shot `fetchAll` branch is explicitly "kept unchanged" with its location identified rather than re-pasted.
