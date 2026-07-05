# Warrant Scraper Health Grades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-null `health_grade` (which the client defaults to a misleading permanent `'F'`) with a real A–F grade computed from actual run history, and make that history exist by wiring the already-built-but-never-called `runAllSourceScans()` into the existing 4-hour cron.

**Architecture:** New `scraper_runs` audit table logs one row per source per scan attempt (cron or manual trigger). A new pure `computeHealthGrade()` function turns recent rows into a letter grade or `null` ("no data yet"). `GET /`/`GET /health` in `src/routes/scrapers.ts` read from this table instead of returning zeroed placeholders. The client stops defaulting `null` to `'F'` and shows "N/A" instead.

**Tech Stack:** Hono, Cloudflare D1, Vitest (Node suite for the pure grading function, Miniflare for route tests), React/TypeScript for the client fix.

---

### Task 1: Migration — `scraper_runs` table

**Files:**
- Create: `migrations/0174_scraper_runs.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0174: scraper_runs — per-source, per-attempt run history for the warrant
-- scraper ops surface. Backs real health_grade computation in
-- src/routes/scrapers.ts, replacing the always-null placeholder shipped in
-- PR #2593. One row per source per scan attempt (cron sweep or manual
-- admin trigger), distinguished by `trigger`.
CREATE TABLE IF NOT EXISTS scraper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  cleared INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trigger TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_source_key ON scraper_runs(source_key, started_at);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npx wrangler d1 execute rmpg-flex --local --file=migrations/0174_scraper_runs.sql`
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='scraper_runs'"`
Expected: prints the CREATE TABLE statement above.

- [ ] **Step 3: Commit**

```bash
git add migrations/0174_scraper_runs.sql
git commit -m "feat(scrapers): add scraper_runs run-history table migration"
```

---

### Task 2: `computeHealthGrade` pure function (TDD)

**Files:**
- Create: `src/utils/warrantSources/healthGrade.ts`
- Create: `tests/warrantSources/healthGrade.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from 'vitest';
import { computeHealthGrade } from '../../src/utils/warrantSources/healthGrade';

describe('computeHealthGrade', () => {
  it('returns null when there is no run history', () => {
    expect(computeHealthGrade([])).toBeNull();
  });

  it('returns A for a 100% success rate', () => {
    const runs = Array(20).fill({ success: true });
    expect(computeHealthGrade(runs)).toBe('A');
  });

  it('returns A at exactly the 95% boundary (19/20)', () => {
    const runs = [...Array(19).fill({ success: true }), { success: false }];
    expect(computeHealthGrade(runs)).toBe('A');
  });

  it('returns B just below the A boundary (18/20 = 90%)', () => {
    const runs = [...Array(18).fill({ success: true }), ...Array(2).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('B');
  });

  it('returns B at exactly the 85% boundary (17/20)', () => {
    const runs = [...Array(17).fill({ success: true }), ...Array(3).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('B');
  });

  it('returns C just below the B boundary (16/20 = 80%)', () => {
    const runs = [...Array(16).fill({ success: true }), ...Array(4).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('C');
  });

  it('returns C at exactly the 70% boundary (14/20)', () => {
    const runs = [...Array(14).fill({ success: true }), ...Array(6).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('C');
  });

  it('returns D just below the C boundary (13/20 = 65%)', () => {
    const runs = [...Array(13).fill({ success: true }), ...Array(7).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('D');
  });

  it('returns D at exactly the 50% boundary (10/20)', () => {
    const runs = [...Array(10).fill({ success: true }), ...Array(10).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('D');
  });

  it('returns F below the 50% boundary (9/20 = 45%)', () => {
    const runs = [...Array(9).fill({ success: true }), ...Array(11).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('returns F for a 0% success rate', () => {
    const runs = Array(5).fill({ success: false });
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('only considers the most recent 20 runs when more are provided', () => {
    // 25 failures followed by 20 successes — if the function only looks at
    // the last 20 (the 20 successes), this is an A; if it wrongly averaged
    // all 45, it would be an F. Caller is responsible for passing rows in
    // newest-first or oldest-first order consistently — this test documents
    // that the function takes the FIRST 20 entries of the array it's given,
    // so callers must slice/order before calling.
    const runs = [...Array(20).fill({ success: true }), ...Array(25).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantSources/healthGrade.test.ts`
