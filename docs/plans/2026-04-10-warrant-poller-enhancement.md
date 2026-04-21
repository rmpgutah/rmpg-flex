# Warrant Poller Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Layer observability, smart scheduling, parser resilience, HTTP+CLI APIs, and admin UI onto the existing warrant scraper without rewriting it — while preserving the 1.4% error rate already achieved.

**Architecture:** Incremental overlay pattern. Keep `server/src/utils/multiStateWarrantScraper.ts` (1,842 lines) as the foundation; add new columns, a new `warrant_scraper_runs` metrics table, a `scraperRunner.ts` helper module for run tracking, a `scraperMetrics.ts` module for aggregation, new routes under `/api/warrants/scrapers`, a CLI at `server/scripts/scrapers.ts`, and a new `ScrapersTab.tsx` inside `WarrantsPage`. Ships in 5 phases — each deploy-safe on its own.

**Tech Stack:** Express 4 + TypeScript (tsx runtime) + better-sqlite3 + Vitest for tests. React 18 + Tailwind + existing WebSocket broadcast infrastructure for the UI. No new dependencies.

**Design doc:** [2026-04-10-warrant-poller-enhancement-design.md](2026-04-10-warrant-poller-enhancement-design.md)

---

## Critical Conventions (read before starting)

1. **Worktree path**: All edits MUST use paths under `.claude/worktrees/focused-montalcini/`. Do NOT edit the main repo copy — edits are invisible to this worktree.
2. **Express route ordering**: In `server/src/routes/warrants.ts`, `/:id` is defined around line 804 and is greedy. EVERY new specific route (`/scrapers`, `/scrapers/:source_key`, etc.) MUST appear ABOVE the `/:id` route. Verify with Grep tool (pattern: `router.(get|post|put|delete)`) before committing.
3. **Lazy migrations**: Use the existing `addCol(table, column, type)` helper in `server/src/models/database.ts` (search for existing calls around line 4851). Never write raw ALTER TABLE. All new columns must be nullable or have safe defaults.
4. **Tests live in**: `server/tests/` (not `src/__tests__/`). Run with `cd server && npx vitest run path/to/test.ts`.
5. **Database in tests**: Never touch `server/data/rmpg-flex.db`. Tests that need a DB should create an in-memory one using `better-sqlite3` with `':memory:'`.
6. **Commit message style**: Follow existing convention — look at `git log --oneline -10` for examples. Each task ends with a commit.
7. **Deploy path**: Worktree branch is `claude/focused-montalcini`. Main branch is `main`. This plan commits to the worktree branch; merge to main separately.
8. **Type checking**: Run `cd client && npx tsc --noEmit` and `cd server && npx tsc --noEmit` before every commit. Zero errors is the standard.
9. **Raw SQL for multi-statement DDL**: The codebase already uses `getDb().exec` for multi-statement DDL (search database.ts for examples). Follow that pattern — do not use `child_process` to execute shell commands from server code.

---

## Phase 1 — Data Model + Run Tracking

**Phase goal:** Add new columns and `warrant_scraper_runs` table; wire run tracking into `syncSource()` so metrics start accumulating. No behavior change visible to users.

### Task 1.1: Add migration columns to `warrant_scraper_config`

**Files:**
- Modify: `server/src/models/database.ts` (insert after existing `addCol('warrant_scraper_config', ...)` calls around line 4855)

**Step 1: Find the migration block**

Use Grep tool: pattern `addCol\('warrant_scraper_config'` in `server/src/models/database.ts`.
Expected: A block of addCol calls starting around line 4851.

**Step 2: Add the new columns**

Insert immediately after the last existing `addCol('warrant_scraper_config', ...)`:

```typescript
// Warrant scraper enhancement — Phase 1 columns
addCol('warrant_scraper_config', 'priority', 'INTEGER DEFAULT 3');
addCol('warrant_scraper_config', 'content_hash', 'TEXT');
addCol('warrant_scraper_config', 'content_hash_updated_at', 'TEXT');
addCol('warrant_scraper_config', 'etag', 'TEXT');
addCol('warrant_scraper_config', 'last_modified', 'TEXT');
addCol('warrant_scraper_config', 'last_success_at', 'TEXT');
addCol('warrant_scraper_config', 'avg_parse_count', 'REAL');
addCol('warrant_scraper_config', 'p95_latency_ms', 'INTEGER');
addCol('warrant_scraper_config', 'jitter_seed', 'INTEGER');
```

**Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Smoke-test the migration**

Write a short tsx script in /tmp that imports `getDb` from the database module and runs a `pragma_table_info` query to verify the `priority` column exists. Run it with `npx tsx`.
Expected: row `{ name: 'priority' }` printed, no SQL errors.

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini"
git add server/src/models/database.ts
git commit -m "feat(warrants): add scraper config metrics columns (phase 1)

Adds priority, content_hash, etag, last_modified, last_success_at,
avg_parse_count, p95_latency_ms, jitter_seed columns via lazy migration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Create `warrant_scraper_runs` table

**Files:**
- Modify: `server/src/models/database.ts` (next block after Task 1.1 columns)

**Step 1: Add the CREATE TABLE block**

Add immediately after the Task 1.1 addCol block. Follow the same multi-statement DDL pattern used elsewhere in database.ts (search for existing `getDb().exec` usages to match style). The block should create the table and two indexes:

```sql
CREATE TABLE IF NOT EXISTS warrant_scraper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  http_status INTEGER,
  bytes_received INTEGER,
  parsed_count INTEGER DEFAULT 0,
  inserted_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  skipped_reason TEXT,
  error_message TEXT,
  parser_used TEXT
);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_source_time
  ON warrant_scraper_runs (source_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_started_at
  ON warrant_scraper_runs (started_at DESC);
```

Wrap in a try/catch so re-runs are idempotent.

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Smoke-test**

Write a short tsx script that runs `SELECT COUNT(*) FROM warrant_scraper_runs` via `getDb().prepare(...).get()`.
Expected: `{ n: 0 }`.

**Step 4: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(warrants): create warrant_scraper_runs metrics table (phase 1)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Seed priority tiers for existing sources

**Files:**
- Create: `server/src/seeds/seedScraperPriorities.ts`

**Step 1: Write the seed file**

Function signature: `seedScraperPriorities(dbOverride?: Database.Database): { updated: number }`. Accept optional DB for testing.

Logic:
- Select all rows where `priority IS NULL OR priority = 3`
- For each row, determine tier based on source_key and state:
  - **Tier 1**: source_key in `['federal_fbi_wanted', 'fed_fbi_wanted', 'utah_state_warrants', 'ut_slc_metro_warrants']`
  - **Tier 2**: source_key starts with `ut_` OR source_key in `['co_denver_warrants', 'nv_clark_warrants', 'nv_washoe_warrants', 'az_maricopa_warrants', 'az_pima_warrants']`
  - **Tier 4**: state in `{ 'HI', 'AK', 'ND', 'SD', 'VT', 'WY', 'ME' }`
  - Else: stay at 3
- Update each row via prepared statement
- Return `{ updated: count }`

Add a `require.main === module` guard to allow running as a script: `npx tsx src/seeds/seedScraperPriorities.ts`.

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Write test**

Create: `server/tests/seeds/seedScraperPriorities.test.ts`

Test strategy: create an in-memory `better-sqlite3` Database, manually initialize a minimal `warrant_scraper_config` schema, insert 5 test rows (FBI, SLC metro, Denver, Alaska, generic), call `seedScraperPriorities(db)` with the override, then assert each row got the correct priority.

Required tests:
1. `assigns tier 1 to FBI` — expects `priority === 1`
2. `assigns tier 1 to SLC metro` — expects `priority === 1`
3. `assigns tier 2 to Denver` — expects `priority === 2`
4. `assigns tier 4 to Alaska` — expects `priority === 4`
5. `leaves unknown sources at tier 3` — expects `priority === 3`
6. `reports correct updated count` — expects `.updated === 4`

**Step 4: Run test — expect it to fail first, then pass**

Run: `cd server && npx vitest run tests/seeds/seedScraperPriorities.test.ts`
Initially expect compilation fail (seed function doesn't exist yet) → write it → tests pass.

**Step 5: Commit**

```bash
git add server/src/seeds/seedScraperPriorities.ts server/tests/seeds/seedScraperPriorities.test.ts
git commit -m "feat(warrants): seed scraper priority tiers (phase 1)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Create `scraperRunner.ts` helper module

**Files:**
- Create: `server/src/utils/scraperRunner.ts`

**Step 1: Write the module**

Export these functions, each accepting optional `dbOverride?: Database.Database` as final parameter:

1. `startRun(opts: { source_key: string; priority?: number }, dbOverride?): number`
   - INSERT row with `source_key` and `started_at = localNow()`
   - Return `lastInsertRowid`

2. `completeRun(runId: number, opts: RunCompleteOptions, dbOverride?): void`
   - Compute `duration_ms` as `Date.now() - new Date(started_at).getTime()`
   - UPDATE row setting `finished_at`, `duration_ms`, `http_status`, `bytes_received`, `parsed_count`, `inserted_count`, `updated_count`, `skipped_reason`, `parser_used`

3. `failRun(runId: number, opts: { http_status?: number; error_message: string }, dbOverride?): void`
   - Compute `duration_ms` same way
   - UPDATE row setting `finished_at`, `duration_ms`, `http_status`, `error_message`

4. `pruneRuns(keepPerSource: number = 500, dbOverride?): { deleted: number }`
   - Use a DELETE with a `ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY started_at DESC)` subquery
   - Return `{ deleted: result.changes }`

Import `getDb` from `../models/database` and `localNow` from `./timeUtils`. Define interfaces: `RunStartOptions`, `RunCompleteOptions`, `RunFailOptions`. The `skipped_reason` field is a union: `'content_unchanged' | 'not_modified' | 'circuit_broken' | null`. The `parser_used` field is `'custom' | 'generic' | 'fallback'`.

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Write tests**

Create: `server/tests/utils/scraperRunner.test.ts`

Test setup: in-memory DB, manually create `warrant_scraper_runs` table with the same schema as Task 1.2, pass as dbOverride to all calls.

Required tests:
1. `startRun inserts a row and returns its ID` — assert lastInsertRowid > 0 and row exists with matching source_key
2. `completeRun updates the row with status and counts` — assert http_status, parsed_count, parser_used, finished_at are set
3. `completeRun with skipped_reason records no parse` — assert skipped_reason field set and parsed_count is 0
4. `failRun records error message` — assert error_message and finished_at are set
5. `pruneRuns keeps only N most recent per source` — insert 10 rows for source_a and 5 for source_b, call `pruneRuns(3)`, assert each source has exactly 3 rows remaining, total deleted is 9

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/utils/scraperRunner.test.ts`
Expected: 5 tests pass.

**Step 5: Commit**

```bash
git add server/src/utils/scraperRunner.ts server/tests/utils/scraperRunner.test.ts
git commit -m "feat(warrants): add scraperRunner helper for run lifecycle tracking

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Wire `scraperRunner` into existing `syncSource()`

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts:1489` (the `syncSource` function)

**Step 1: Read the current syncSource implementation**

Use the Read tool on `server/src/utils/multiStateWarrantScraper.ts` with `offset: 1489, limit: 75` to see the whole function.

**Step 2: Import the runner**

Add to the imports at the top of `multiStateWarrantScraper.ts`:

```typescript
import { startRun, completeRun, failRun } from './scraperRunner';
```

**Step 3: Wrap the syncSource logic with run tracking**

Purely additive — keep all existing logic. Three insertion points:

1. **After entering syncSource, before config check**: call `const runId = startRun({ source_key: sourceKey })`. If config is disabled or circuit_broken, call `completeRun(runId, { skipped_reason: 'circuit_broken' })` and return.

2. **After successful parse/upsert**, call:
   ```typescript
   completeRun(runId, {
     http_status: 200,
     parsed_count: entries.length,
     inserted_count: inserted,
     updated_count: updated,
     parser_used: WARRANT_PARSERS[sourceKey] ? 'custom' : 'generic',
   });
   ```

3. **In the catch block**: call `failRun(runId, { error_message: (err as Error).message })` BEFORE the existing error bookkeeping.

**Critical**: do NOT remove any existing code in `syncSource`. Only add the three calls. Leave existing `last_scrape_at` updates, circuit breaker logic, backoff timers, etc. exactly as-is.

**Step 4: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 5: Smoke test**

Write a short tsx script that imports `scheduleWarrantScraper` (verifying the module compiles and imports work) — just log `'OK'`.
Expected: `OK`.

**Step 6: Manual verification in dev**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && npm run dev` (let it boot for 90s, then Ctrl+C)
Expected: Server boots, scraper scheduler runs, `warrant_scraper_runs` has new rows.

Verify: write a tsx one-liner that selects the 5 most recent runs and logs them. Expect 1–5 rows with source_key values.

**Step 7: Commit**

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): wire scraperRunner into syncSource (phase 1)

Each scrape run now logs a row in warrant_scraper_runs with duration,
http status, parsed/inserted/updated counts, and parser used. Zero
behavior change — purely additive tracking.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: Create `scraperMetrics.ts` aggregator

**Files:**
- Create: `server/src/utils/scraperMetrics.ts`

**Step 1: Write the module**

Export three functions:

1. `getSourceMetrics(sourceKey: string, windowHours: number = 24, dbOverride?): SourceMetrics`
   - Query `warrant_scraper_runs` WHERE `source_key = ?` AND `started_at >= datetime('now', '-N hours')`
   - Compute: `total_runs`, `successful_runs` (http_status = 200 AND parsed_count > 0), `unchanged_runs` (skipped_reason matches or http_status = 304), `failed_runs` (error_message present or 4xx/5xx other than 404), `success_rate` ((successful + unchanged) / total)
   - Compute p50/p95 from sorted duration_ms array (implement `percentile()` helper)
   - Compute `avg_duration_ms` and `avg_parsed` as simple means
   - Find `last_error`, `last_error_at`, `last_success_at` by scanning rows
   - Build `status_distribution` Record from http_status values
   - Call `computeHealthGrade()` for `health_grade` field

2. `computeHealthGrade(successRate: number, lastSuccessAt: string | null, intervalHours: number): ScraperHealthGrade`
   - Return 'F' if `!lastSuccessAt`
   - Compute `staleMultiple = hoursSinceSuccess / intervalHours`
   - Grade thresholds:
     - A: successRate >= 0.95 AND staleMultiple < 2
     - B: successRate >= 0.80 AND staleMultiple < 4
     - C: successRate >= 0.50 OR staleMultiple < 12
     - D: successRate >= 0.20 OR staleMultiple < 24
     - F: otherwise

3. `getHealthSummary(dbOverride?): HealthSummary`
   - Query enabled source count, circuit_broken count
   - Iterate each enabled source, call `getSourceMetrics` for 24h window, count by health_grade into healthy (A/B), degraded (C), failed (D/F)
   - Query last hour's run count and sum of inserted_count
   - Return `HealthSummary`

Export types: `ScraperHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'`, `SourceMetrics`, `HealthSummary`.

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Write tests**