Expected: FAIL — cannot find module `../../src/utils/warrantSources/healthGrade`

- [ ] **Step 3: Write `src/utils/warrantSources/healthGrade.ts`**

```ts
// Pure function: turns a slice of scraper_runs rows into an A-F health
// grade, or null if there's no run history yet. Deliberately takes the
// FIRST `MAX_RUNS_CONSIDERED` entries of whatever array it's given — the
// caller (src/routes/scrapers.ts) is responsible for querying/ordering
// scraper_runs so the most recent runs are first before calling this.
//
// Thresholds are a judgment call, not derived from any external standard:
// >=95% A, >=85% B, >=70% C, >=50% D, else F. A 20-run window is roughly
// 3+ days of 4-hourly cron runs — small enough to react to recent behavior,
// large enough that one bad run doesn't swing a grade from A to F.

const MAX_RUNS_CONSIDERED = 20;

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function computeHealthGrade(runs: Array<{ success: boolean }>): HealthGrade | null {
  if (runs.length === 0) return null;

  const considered = runs.slice(0, MAX_RUNS_CONSIDERED);
  const successCount = considered.filter((r) => r.success).length;
  const rate = successCount / considered.length;

  if (rate >= 0.95) return 'A';
  if (rate >= 0.85) return 'B';
  if (rate >= 0.70) return 'C';
  if (rate >= 0.50) return 'D';
  return 'F';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantSources/healthGrade.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/warrantSources/healthGrade.ts tests/warrantSources/healthGrade.test.ts
git commit -m "feat(scrapers): add computeHealthGrade pure function"
```

---

### Task 3: Cron — wire `runAllSourceScans` + log to `scraper_runs`

**Files:**
- Create: `src/utils/warrantSources/logScanResult.ts`
- Create: `tests/warrantSources/logScanResult.test.ts`
- Modify: `src/index.ts`

This is split into a small testable logging function (Step 1-6) plus the
`index.ts` wiring (Step 7-10), matching this repo's pattern of keeping
`index.ts`'s `scheduled` branches as thin dispatchers rather than inlining
logic there.

- [ ] **Step 1: Write the failing test file `tests/warrantSources/logScanResult.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { logScanResult } from '../../src/utils/warrantSources/logScanResult';

describe('logScanResult', () => {
  it('inserts one scraper_runs row for the Utah leg and one per scraped source', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 5, new_warrants_found: 1, warrants_cleared: 0, errors: 0 },
      scraped: [
        { source_key: 'ada-county-id', checked: 10, found: 2, cleared: 1, errors: 0 },
        { source_key: 'natrona-county-wy', checked: 3, found: 0, cleared: 0, errors: 1 },
      ],
    }, 'cron');

    expect(calls).toHaveLength(3);
    // Utah row: success = errors===0 -> true (1)
    expect(calls[0].args).toContain('utah-warrant-watch');
    expect(calls[0].args).toContain(1); // success
    // ada-county-id: errors=0 -> success
    expect(calls[1].args).toContain('ada-county-id');
    expect(calls[1].args).toContain(1);
    // natrona-county-wy: errors=1 -> failure
    expect(calls[2].args).toContain('natrona-county-wy');
    expect(calls[2].args).toContain(0);
  });

  it('tags every row with the given trigger value', async () => {
    const { db, calls } = recordingDb();

    await logScanResult(db, {
      utah: { run_id: 'r1', status: 'completed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
      scraped: [],
    }, 'manual');

    expect(calls[0].args).toContain('manual');
  });
});
```