Create: `server/tests/utils/scraperMetrics.test.ts`

Test setup: in-memory DB with both `warrant_scraper_config` and `warrant_scraper_runs` schemas.

Required tests for `computeHealthGrade`:
1. `returns F when no successes ever` — `computeHealthGrade(0, null, 3)` is 'F'
2. `returns A for fresh and high success rate` — fresh timestamp (30 min ago), rate 0.98, interval 3h → 'A'
3. `returns F for stale even with high rate` — stale timestamp (30h ago), rate 0.98, interval 1h → 'F'
4. `returns C for moderate success` — fresh, rate 0.6 → 'C'

Required tests for `getSourceMetrics`:
1. `returns zero metrics when no runs` — unknown source → total_runs 0, grade F
2. `computes success rate correctly` — insert 2 successful + 1 failed, expect success_rate ≈ 2/3
3. `computes p50 and p95 correctly` — insert durations [10,20,...,100], expect p50 = 50, p95 = 100
4. `counts unchanged runs separately` — insert 304 + content_unchanged runs, expect unchanged_runs = 2, success_rate = 1

Required test for `getHealthSummary`:
1. `aggregates grades across sources` — insert 2 config rows, 1 successful run for one, verify summary.total = 2 and grades sum correctly

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/utils/scraperMetrics.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add server/src/utils/scraperMetrics.ts server/tests/utils/scraperMetrics.test.ts
git commit -m "feat(warrants): add scraperMetrics aggregator with health grading

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.7: Nightly prune + metrics rollup job

**Files:**
- Create: `server/src/utils/scraperNightlyJob.ts`
- Modify: `server/src/index.ts` (add setInterval in the boot sequence around line 657)

**Step 1: Write the nightly job**

Export `runScraperNightly(): void`. Wrap entire body in try/catch. Three steps:

1. Call `pruneRuns(500)` from scraperRunner, log `[Scraper Nightly] Pruned N old run rows`
2. Select all enabled sources, for each call `getSourceMetrics(source_key, 168)` (7-day window), UPDATE `warrant_scraper_config` SET `avg_parse_count = ?, p95_latency_ms = ?` WHERE source_key = ?
3. Call `getHealthSummary()`, build a summary message, call `createNotificationForRoles(['admin', 'manager'], 'system', 'Daily Warrant Scraper Report', msg, 'warrant_scraper_daily', 0, 'low')`

**Step 2: Wire into boot sequence**

In `server/src/index.ts`, find the block around line 657 that starts `scheduleWarrantScraper()`. Add immediately after:

- Import `runScraperNightly` dynamically with `await import('./utils/scraperNightlyJob')`
- First run delayed 6h via `setTimeout(() => runScraperNightly(), 6 * 60 * 60_000)`
- Then every 24h via `setInterval(() => runScraperNightly(), 24 * 60 * 60_000)`
- Call `.unref()` on the interval so it doesn't block shutdown

Wrap in try/catch that warns but doesn't crash the server.

**Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Verify `createNotificationForRoles` exists**

Use Grep tool: pattern `createNotificationForRoles` in `server/src/utils/notifications.ts`. Expected: function definition found. If not, use `createNotification` instead and adjust the call signature to match.

**Step 5: Commit**

```bash
git add server/src/utils/scraperNightlyJob.ts server/src/index.ts
git commit -m "feat(warrants): nightly prune + metrics rollup job (phase 1)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 1 Verification

**Step 1: Full typecheck**

Run: `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`
Expected: 0 errors in both.

**Step 2: Full test suite**

Run: `cd server && npx vitest run`
Expected: All tests pass including the 3 new test files.

**Phase 1 exit criteria**: new columns exist, `warrant_scraper_runs` table exists, runs populate automatically, tests pass, no TypeScript errors. Safe to deploy.

---

## Phase 2 — Smart Scheduling

**Phase goal:** Tier-based intervals, jitter, content hashing, concurrency cap, retry backoff. Cut request volume by ~50%.

### Task 2.1: Add tier interval resolution + jitter

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Add helper constants and functions**

Insert near the top of the file (after existing constants around line 33):

```typescript
const TIER_INTERVALS_MS: Record<number, number> = {
  1: 30 * 60_000,    // 30 min — critical
  2: 90 * 60_000,    // 90 min — high
  3: 180 * 60_000,   // 180 min — normal (default)
  4: 360 * 60_000,   // 360 min — low
};