`recordingDb()` (from `tests/helpers/fakeD1.ts`, already used by
`tests/sorEnrichment/runner.test.ts`) returns `{ db, calls }` where `calls`
is an array of `{ sql, args }` populated on every `.run()` call — this is
the real, existing mechanism, reused as-is rather than inventing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantSources/logScanResult.test.ts`
Expected: FAIL — cannot find module `../../src/utils/warrantSources/logScanResult`

- [ ] **Step 3: Write `src/utils/warrantSources/logScanResult.ts`**

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { execute } from '../db';
import type { AllSourceScanResult } from './runScan';

/**
 * Writes one scraper_runs row for the Utah leg plus one per scraped source,
 * from the result of runAllSourceScans(). Used by both the cron sweep and,
 * indirectly, the same shape from a single-source manual trigger (see
 * src/routes/scrapers.ts's POST /:key/trigger, which constructs an
 * equivalent single-entry shape rather than calling runAllSourceScans).
 */
export async function logScanResult(
  db: D1Database,
  result: AllSourceScanResult,
  trigger: 'cron' | 'manual',
): Promise<void> {
  const now = new Date().toISOString();

  await execute(
    db,
    `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'utah-warrant-watch', now, now, result.utah.errors === 0 ? 1 : 0,
    result.utah.persons_checked, result.utah.new_warrants_found, result.utah.warrants_cleared,
    result.utah.errors, trigger,
  );

  for (const s of result.scraped) {
    await execute(
      db,
      `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.source_key, now, now, s.errors === 0 ? 1 : 0,
      s.checked, s.found, s.cleared, s.errors, trigger,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantSources/logScanResult.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/warrantSources/logScanResult.ts tests/warrantSources/logScanResult.test.ts
git commit -m "feat(scrapers): add logScanResult helper for scraper_runs"
```

- [ ] **Step 7: Wire into the 4-hour cron in `src/index.ts`**

Find this exact block (search for `event.cron === '0 */4 * * *'`):

```ts
    if (event.cron === '0 */4 * * *') {
      ctx.waitUntil(
        runUtahWarrantScan(env.DB).catch((err) => {
          console.error('Utah warrant scheduled scan failed:', err);
        }),
      );
```

Replace the `runUtahWarrantScan(env.DB)...` block with a call to
`runAllSourceScans` (which already runs the Utah leg internally, unchanged,
alongside the scraped sources) plus the new logging call:

```ts
    if (event.cron === '0 */4 * * *') {
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

Remove the now-unused `import { runUtahWarrantScan } from './utils/utahWarrantPoller';`
at the top of `src/index.ts` ONLY IF nothing else in the file still uses
`runUtahWarrantScan` directly — check with
`grep -n "runUtahWarrantScan" src/index.ts` first; if it only appears in the
import line and the block you just replaced, remove the import too. If
anything else in the file calls it directly, leave the import in place.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Run the full worker test suite** (no new Miniflare test for the
  cron branch itself — this repo's existing pattern doesn't unit-test
  `scheduled()` branches directly, only the extracted helper functions,
  which Task 3 Steps 1-6 already covered):

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add src/index.ts
git commit -m "feat(scrapers): wire runAllSourceScans + scraper_runs logging into the 4h cron"
```

---

### Task 4: Manual trigger — log to `scraper_runs`

**Files:**
- Modify: `src/routes/scrapers.ts`
- Modify: `test-workers/scrapers.test.ts`

- [ ] **Step 1: Add the failing test** (append as a new top-level `describe` in the existing scrapers test file):

```ts
describe('POST /api/warrants/scrapers/:key/trigger logs to scraper_runs', () => {
  it('writes a scraper_runs row on a successful code-adapter trigger', async () => {
    const app = buildApp('admin');
    await app.request('/api/warrants/scrapers/ada-county-id/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);

    const db = (env as unknown as { DB: D1Database }).DB;
    const rows = await query<{ source_key: string; trigger: string }>(
      db, `SELECT source_key, trigger FROM scraper_runs WHERE source_key = 'ada-county-id'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[rows.length - 1].trigger).toBe('manual');
  });
});
```

This test needs `scraper_runs` created in the file's shared `beforeAll` —
add this alongside the other `CREATE TABLE IF NOT EXISTS` statements already
there:

```ts
  await execute(db, `CREATE TABLE IF NOT EXISTS scraper_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL, success INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0, cleared INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER, trigger TEXT NOT NULL
  )`);
```

Also add `query` to this test file's existing `execute` import from
`'../src/utils/db'` if it isn't already imported (check the file first).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — no row found (trigger route doesn't log yet)

- [ ] **Step 3: Implement the logging in `POST /:key/trigger`**

Add this import at the top of `src/routes/scrapers.ts`, alongside the
existing imports:

```ts
import { logScanResult } from '../utils/warrantSources/logScanResult';
```

Modify each of the three success branches in `POST /:key/trigger` to log a
`scraper_runs` row via `logScanResult`, constructing a single-entry
`AllSourceScanResult`-shaped object. For the Utah branch:

```ts
  if (key === 'utah-warrant-watch') {
    try {
      const result = await runUtahWarrantScan(db);
      await logScanResult(db, { utah: result, scraped: [] }, 'manual');
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }
```

For the code-resident adapter branch:

```ts
  if (codeMatch) {
    try {
      const summaries = await runFullListLeg(db, [codeMatch]);
      const summary = summaries[0] ?? { source_key: key, checked: 0, found: 0, cleared: 0, errors: 0 };
      await logScanResult(db, {
        utah: { run_id: 'n/a', status: 'completed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 0 },
        scraped: [summary],
      }, 'manual');
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }
```

Note: this logs a dummy all-success Utah row alongside the real single
scraped-source row, which is wasteful (it writes an extra row that doesn't
represent anything real). Instead, extract the single-source insert logic
directly rather than routing through `logScanResult`'s dual-purpose shape.
Replace the above with a direct insert instead:

```ts
  if (codeMatch) {
    try {
      const summaries = await runFullListLeg(db, [codeMatch]);
      const summary = summaries[0] ?? { source_key: key, checked: 0, found: 0, cleared: 0, errors: 0 };
      const now = new Date().toISOString();
      await execute(
        db,
        `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
        summary.source_key, now, now, summary.errors === 0 ? 1 : 0,
        summary.checked, summary.found, summary.cleared, summary.errors,
      );
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }
```

Apply the exact same direct-insert pattern to the config-driven adapter
branch (`configMatch`) right below it, and to the Utah branch — for Utah,
insert directly with `source_key: 'utah-warrant-watch'` and the fields from
`result` (`result.errors === 0 ? 1 : 0`, `result.persons_checked`,
`result.new_warrants_found`, `result.warrants_cleared`, `result.errors`),
skipping `logScanResult` entirely in this route (it's only used by the cron
path, which genuinely has both an Utah result AND a scraped-source array to
log together). Remove the `logScanResult` import you added in this step if
it ends up unused after this correction — check with
`grep -n logScanResult src/routes/scrapers.ts` before finishing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS (full file green, including the new describe block)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(scrapers): log manual triggers to scraper_runs"
```

---

### Task 5: `GET /` and `GET /health` — real grades from `scraper_runs`

**Files:**
- Modify: `src/routes/scrapers.ts`
- Modify: `test-workers/scrapers.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('GET /api/warrants/scrapers computes real health_grade from scraper_runs', () => {
  it('returns a real letter grade for a source with run history, and null for one with none', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // ada-county-id: 20 successful runs -> A
    for (let i = 0; i < 20; i++) {
      await execute(db, `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, trigger)
        VALUES ('ada-county-id', datetime('now'), datetime('now'), 1, 'cron')`);
    }

    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { sources: Array<{ source_key: string; metrics_24h: { health_grade: string | null; total_runs: number; success_rate: number } }> };

    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.metrics_24h.health_grade).toBe('A');
    expect(ada?.metrics_24h.total_runs).toBe(20);
    expect(ada?.metrics_24h.success_rate).toBe(1);

    // natrona-county-wy has zero scraper_runs rows in this test's fixture data.
    const wy = body.sources.find((s) => s.source_key === 'natrona-county-wy');
    expect(wy?.metrics_24h.health_grade).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — `health_grade` is still always `null` for every source, but the test expects `'A'` for `ada-county-id`

- [ ] **Step 3: Implement the change**

Add this import at the top of `src/routes/scrapers.ts`:

```ts
import { computeHealthGrade } from '../utils/warrantSources/healthGrade';
```

Modify `getMergedSources` to query `scraper_runs` once (all sources, ordered
newest-first) and group in JS, then use that to build real `metrics_24h`
instead of calling `zeroedMetrics`. Replace the `zeroedMetrics` function and
its two call sites:

```ts
async function getMergedSources(db: D1Database): Promise<MergedSource[]> {
  const configRows = await query<{
    source_name: string; last_error: string | null; source_type: string | null; priority: number | null;
    last_run_at: string | null; last_success_at: string | null; avg_parse_count: number | null;
    p95_latency_ms: number | null; enabled: number; consecutive_errors: number;
  }>(db, `SELECT source_name, last_error, source_type, priority, last_run_at, last_success_at,
    avg_parse_count, p95_latency_ms, enabled, consecutive_errors FROM warrant_scraper_config`);

  const nationalRows = await query<{
    source_key: string; display_name: string; state: string | null; jurisdiction: string | null;
    format: string; enabled: number; priority: number; consecutive_errors: number;
  }>(db, `SELECT source_key, display_name, state, jurisdiction, format, enabled, priority, consecutive_errors
    FROM national_warrant_sources`);

  const countRows = await query<{ source_key: string; n: number }>(
    db, `SELECT source_key, COUNT(*) as n FROM scraped_warrants WHERE status = 'active' GROUP BY source_key`,
  );
  const countsByKey = new Map(countRows.map((r) => [r.source_key, r.n]));

  // All run-history rows, newest first, grouped by source in JS — a single
  // query rather than one-per-source (same N+1-avoidance reasoning as the
  // warrant_count batching above).
  const runRows = await query<{ source_key: string; success: number; started_at: string }>(
    db, `SELECT source_key, success, started_at FROM scraper_runs ORDER BY started_at DESC`,
  );
  const runsByKey = new Map<string, Array<{ success: boolean }>>();
  for (const row of runRows) {
    const list = runsByKey.get(row.source_key) ?? [];
    list.push({ success: row.success === 1 });
    runsByKey.set(row.source_key, list);
  }

  function buildMetrics(sourceKey: string, lastError: string | null, lastSuccessAt: string | null): MergedSource['metrics_24h'] {
    const runs = runsByKey.get(sourceKey) ?? [];
    const total_runs = runs.length;
    const successful_runs = runs.filter((r) => r.success).length;
    const failed_runs = total_runs - successful_runs;
    return {
      source_key: sourceKey, window_hours: 24, total_runs, successful_runs, unchanged_runs: 0,
      failed_runs, success_rate: total_runs > 0 ? successful_runs / total_runs : 0,
      avg_duration_ms: 0, p50_duration_ms: 0, p95_duration_ms: 0,
      avg_parsed: 0, total_inserted: 0, total_updated: 0, last_error: lastError,
      last_error_at: null, last_success_at: lastSuccessAt, status_distribution: {},
      health_grade: computeHealthGrade(runs),
    };
  }

  const out: MergedSource[] = [];

  for (const row of configRows) {
    const key = row.source_name;
    out.push({
      source_key: key,
      display_name: key,
      state: '', county: null, source_url: '',
      source_type: row.source_type ?? 'unknown',
      enabled: (row.enabled ?? 1) ? 1 : 0,
      circuit_broken: circuitOpenFromConsecutiveErrors(row.consecutive_errors) ? 1 : 0,
      priority: row.priority ?? 3,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countsByKey.get(key) ?? 0,
      last_scrape_at: row.last_run_at,
      last_success_at: row.last_success_at,
      last_error: row.last_error,
      avg_parse_count: row.avg_parse_count,
      p95_latency_ms: row.p95_latency_ms,
      metrics_24h: buildMetrics(key, row.last_error, row.last_success_at),
    });
  }

  for (const row of nationalRows) {
    out.push({
      source_key: row.source_key,
      display_name: row.display_name,
      state: row.state ?? '',
      county: row.jurisdiction,
      source_url: '',
      source_type: row.format,
      enabled: row.enabled ? 1 : 0,
      circuit_broken: circuitOpenFromConsecutiveErrors(row.consecutive_errors) ? 1 : 0,
      priority: row.priority,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countsByKey.get(row.source_key) ?? 0,
      last_scrape_at: null,
      last_success_at: null,
      last_error: null,
      avg_parse_count: null,
      p95_latency_ms: null,
      metrics_24h: buildMetrics(row.source_key, null, null),
    });
  }

  return out;
}
```

Also update the `MergedSource['metrics_24h']` interface's `health_grade`
field type from `health_grade: null` to `health_grade: 'A' | 'B' | 'C' | 'D' | 'F' | null`
(find the `interface MergedSource` block and change just that one field).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS (full file green)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(scrapers): compute real health_grade/metrics_24h from scraper_runs"
```

---

### Task 6: Client fix — show "N/A" instead of defaulting to "F"

**Files:**
- Modify: `client/src/types/scrapers.ts`
- Modify: `client/src/pages/warrants/ScrapersTab.tsx`
- Modify: `client/src/pages/admin/AdminWarrantScrapersTab.tsx`

- [ ] **Step 1: Widen the type in `client/src/types/scrapers.ts`**

Find `health_grade: ScraperHealthGrade;` inside the `SourceMetrics` (or
equivalent `metrics_24h`) interface and change it to:

```ts
  health_grade: ScraperHealthGrade | null;
```

- [ ] **Step 2: Fix `client/src/pages/warrants/ScrapersTab.tsx`**

Change the grade-distribution summary (around line 219) from:

```ts
    const g = s.metrics_24h?.health_grade || 'F';
    counts[g]++;
```

to:

```ts
    const g = s.metrics_24h?.health_grade;
    if (g) counts[g]++;
    else naCount++;
```

Update the `counts` initialization a few lines above (currently
`{ A: 0, B: 0, C: 0, D: 0, F: 0 }`) to declare a separate `let naCount = 0;`
alongside it, and render an "N/A" bucket in this component's output wherever
it maps over `grades: ScraperHealthGrade[] = ['A', 'B', 'C', 'D', 'F']` to
render each grade's count — add the N/A count as an additional item in that
render, not inside the `Record<ScraperHealthGrade, number>` (which has no
room for a non-`ScraperHealthGrade` key).

Change the per-source badge (around line 294) from:

```ts
  const grade = source.metrics_24h?.health_grade || 'F';
```

to:

```ts
  const grade = source.metrics_24h?.health_grade ?? null;
```

Find wherever `grade` is used to pick badge color/styling below this line
(e.g. a `GRADE_COLORS` map or conditional) and add a branch for `grade === null`
rendering "N/A" with a neutral gray style, distinct from the F badge's
presumably red/failing style — read the surrounding render code to match
its existing conditional style so the fix is consistent with the file's
own patterns rather than introducing a new one.

Update the `GradeFilter` type (currently `type GradeFilter = 'all' | ScraperHealthGrade;`)
to `type GradeFilter = 'all' | ScraperHealthGrade | 'na';` and add an option
to the grade filter `<select>` (alongside the existing A/B/C/D/F `<option>`
elements around line 558-563):

```tsx
          <option value="na">N/A</option>
```

Update the filter predicate (currently around line 499):

```ts
      if (gradeFilter !== 'all' && s.metrics_24h?.health_grade !== gradeFilter) return false;
```

to handle the `'na'` case (since `health_grade` is `null`, not the string
`'na'`):

```ts
      if (gradeFilter === 'na' && s.metrics_24h?.health_grade != null) return false;
      if (gradeFilter !== 'all' && gradeFilter !== 'na' && s.metrics_24h?.health_grade !== gradeFilter) return false;
```

- [ ] **Step 3: Fix `client/src/pages/admin/AdminWarrantScrapersTab.tsx`**

Change (around line 279):

```ts
                const grade = s.metrics_24h?.health_grade || 'F';
```

to:

```ts
                const grade = s.metrics_24h?.health_grade ?? null;
```

Find wherever `grade` renders below this line and add a branch for `null`
showing "N/A" — same approach as Step 2, match the file's existing
conditional-rendering style for the other grade values.

- [ ] **Step 4: Run the client test suite**

Run: `cd client && npx vitest run`
Expected: all pass (no new tests required for this UI-only fallback-display
change per YAGNI, but confirm nothing existing broke — if either file has
an existing snapshot/unit test asserting the old `'F'`-default behavior,
update that test's expectation to match the new `null`/"N/A" behavior
rather than leaving a stale assertion)

- [ ] **Step 5: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add client/src/types/scrapers.ts client/src/pages/warrants/ScrapersTab.tsx client/src/pages/admin/AdminWarrantScrapersTab.tsx
git commit -m "fix(scrapers): show N/A instead of defaulting missing health_grade to F"
```

---

### Task 7: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (or only pre-existing errors unrelated to this change —
confirm by checking `git stash` + re-running if any appear, per this
repo's established verification pattern from prior PRs in this session)

- [ ] **Step 3: Full node test suite**

Run: `npx vitest run`
Expected: all pass, including `tests/warrantSources/healthGrade.test.ts` and
`tests/warrantSources/logScanResult.test.ts`

- [ ] **Step 4: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including the updated `test-workers/scrapers.test.ts`

- [ ] **Step 5: Client test suite**

Run: `cd client && npx vitest run`
Expected: all pass

- [ ] **Step 6: Manual UI smoke check**

Run `npm run dev` (Worker) and `cd client && npm run dev` (Vite). Open the
Warrants page's Scrapers tab: confirm sources with no run history show
"N/A" (not "F"), trigger one source manually, confirm it gets a real grade
after the trigger completes and the list refreshes.

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin feat/scraper-health-grades
gh pr create --title "feat(scrapers): compute real health grades from run history, fix null-defaults-to-F" --body "$(cat <<'EOF'
## Summary
- health_grade previously always shipped as null (deferred in PR #2593),
  and the client defaulted null to 'F' in three places — every scraper
  source, healthy or not, ever-run or never-run, showed the worst grade
- New scraper_runs table logs one row per source per scan attempt (cron
  or manual trigger)
- Wired the already-built-but-never-called runAllSourceScans() into the
  existing 4h cron (previously only Utah ran automatically — Ada County,
  Natrona, and the config-driven Socrata/ArcGIS sources only ran on manual
  admin trigger, so grades would never have populated without this)
- New computeHealthGrade() pure function: success rate over the last 20
  runs, >=95% A / >=85% B / >=70% C / >=50% D / else F; zero runs -> null
- GET /scrapers and GET /scrapers/health now compute real metrics_24h from
  scraper_runs instead of a zeroed placeholder
- Client shows "N/A" (distinct styling from F) when there's no run history
  yet, instead of falsely claiming the worst grade

## Test plan
- [x] npx vitest run tests/warrantSources/healthGrade.test.ts — 12/12 (grade boundary cases)
- [x] npx vitest run tests/warrantSources/logScanResult.test.ts
- [x] npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts
- [x] npm run typecheck / cd client && npx tsc --noEmit — clean
- [x] Full node + worker + client suites green
- [x] Manual UI smoke check in a browser

## Post-merge
Apply the migration to live D1 per CLAUDE.md convention:
```
scripts/apply-migration.sh 0174_scraper_runs.sql
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