function resolveInterval(config: WarrantSourceConfig): number {
  if (config.scrape_interval_minutes && config.scrape_interval_minutes > 0) {
    return config.scrape_interval_minutes * 60_000; // explicit override
  }
  const priority = (config as any).priority ?? 3;
  return TIER_INTERVALS_MS[priority] ?? TIER_INTERVALS_MS[3];
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function resolveJitterMs(sourceKey: string): number {
  // Deterministic 0-20 minute offset based on source key hash
  return (simpleHash(sourceKey) % 1200) * 1000;
}
```

**Step 2: Update `scheduleSource()` to use tier interval + jitter**

Find `scheduleSource()` around line 1566. Modify:
- Replace `const intervalMs = (config.scrape_interval_minutes || 120) * 60_000;` with `const intervalMs = resolveInterval(config);`
- Add `const jitterMs = resolveJitterMs(sourceKey);`
- Change the "Initial scrape" line from immediate to `setTimeout(() => syncSource(sourceKey).catch(...), jitterMs)`
- Keep the recurring `setInterval(intervalMs)` unchanged

**Step 3: Update `WarrantSourceConfig` interface**

Find the interface at line 64. Add optional fields:

```typescript
priority?: number;
content_hash?: string | null;
etag?: string | null;
last_modified?: string | null;
last_success_at?: string | null;
```

**Step 4: Update `getSourceConfig()` and `getSourceConfigs()` SELECT**

Find both functions (lines 1402 and 1407). Replace `SELECT * FROM warrant_scraper_config` with an explicit column list including all new Phase 1 columns. Match the column order to the interface.

**Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): tier-based scheduling with deterministic jitter (phase 2)

Adds resolveInterval() (30/90/180/360 min by priority tier) and
resolveJitterMs() (0-20 min deterministic offset from source_key hash).
Prevents scheduler boot storms.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Add concurrency cap semaphore

**Files:**
- Create: `server/src/utils/semaphore.ts`
- Create: `server/tests/utils/semaphore.test.ts`
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Write the semaphore**

Class `Semaphore`:
- Constructor: `constructor(permits: number)` — stores permits count
- `acquire(): Promise<void>` — if permits > 0, decrement and resolve immediately; else push resolve onto queue and return pending promise
- `release(): void` — if queue non-empty, shift and call the resolver; else increment permits
- Getters: `available` (current permits), `waiting` (queue length)

**Step 2: Write tests**

Create: `server/tests/utils/semaphore.test.ts`

Required tests:
1. `allows up to N concurrent acquires` — new Semaphore(3), call acquire() 3 times, expect `available === 0`
2. `blocks when at capacity and resumes after release` — Semaphore(1), acquire once, start a second acquire (don't await yet), sleep 10ms, assert the second is still pending, then release, then await the second, assert it resolved
3. `tracks waiting count` — Semaphore(1), acquire once, start 2 more acquires, sleep, assert waiting === 2, release twice, assert waiting === 0

**Step 3: Run tests**

Run: `cd server && npx vitest run tests/utils/semaphore.test.ts`
Expected: 3 tests pass.

**Step 4: Integrate into `syncSource()`**

In `multiStateWarrantScraper.ts`, add near imports:

```typescript
import { Semaphore } from './semaphore';
const FETCH_CONCURRENCY = 5;
const fetchSemaphore = new Semaphore(FETCH_CONCURRENCY);
```

In `syncSource()`, wrap the HTTP fetch calls with `await fetchSemaphore.acquire()` / `fetchSemaphore.release()` (in a try/finally).

**Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add server/src/utils/semaphore.ts server/tests/utils/semaphore.test.ts server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): concurrency cap via semaphore (phase 2)

Limits concurrent HTTP fetches to 5 to prevent boot-storm
socket exhaustion and WAF correlation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: Content hashing + conditional requests

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Upgrade `fetchPage()` signature**

Replace the current function (line 101) with a new signature:

```typescript
export interface FetchResult {
  body: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
}

async function fetchPage(
  url: string,
  opts: { retries?: number; etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult>
```

Implementation:
- Default retries to 3
- Build headers as before, plus `If-None-Match` from `opts.etag` and `If-Modified-Since` from `opts.lastModified` when provided
- On HTTP 304 → return `{ body: '', status: 304, etag: null, lastModified: null, bytes: 0 }` immediately
- On HTTP 5xx, 429, 408 → throw to trigger retry
- On other responses → read body, return `{ body, status: res.status, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), bytes: body.length }`
- Retry backoff: `Math.min(1000 * 2**attempt, 8000) + Math.random() * 500` ms
- After all retries exhausted, throw lastErr

**Step 2: Add SHA-256 helper**

Add near the top of the file:

```typescript
import { createHash } from 'node:crypto';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

**Step 3: Update `syncSource()` to use conditional requests + hash check**

Before the existing fetch call in syncSource:

1. Call `fetchPage(config.source_url, { etag: config.etag, lastModified: config.last_modified })` (assigned to `fetchResult`)
2. **304 handling**: if `fetchResult.status === 304`, call `completeRun(runId, { http_status: 304, skipped_reason: 'not_modified', bytes_received: 0 })`, UPDATE config setting `last_scrape_at = localNow()` and `last_success_at = localNow()`, release the semaphore, return
3. **Hash check**: compute `newHash = sha256(fetchResult.body)`. If `newHash === config.content_hash`, call `completeRun` with `skipped_reason: 'content_unchanged'`, update last_scrape_at and last_success_at, release semaphore, return
4. **Parse path**: call `parseWithFallback` (added in Task 3.1 — use plain parser for now, update when Task 3.1 lands) with the body, upsert warrants, then UPDATE config SET `content_hash = newHash, content_hash_updated_at = localNow(), etag = fetchResult.etag, last_modified = fetchResult.lastModified, last_scrape_at = localNow(), last_success_at = localNow(), consecutive_errors = 0, circuit_broken = 0`
5. Call completeRun with http_status 200, parsed/inserted/updated counts

**Critical preservation**: Do NOT remove pagination (PAGINATED_SOURCES loop), 403 handling, circuit breaker logic, backoff state management. Only swap out the fetch + parse + upsert block in the main success path.

**Step 4: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 5: Smoke test**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && timeout 120 npm run dev` then Ctrl+C, then write a tsx one-liner that selects `source_key, substr(content_hash, 1, 10) as hash_prefix` from `warrant_scraper_config` where `content_hash IS NOT NULL LIMIT 3`.
Expected: 1–3 rows with non-null hash prefixes.

**Step 6: Commit**

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): conditional fetch + content hashing + exp backoff (phase 2)

- fetchPage now sends If-None-Match / If-Modified-Since
- 304 responses skip parse entirely
- SHA-256 body hash short-circuits re-parse on unchanged content
- Retry uses 1s -> 2s -> 4s -> 8s exponential backoff with jitter
- Preserves all existing error handling and circuit breaker logic

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 2 Verification

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 0 TS errors, all tests pass.

Monitor for 48h post-deploy: `warrant_scraper_runs` should show increased `skipped_reason` counts, and `success_rate` in metrics should stay stable.

---

## Phase 3 — Parser Resilience

**Phase goal:** Fallback cascade, drift detection, WAF detection, CLI dev harness.

### Task 3.1: Parser fallback cascade

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Write `parseWithFallback`**

Add (and `export`) after existing parser definitions:

```typescript
export interface ParseResult {
  entries: WarrantEntry[];
  parserUsed: 'custom' | 'generic' | 'fallback';
  driftSignal?: string;
}

export function parseWithFallback(config: WarrantSourceConfig, html: string): ParseResult {
  const customParser = WARRANT_PARSERS[config.source_key];

  // Tier 1: custom parser
  if (customParser) {
    try {
      const entries = customParser.parseWarrants(html);
      if (entries.length > 0) {
        return { entries, parserUsed: 'custom' };
      }
      return { ...runGeneric(config.source_key, html), driftSignal: 'custom_zero_results' };
    } catch (err) {
      return {
        ...runGeneric(config.source_key, html),
        driftSignal: `custom_threw:${(err as Error).message.substring(0, 80)}`,
      };
    }
  }

  return runGeneric(config.source_key, html);
}

function runGeneric(sourceKey: string, html: string): ParseResult {
  try {
    const generic = createGenericWarrantParser(sourceKey);
    const entries = generic.parseWarrants(html);
    if (entries.length > 0) {
      return { entries, parserUsed: 'generic' };
    }
  } catch { /* fall through */ }

  // Tier 3: last-ditch name extraction
  const names = extractAllCapsNames(html);
  return {
    entries: names.map(n => createBlankEntry(n)),
    parserUsed: 'fallback',
  };
}

function extractAllCapsNames(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const matches = text.match(/\b[A-Z]{2,}(?:,\s*[A-Z]{2,})?(?:\s+[A-Z]{2,})?\b/g) || [];
  const uniq = new Set<string>();
  for (const m of matches) {
    if (m.length >= 5 && m.length <= 60) uniq.add(m.trim());
  }
  return Array.from(uniq).slice(0, 50);
}

function createBlankEntry(name: string): WarrantEntry {
  const parts = name.includes(',') ? name.split(',').map(s => s.trim()) : name.split(/\s+/);
  const [last = '', first = ''] = parts;
  return {
    warrant_id: '', full_name: name, first_name: first, last_name: last, middle_name: '',
    date_of_birth: '', age: null, gender: '', race: '', city: '', state: '',
    warrant_type: 'unknown', case_number: '', court_name: '', issue_date: '',
    charge_description: '', bail_amount: '', offense_level: '', photo_url: '',
    detail_url: '',
  };
}
```

**Step 2: Replace parser calls in `syncSource()`**

Find the direct parser invocation (look for `.parseWarrants(`). Replace with:

```typescript
const { entries, parserUsed, driftSignal } = parseWithFallback(config, fetchResult.body);
if (driftSignal) {
  console.warn(`[Warrant Scraper] Drift signal for ${sourceKey}: ${driftSignal}`);
}
```

Update the `completeRun` call to include `parser_used: parserUsed`.

**Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): parser fallback cascade (phase 3)

custom -> generic -> all-caps name extraction. Logs drift signal
when custom parser returns 0 results or throws.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: WAF / block page detection

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Add detection function**

```typescript
function detectBlockPage(html: string): string | null {
  if (!html || html.length < 200) return 'response_too_small';
  if (/Just a moment\.\.\.|Attention Required|cf-browser-verification|cf-chl-bypass/i.test(html)) {
    return 'cloudflare_challenge';
  }
  if (/Access Denied|You don't have permission|Request blocked/i.test(html)) {
    return 'access_denied';
  }
  if (/<title>403/i.test(html)) return 'http_403_wrapper';
  return null;
}
```

**Step 2: Use in `syncSource()` before parsing**

After receiving `fetchResult` and before calling `parseWithFallback`:

```typescript
const blockReason = detectBlockPage(fetchResult.body);
if (blockReason) {
  failRun(runId, { http_status: fetchResult.status, error_message: `blocked:${blockReason}` });
  handleFailure(sourceKey, new Error(`blocked:${blockReason}`));
  fetchSemaphore.release();
  return;
}
```

**Step 3: Typecheck and commit**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): WAF / block page detection (phase 3)

Classifies cloudflare challenges, access denied pages, and
suspiciously small responses as distinct failure reasons so
the dashboard can separate 'site blocking us' from 'parser broken'.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: CLI dev harness for parser testing

**Files:**
- Create: `server/scripts/scrapers.ts`
- Modify: `server/package.json` (add script)

**Step 1: Write the CLI**

Top-level structure:

```typescript
#!/usr/bin/env node
// Warrant Scrapers CLI
// Usage: npm run scrapers <command> [args]

import { readFileSync } from 'node:fs';
import { getDb } from '../src/models/database';
import { getSourceMetrics, getHealthSummary } from '../src/utils/scraperMetrics';

const [, , command, ...args] = process.argv;

function flag(name: string): string | null {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
}

function arg(index: number): string | null {
  const positional = args.filter(a => !a.startsWith('--'));
  return positional[index] ?? null;
}

async function main() {
  switch (command) {
    case 'status': { /* ... */ break; }
    case 'test':   { /* ... */ break; }
    case 'trigger': { /* ... */ break; }
    case 'reset':   { /* ... */ break; }
    case 'metrics': { /* ... */ break; }
    default:
      console.log('Usage: npm run scrapers <status|test|trigger|reset|metrics>');
      process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

Per-command behavior:

- **status**: Call `getHealthSummary()`, print counts. Optional `--grade=F` flag filters by grade. Iterate enabled sources, print a table: source_key, state, grade, runs, success_rate, last_error.
- **test**: Require positional source_key. Optional `--file=path`. If file provided, read HTML from disk; otherwise fetch via `globalThis.fetch(config.source_url)`. Dynamically import `parseWithFallback` from `../src/utils/multiStateWarrantScraper`, call it, print parser_used, drift_signal, entry count, sample first 5 entries with field completeness %.
- **trigger**: Require source_key. Dynamically import `syncSource`, call it, log "done, check warrant_scraper_runs".
- **reset**: Require source_key. UPDATE config SET consecutive_errors = 0, circuit_broken = 0.
- **metrics**: Require source_key. Optional `--window=24`. Call `getSourceMetrics(sourceKey, window)`, print as JSON.

**Step 2: Add npm script**

Edit `server/package.json` and add to the `scripts` object:

```json
"scrapers": "npx tsx scripts/scrapers.ts"
```

**Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Smoke test CLI**

Run: `cd server && npm run scrapers status --grade=F`
Expected: list of failed sources or "0 rows".

Run: `cd server && npm run scrapers metrics fed_fbi_wanted --window=24`
Expected: JSON metrics object.

**Step 5: Commit**

```bash
git add server/scripts/scrapers.ts server/package.json
git commit -m "feat(warrants): CLI dev harness for scraper ops (phase 3)

npm run scrapers status|test|trigger|reset|metrics

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 3 Verification

Run: `cd server && npx tsc --noEmit && npx vitest run && npm run scrapers status`
Expected: All pass, CLI shows source list.

---

## Phase 4 — HTTP API + WebSocket Events

**Phase goal:** Read endpoints, action endpoints, WebSocket events, alerting hooks.

### Task 4.1: Read endpoints for scraper health

**Files:**
- Modify: `server/src/routes/warrants.ts`

**Step 1: Find the insertion point**

Use Grep tool: pattern `router.get.*'/:id'` in `server/src/routes/warrants.ts`.
Expected: One match showing the line number. New routes must be inserted BEFORE this line.

**Step 2: Import metrics module**

Near the top of `warrants.ts`:

```typescript
import { getSourceMetrics, getHealthSummary } from '../utils/scraperMetrics';
```

**Step 3: Add a warning comment block before the new routes**

```typescript
// ═══════════════════════════════════════════════════════════════
// ⚠️  ROUTE ORDER SENSITIVE — /:id below is parameterized and greedy.
// All /scrapers/* routes MUST appear ABOVE router.get('/:id', ...).
// See CLAUDE.md "Express Route Ordering" rule.
// ═══════════════════════════════════════════════════════════════
```

**Step 4: Add the 5 read endpoints**

All BEFORE `/:id`:

1. **GET /scrapers** — SELECT all sources with a computed `warrant_count` subquery, ORDER BY priority, state, county. Map over rows and attach `metrics_24h: getSourceMetrics(s.source_key, 24)` to each. Return `{ sources: withMetrics }`.

2. **GET /scrapers/health** — Wrap `getHealthSummary()` in try/catch, return as JSON. This route must appear BEFORE `/scrapers/:source_key` to avoid `:source_key` catching "health".

3. **GET /scrapers/metrics/summary** — Accept optional `?window=24` query param. Iterate enabled sources, build aggregate: `total_runs`, `total_warrants_inserted`, `total_warrants_updated`, `avg_success_rate`, `grade_distribution: { A, B, C, D, F }`. This also must appear BEFORE `/scrapers/:source_key`.

4. **GET /scrapers/:source_key** — Fetch config row, 404 if not found, return `{ ...source, metrics_24h: getSourceMetrics(..., 24), metrics_7d: getSourceMetrics(..., 168) }`.

5. **GET /scrapers/:source_key/runs** — Query `warrant_scraper_runs` WHERE source_key = ? ORDER BY started_at DESC LIMIT ? OFFSET ?. Clamp limit to 200 max.

All wrapped in try/catch with `console.error` and 500 responses. All return proper error codes.

**Step 5: Verify route ordering**

Use Grep tool: pattern `router\.(get|post|put|delete)` in `server/src/routes/warrants.ts`, then manually verify that:
- `/scrapers/health` appears BEFORE `/scrapers/:source_key`
- `/scrapers/metrics/summary` appears BEFORE `/scrapers/:source_key`
- All `/scrapers/*` routes appear BEFORE `/:id`

**Step 6: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 7: Manual test**

Start dev server. Use `curl http://localhost:3001/api/warrants/scrapers/health` (expect 401 Auth required without JWT — that's fine, means route is mounted). With a JWT in header, expect JSON health summary.

**Step 8: Commit**

```bash
git add server/src/routes/warrants.ts
git commit -m "feat(warrants): scraper read API endpoints (phase 4)

GET /api/warrants/scrapers            — list with metrics
GET /api/warrants/scrapers/health     — cheap summary for badge
GET /api/warrants/scrapers/metrics/summary
GET /api/warrants/scrapers/:source_key
GET /api/warrants/scrapers/:source_key/runs

All defined above /:id parameterized route per CLAUDE.md ordering rule.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.2: Action endpoints (trigger / test / reset / update / preview / bulk)

**Files:**
- Modify: `server/src/routes/warrants.ts`

**Step 1: Add routes (all above `/:id`)**

All gated to `admin` + `manager` via `requireRole('admin', 'manager')`. All wrapped in try/catch. All call `auditLog` on success.

1. **POST /scrapers/:source_key/trigger** — Verify source exists. Dynamically import `syncSource` from multiStateWarrantScraper, fire-and-forget the scrape (don't await), return `{ success: true, source_key, message: 'Scrape initiated' }`. Log to audit.

2. **POST /scrapers/:source_key/test** — Dry run. Fetch source config, fetch URL via `globalThis.fetch`, call `parseWithFallback`, return `{ source_key, http_status, bytes, parser_used, drift_signal, entry_count, sample: entries.slice(0, 10) }`. No DB writes.

3. **POST /scrapers/:source_key/reset-circuit** — UPDATE config SET `consecutive_errors = 0, circuit_broken = 0` WHERE source_key. 404 if changes === 0. Audit log.

4. **PUT /scrapers/:source_key** — Accept `{ priority?, scrape_interval_minutes?, enabled? }` in body. Validate priority ∈ {1,2,3,4}, interval ∈ [5, 1440]. Build dynamic UPDATE with collected fields. 400 if no fields. 404 if source not found. Audit log.

5. **POST /scrapers/:source_key/preview** — Accept `{ html: string }` in body. Validate length ≤ 5MB. Fetch config (404 if not found). Call `parseWithFallback(config, html)`. Return `{ parser_used, drift_signal, entry_count, entries }`. No fetch, no DB write.

6. **POST /scrapers/bulk** — Accept `{ action: 'enable'|'disable'|'reset'|'set_priority', source_keys: string[], priority?: number }`. Validate action and source_keys (max 200). Build placeholders string. Switch on action:
   - enable: `UPDATE ... SET enabled = 1 WHERE source_key IN (...)`
   - disable: `UPDATE ... SET enabled = 0 WHERE source_key IN (...)`
   - reset: `UPDATE ... SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key IN (...)`
   - set_priority: validate priority 1-4, then `UPDATE ... SET priority = ? WHERE source_key IN (...)`
   - Return `{ success: true, affected: result.changes }`. Audit log with count.

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Verify route ordering again**

Use Grep tool to confirm all scraper routes precede the `/:id` route.

**Step 4: Commit**

```bash
git add server/src/routes/warrants.ts
git commit -m "feat(warrants): scraper action API endpoints (phase 4)

POST /trigger, /test, /reset-circuit, /preview, /bulk
PUT  /:source_key (priority, interval, enabled)

All gated to admin+manager. All above /:id per route ordering rule.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.3: WebSocket events on run lifecycle

**Files:**
- Modify: `server/src/utils/multiStateWarrantScraper.ts`

**Step 1: Find the broadcaster function**

Use Grep tool: pattern `export.*function.*broadcast` in `server/src/utils/websocket.ts`.
Expected: one or more broadcast functions. Use whichever is canonical (likely `broadcastDispatchUpdate` or a channel-specific one).

**Step 2: Import and emit events**

Import the broadcaster. In `syncSource()`, emit events at lifecycle points:

- After `startRun`: emit `{ type: 'scraper_event', event: 'run_started', source_key, priority: config.priority, started_at: localNow() }`
- After successful `completeRun`: emit `{ type: 'scraper_event', event: 'run_completed', source_key, duration_ms, parsed: entries.length, inserted, updated, http_status: fetchResult.status }`
- After `failRun`: emit `{ type: 'scraper_event', event: 'run_failed', source_key, error: (err as Error).message, consecutive_errors: errorCount }`
- On circuit break (where `circuit_broken = 1` is set): emit `{ type: 'scraper_event', event: 'circuit_broken', source_key, recovery_at: new Date(Date.now() + backoffMs).toISOString() }`

**Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add server/src/utils/multiStateWarrantScraper.ts
git commit -m "feat(warrants): broadcast scraper run events over WebSocket (phase 4)

Emits run_started, run_completed, run_failed, circuit_broken events
via existing broadcastDispatchUpdate so the Scrapers tab can show
a live feed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.4: Alert conditions (circuit break, parser drift, mass failure)

**Files:**
- Create: `server/src/utils/scraperAlerts.ts`
- Modify: `server/src/utils/multiStateWarrantScraper.ts`
- Modify: `server/src/utils/scraperNightlyJob.ts`

**Step 1: Write the alerts module**

Export three functions:

1. `alertCircuitBroken(sourceKey: string, displayName: string): void` — call `createNotificationForRoles(['admin', 'manager'], 'system', 'Warrant Scraper Circuit Broken', <msg>, 'warrant_scraper_circuit', 0, 'high')`.

2. `checkParserDrift(sourceKey: string, displayName: string): void` — query last 5 runs for this source, check if ALL are HTTP 200 AND parsed_count === 0 AND no error_message. If so, fire notification with category 'warrant_scraper_drift' and priority 'high'.

3. `checkMassFailure(): void` — rate-limited (module-level `lastMassFailureAlertAt`, 1h cooldown). Call `getHealthSummary()`, compute `failRate = summary.failed / summary.total`. If > 0.30 AND cooldown passed, fire notification.

**Step 2: Hook `alertCircuitBroken`**

In multiStateWarrantScraper.ts, find where `circuit_broken = 1` is set. Add `alertCircuitBroken(sourceKey, config.display_name)` call right after.

**Step 3: Hook `checkParserDrift`**

In syncSource, after the successful parse path where `parsed_count === 0`:

```typescript
if (entries.length === 0 && fetchResult.status === 200) {
  checkParserDrift(sourceKey, config.display_name);
}
```

**Step 4: Hook `checkMassFailure`**

In `scraperNightlyJob.ts`, import `checkMassFailure` and call it at the end of `runScraperNightly()`.

**Step 5: Typecheck and commit**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

```bash
git add server/src/utils/scraperAlerts.ts server/src/utils/multiStateWarrantScraper.ts server/src/utils/scraperNightlyJob.ts
git commit -m "feat(warrants): scraper alert conditions (phase 4)

- Circuit break -> notification
- 5 consecutive HTTP 200 + 0 parsed -> parser drift alert
- >30% failing sources -> mass failure alert (1h rate limit)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 4 Verification

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 0 errors, all tests pass.

Manual: `curl http://localhost:3001/api/warrants/scrapers/health` (with auth) returns health summary.

---

## Phase 5 — UI Surfaces

**Phase goal:** Scrapers tab inside WarrantsPage, AdminPage section, dispatch header badge.

### Task 5.1: Shared scraper types

**Files:**
- Create: `client/src/types/scrapers.ts`

**Step 1: Write types file**

Export types matching the server-side metric shapes:

- `ScraperHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'`
- `ScraperPriority = 1 | 2 | 3 | 4`
- `SourceMetrics` interface (matching scraperMetrics.ts SourceMetrics)
- `ScraperSource` interface (matching the /scrapers endpoint row shape, including `metrics_24h: SourceMetrics` and `warrant_count: number`)
- `ScraperHealthSummary` (matching getHealthSummary return)
- `ScraperRun` (matching warrant_scraper_runs row shape)
- `ScraperEvent` (discriminated union of run_started / run_completed / run_failed / circuit_broken / circuit_restored / priority_changed / drift_detected events)

**Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add client/src/types/scrapers.ts
git commit -m "feat(warrants): shared scraper types for UI (phase 5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: Scrapers tab main component

**Files:**
- Create: `client/src/pages/warrants/tabs/ScrapersTab.tsx`

**Step 1: Write the tab component**

Default-exported function `ScrapersTab()`. State:
- `sources: ScraperSource[]`
- `summary: ScraperHealthSummary | null`
- `loading: boolean`
- `search, stateFilter, gradeFilter` — filter state
- `recentEvents: ScraperEvent[]` — ring buffer (last 50)

Effects:
- On mount: `fetchAll()` which calls both `/warrants/scrapers` and `/warrants/scrapers/health` in parallel via `Promise.all`, updates state
- `useLiveSync('scraper_events', msg => { if msg.type === 'scraper_event', prepend to recentEvents (cap 50), refetchAll on run_completed })`

Filtering (via useMemo):
- Build `uniqueStates` from sources
- Filter by state, grade, and search query (matches source_key, display_name, state, county)

Layout:
1. `ScraperHealthHeader` at top with summary + refresh
2. 3-column grid: ScraperHealthDistribution (2 cols) + ScraperLiveFeed (1 col)
3. Filter toolbar (search input, state select, grade select, refresh button)
4. Scrollable source list (maps `filtered` to `ScraperSourceCard` with `onRefresh={fetchAll}`)

Empty state: "No sources match filters" when filtered list empty.

Import subcomponents from relative paths. Use existing `panel-base` / `panel-raised` CSS classes. Scroll container must have `min-h-0 overflow-y-auto scrollbar-dark`.

**Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: Errors about missing subcomponents — proceed to Task 5.3 to create them.

---

### Task 5.3: Subcomponents for scrapers tab

**Files:**
- Create: `client/src/pages/warrants/tabs/ScraperHealthHeader.tsx`
- Create: `client/src/pages/warrants/tabs/ScraperHealthDistribution.tsx`
- Create: `client/src/pages/warrants/tabs/ScraperLiveFeed.tsx`
- Create: `client/src/pages/warrants/tabs/ScraperSourceCard.tsx`

**Step 1: `ScraperHealthHeader.tsx`**

Props: `{ summary: ScraperHealthSummary; onRefresh: () => void }`

Render a row in a `panel-raised` container with 4 status LEDs (green healthy, amber degraded, red failed, dark broken), a right-aligned "Last hour: N runs, M new" section, and a Refresh button.

Internal component `StatusLed({ color, label, count })` — colored dot with glow shadow (`shadow-[0_0_6px_#22c55e]` etc.) + count + uppercase label.

**Step 2: `ScraperHealthDistribution.tsx`**

Props: `{ sources: ScraperSource[] }`

Count sources by health_grade into an A-F histogram. Render a `panel-raised` with 5 horizontal bars. Each bar = grade label + progress bar (background rmpg-900, fill colored by grade, width = percentage) + count.

Grade colors: A=green-500, B=lime-500, C=amber-500, D=orange-500, F=red-500.

**Step 3: `ScraperLiveFeed.tsx`**

Props: `{ events: ScraperEvent[] }`

Fixed-max-height container showing last 50 events as a terminal-style log. Each row: timestamp + colored status dot + truncated source_key + event type. Colors: green (run_completed), red (run_failed), dark red (circuit_broken), rmpg-400 (other).

**Step 4: `ScraperSourceCard.tsx`**

Props: `{ source: ScraperSource; onRefresh: () => void }`

Internal state: `expanded: boolean`. Uses `useToast` from ToastProvider.

**Collapsed view** (clickable button):
- Tier pill (CRIT/HIGH/NORM/LOW) with fixed width
- Display name (truncated, flex-1)
- State (small, right-aligned)
- Grade badge (colored background per grade)
- Success rate percentage
- Warrant count
- Chevron (rotated when expanded)

**Expanded view** (when `expanded === true`):
- 2-column grid of metadata: URL, last success, runs 24h, avg parsed, p95 latency, consecutive errors
- If `last_error` present, show in `panel-inset` with red text
- Action row:
  - **Trigger** button → POST `/warrants/scrapers/{source_key}/trigger`, toast, refetch after 2s
  - **Reset Circuit** button → POST `/warrants/scrapers/{source_key}/reset-circuit`, toast, refetch
  - **View Source** link → opens `source.source_url` in new tab (target="_blank" rel="noopener noreferrer")

All actions wrapped in try/catch with error toasts.

**Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add client/src/pages/warrants/tabs/ScrapersTab.tsx client/src/pages/warrants/tabs/ScraperHealthHeader.tsx client/src/pages/warrants/tabs/ScraperHealthDistribution.tsx client/src/pages/warrants/tabs/ScraperLiveFeed.tsx client/src/pages/warrants/tabs/ScraperSourceCard.tsx
git commit -m "feat(warrants): scrapers tab UI components (phase 5)

Main tab + health header + distribution bars + live feed +
expandable source card with trigger/reset/view-source actions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.4: Mount scrapers tab in WarrantsPage

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

**Step 1: Find tab structure**

Use Grep tool: patterns `Tab\|activeTab\|tabs:` in `client/src/pages/WarrantsPage.tsx`. Read the relevant section to understand how tabs are defined and rendered.

**Step 2: Add 'scrapers' to tabs**

- Add `'scrapers'` to whatever type/array declares valid tab IDs
- Add a tab entry with icon (use `Activity` from lucide-react) and label "Scrapers"
- Add lazy import: `const ScrapersTab = lazy(() => import('./warrants/tabs/ScrapersTab'));`
- Add to the tab render switch: `{activeTab === 'scrapers' && <Suspense fallback={<Loading />}><ScrapersTab /></Suspense>}`

If `usePersistedTab` is used and has a validation array, add 'scrapers' to the list.

**Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants): mount scrapers tab in WarrantsPage (phase 5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.5: Header badge in Layout.tsx

**Files:**
- Modify: `client/src/components/Layout.tsx`

**Step 1: Add health polling state**

In the Layout component, add:

```typescript
const [scraperHealth, setScraperHealth] = useState<ScraperHealthSummary | null>(null);

useEffect(() => {
  const load = () => apiFetch<ScraperHealthSummary>('/warrants/scrapers/health').then(setScraperHealth).catch(() => {});
  load();
  const int = setInterval(load, 30_000);
  return () => clearInterval(int);
}, []);

const showBadge = scraperHealth && (scraperHealth.degraded + scraperHealth.failed + scraperHealth.circuit_broken) > 0;
```

Import `apiFetch` from `../hooks/useApi` and `ScraperHealthSummary` from `../types/scrapers`.

**Step 2: Render the badge**

In the header/toolbar JSX, place near other status indicators:

```tsx
{showBadge && (
  <button
    onClick={() => navigate('/warrants?tab=scrapers')}
    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-rmpg-700 hover:bg-rmpg-800"
    title="Warrant scraper health"
  >
    <span className="text-green-400">●{scraperHealth!.healthy}</span>
    {scraperHealth!.degraded > 0 && <span className="text-amber-400">◐{scraperHealth!.degraded}</span>}
    {scraperHealth!.failed > 0 && <span className="text-red-400">○{scraperHealth!.failed}</span>}
    {scraperHealth!.circuit_broken > 0 && <span className="text-red-600">✕{scraperHealth!.circuit_broken}</span>}
  </button>
)}
```

Crucial: the badge is **invisible** when all sources are A/B. This prevents alert fatigue — the header stays quiet unless something actually needs attention.

**Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(warrants): conditional scraper health badge in header (phase 5)

Invisible when all sources healthy (A/B grades). Appears only when
there's something wrong, to avoid alert fatigue. Clicking navigates
to the Scrapers tab.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.6: Admin page section (bulk ops)

**Files:**
- Create: `client/src/pages/admin/sections/WarrantScrapersSection.tsx`
- Modify: `client/src/pages/AdminPage.tsx` (import and render the new section)

**Step 1: Write the admin section**

Default-exported function `WarrantScrapersSection()`.

State:
- `sources: ScraperSource[]`
- `selected: Set<string>` — source_keys
- `useToast()` for feedback

Data loading: on mount, fetch `/warrants/scrapers` and set sources.

Bulk action helper:
```typescript
const bulk = async (action: string, priority?: number) => {
  try {
    await apiFetch('/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, source_keys: Array.from(selected), priority }),
    });
    addToast(`Bulk ${action} applied to ${selected.size} sources`, 'success');
    setSelected(new Set());
    fetch(); // reload
  } catch (e: any) { addToast(e.message || 'Bulk failed', 'error'); }
};
```

Layout:
- Header row: section title, count of sources, count of selected
- When `selected.size > 0`: show action bar with Enable / Disable / Reset Circuit / Priority dropdown / Clear buttons
- Dense table (max-height 400px scrollable):
  - Columns: checkbox, source_key, state, priority, enabled indicator, grade, warrant_count
  - Header checkbox toggles select-all
  - Row checkbox toggles individual selection
  - Styling: `text-[10px] font-mono`, `hover:bg-rmpg-800/50`

Use `sticky top-0` on header for sticky column headers during scroll.

**Step 2: Mount in AdminPage**

Use Grep tool: find existing section imports/render in `client/src/pages/AdminPage.tsx`. Follow the same pattern to add `WarrantScrapersSection`.

**Step 3: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

```bash
git add client/src/pages/admin/sections/WarrantScrapersSection.tsx client/src/pages/AdminPage.tsx
git commit -m "feat(warrants): admin page scrapers section (phase 5)

Dense multi-select table with bulk enable/disable/reset/priority.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 5 Verification

Run:
```bash
cd server && npx tsc --noEmit && npx vitest run
cd ../client && npx tsc --noEmit && npx vite build
```
Expected: 0 TS errors, all tests pass, Vite build succeeds.

Manual: deploy to VPS via `bash deploy/deploy.sh`, then navigate to `/warrants?tab=scrapers` and verify:
- Health header shows counts
- Distribution bars render
- Live feed updates as runs complete
- Source list filters work
- Expanding a source shows actions
- Trigger button works end-to-end
- Reset circuit button works
- Header badge appears when any source is degraded

---

## Final Verification (all phases)

**Step 1: Full typecheck + test + build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini"
cd server && npx tsc --noEmit && npx vitest run
cd ../client && npx tsc --noEmit && npx vite build
```
Expected: 0 TS errors in both, all tests pass, Vite build succeeds.

**Step 2: Bump service worker cache**

Edit `client/public/sw.js` — find `CACHE_NAME` and bump the version (e.g., `v151` → `v152`).

```bash
git add client/public/sw.js
git commit -m "chore: bump sw cache for warrant scraper enhancement"
```

**Step 3: Deploy**

```bash
bash deploy/deploy.sh
curl -sf https://rmpgutah.us/api/health
```
Expected: health endpoint returns OK.

**Step 4: Verify production**

- Log into rmpgutah.us, go to Warrants → Scrapers tab
- Verify ~173 sources listed
- Verify at least a few A grades (if none, wait 10 min for initial scrapes to complete)
- Trigger one source manually, watch live feed update
- Check `/api/warrants/scrapers/health` returns valid JSON

---

## Rollback Plan

Each phase is independently revertible. If Phase N breaks:

```bash
git log --oneline | grep "phase $N" # find offending commits
git revert <commit-sha-1> <commit-sha-2> ...
bash deploy/deploy.sh
```

Database changes are backward-compatible — new columns are all nullable, new table is additive. No data loss from revert.

If Phase 2 content hashing causes missed warrants, emergency bypass via direct UPDATE on production DB to clear `content_hash` — next scrape cycle will re-parse everything from scratch.

---

## Summary

**5 phases, ~30 atomic tasks, all deployable independently.**

- **Phase 1**: Data model + run tracking (invisible, data starts flowing)
- **Phase 2**: Smart scheduling (efficiency, ~50% request reduction)
- **Phase 3**: Parser resilience (drift visibility, CLI)
- **Phase 4**: HTTP + WebSocket API (ops surfaces)
- **Phase 5**: UI (admin + dispatcher visibility)

**No new dependencies. No rewrites. Preserves the 1.4% error rate.**
