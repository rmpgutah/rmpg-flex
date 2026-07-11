# Warrant Scraper Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back both `ScrapersTab.tsx` and `AdminWarrantScrapersTab.tsx` — currently calling `/api/warrants/scrapers*` endpoints that don't exist anywhere — with a real list/health/trigger/reset-circuit/bulk surface, covering both warrant-source frameworks (`warrant_scraper_config` for the code-resident adapters, `national_warrant_sources` for the federated config-driven pull).

**Architecture:** New standalone router `src/routes/scrapers.ts`, mounted at `/api/warrants/scrapers` in `src/routesConfig.ts` (registered *before* the existing `/api/warrants` mount, since Hono's more-specific-prefix-first ordering convention applies — `/api/warrants/scrapers` must not be shadowed by `/api/warrants`'s own catch-alls). One migration adds `consecutive_errors` to both source tables. `circuit_broken` is derived per-request via the existing pure `isCircuitOpen()` helper — no stored flag. The on-demand trigger reuses existing scan machinery (`runUtahWarrantScan`, `getEnabledAdapters`/`getConfigAdapters` + `runFullListLeg`) rather than duplicating fetch logic. No run-history table, no percentile metrics, no health grades this round (documented as deferred in the spec) — `metrics_24h` ships as a zeroed placeholder block.

**Tech Stack:** Hono, Cloudflare D1, existing `src/utils/warrantSources/*` scan orchestrator, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare).

---

### Task 1: Migration — `consecutive_errors` on both source tables

**Files:**
- Create: `migrations/0172_scraper_consecutive_errors.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0172: consecutive_errors on both warrant-source config tables — drives
-- the circuit_broken flag (via the existing isCircuitOpen() pure function
-- in src/utils/warrantSources/resilience.ts, threshold 5) for the
-- /api/warrants/scrapers ops surface (ScrapersTab.tsx +
-- AdminWarrantScrapersTab.tsx, both previously unbacked — 2026-07-04).
--
-- D1 lacks ALTER TABLE ADD COLUMN IF NOT EXISTS; re-applying this on a DB
-- that already has the column fails with "duplicate column name" — expected,
-- see migrations/README.md.
ALTER TABLE warrant_scraper_config ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE national_warrant_sources ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration applied, no errors.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT consecutive_errors FROM warrant_scraper_config LIMIT 1"`
Expected: succeeds (column exists; empty result set is fine if the table has no rows locally).

- [ ] **Step 3: Commit**

```bash
git add migrations/0172_scraper_consecutive_errors.sql
git commit -m "feat(warrants): add consecutive_errors column migration"
```

---

### Task 2: `GET /` — merged source list

**Files:**
- Create: `src/routes/scrapers.ts`
- Create: `test-workers/scrapers.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for /api/warrants/scrapers —
// backing both ScrapersTab.tsx and AdminWarrantScrapersTab.tsx, neither of
// which had any matching backend route before this PR (2026-07-04).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import scrapers from '../src/routes/scrapers';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants/scrapers', scrapers);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrant_scraper_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT, last_run_at TEXT, last_error TEXT,
    source_type TEXT, priority INTEGER, last_success_at TEXT, avg_parse_count REAL,
    p95_latency_ms INTEGER, enabled INTEGER NOT NULL DEFAULT 1, consecutive_errors INTEGER NOT NULL DEFAULT 0
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS national_warrant_sources (
    source_key TEXT PRIMARY KEY, family TEXT NOT NULL, display_name TEXT NOT NULL, state TEXT,
    jurisdiction TEXT, mode TEXT NOT NULL DEFAULT 'full-list', format TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 3,
    consecutive_errors INTEGER NOT NULL DEFAULT 0
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, status TEXT
  )`);

  await execute(db, `INSERT INTO warrant_scraper_config
    (source_name, last_error, source_type, priority, last_success_at, enabled, consecutive_errors)
    VALUES ('utah-api', NULL, 'api', 1, '2026-07-03 12:00:00', 1, 0)`);
  await execute(db, `INSERT INTO warrant_scraper_config
    (source_name, last_error, source_type, priority, last_success_at, enabled, consecutive_errors)
    VALUES ('ada-county-id', 'timeout', 'html', 2, '2026-06-01 00:00:00', 1, 6)`);

  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority, consecutive_errors)
    VALUES ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington', 'arcgis', 1, 2, 0)`);

  await execute(db, `INSERT INTO scraped_warrants (source_key, status) VALUES ('arcgis-arlington-tx', 'active')`);
  await execute(db, `INSERT INTO scraped_warrants (source_key, status) VALUES ('arcgis-arlington-tx', 'active')`);
});

describe('GET /api/warrants/scrapers', () => {
  it('returns sources from both frameworks with circuit_broken derived from consecutive_errors', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { sources: Array<{ source_key: string; circuit_broken: 0 | 1; warrant_count: number; enabled: 0 | 1 }> };
    expect(body.sources).toHaveLength(3);

    const utah = body.sources.find((s) => s.source_key === 'utah-api');
    expect(utah?.circuit_broken).toBe(0);

    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.circuit_broken).toBe(1); // 6 consecutive errors >= threshold 5

    const arcgis = body.sources.find((s) => s.source_key === 'arcgis-arlington-tx');
    expect(arcgis?.warrant_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — cannot find module `../src/routes/scrapers` (file doesn't exist yet)

- [ ] **Step 3: Create the route file**

```ts
// ============================================================
// RMPG Flex — Warrant Scraper Ops (Cloudflare Worker)
// ============================================================
// Backs BOTH client tabs that manage warrant-source scrapers:
//   - client/src/pages/warrants/ScrapersTab.tsx (list/health/trigger/
//     reset-circuit)
//   - client/src/pages/admin/AdminWarrantScrapersTab.tsx (bulk enable/
//     disable)
// Neither had a matching backend route before this PR — a broken-
// functionality audit (2026-07-04) found the entire /api/warrants/
// scrapers* surface unbuilt on the Worker.
//
// Two warrant-source frameworks coexist and both show up in one merged
// list here:
//   - warrant_scraper_config (code-resident ADAPTERS in
//     src/utils/warrantSources/registry.ts — Utah + a few counties)
//   - national_warrant_sources (the federated Socrata/ArcGIS/PDF pull,
//     PR #1221+)
//
// No run-history table this round (see design doc) — metrics_24h ships
// zeroed/null. circuit_broken is derived per-request from
// consecutive_errors via the existing isCircuitOpen() pure function —
// no separate stored flag to drift out of sync.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute } from '../utils/db';
import { isCircuitOpen } from '../utils/warrantSources/resilience';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';
import { getEnabledAdapters } from '../utils/warrantSources/registry';
import { getConfigAdapters } from '../utils/warrantSources/configRegistry';
import { runFullListLeg } from '../utils/warrantSources/runScan';

const scrapers = new Hono<Env>();

interface MergedSource {
  source_key: string;
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  source_type: string;
  enabled: 0 | 1;
  circuit_broken: 0 | 1;
  priority: number;
  consecutive_errors: number;
  warrant_count: number;
  last_scrape_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  avg_parse_count: number | null;
  p95_latency_ms: number | null;
  metrics_24h: {
    source_key: string; window_hours: number; total_runs: number; successful_runs: number;
    unchanged_runs: number; failed_runs: number; success_rate: number; avg_duration_ms: number;
    p50_duration_ms: number; p95_duration_ms: number; avg_parsed: number; total_inserted: number;
    total_updated: number; last_error: string | null; last_error_at: string | null;
    last_success_at: string | null; status_distribution: Record<string, number>; health_grade: null;
  };
}

function zeroedMetrics(sourceKey: string, lastError: string | null, lastSuccessAt: string | null): MergedSource['metrics_24h'] {
  return {
    source_key: sourceKey, window_hours: 24, total_runs: 0, successful_runs: 0, unchanged_runs: 0,
    failed_runs: 0, success_rate: 0, avg_duration_ms: 0, p50_duration_ms: 0, p95_duration_ms: 0,
    avg_parsed: 0, total_inserted: 0, total_updated: 0, last_error: lastError,
    last_error_at: null, last_success_at: lastSuccessAt, status_distribution: {}, health_grade: null,
  };
}

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

  const out: MergedSource[] = [];

  for (const row of configRows) {
    const key = row.source_name;
    const countRow = await query<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM scraped_warrants WHERE source_key = ? AND status = 'active'`, key,
    );
    out.push({
      source_key: key,
      display_name: key,
      state: '', county: null, source_url: '',
      source_type: row.source_type ?? 'unknown',
      enabled: (row.enabled ?? 1) ? 1 : 0,
      circuit_broken: isCircuitOpen([row.consecutive_errors]) ? 1 : 0,
      priority: row.priority ?? 3,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countRow[0]?.n ?? 0,
      last_scrape_at: row.last_run_at,
      last_success_at: row.last_success_at,
      last_error: row.last_error,
      avg_parse_count: row.avg_parse_count,
      p95_latency_ms: row.p95_latency_ms,
      metrics_24h: zeroedMetrics(key, row.last_error, row.last_success_at),
    });
  }

  for (const row of nationalRows) {
    const countRow = await query<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM scraped_warrants WHERE source_key = ? AND status = 'active'`, row.source_key,
    );
    out.push({
      source_key: row.source_key,
      display_name: row.display_name,
      state: row.state ?? '',
      county: row.jurisdiction,
      source_url: '',
      source_type: row.format,
      enabled: row.enabled ? 1 : 0,
      circuit_broken: isCircuitOpen([row.consecutive_errors]) ? 1 : 0,
      priority: row.priority,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countRow[0]?.n ?? 0,
      last_scrape_at: null,
      last_success_at: null,
      last_error: null,
      avg_parse_count: null,
      p95_latency_ms: null,
      metrics_24h: zeroedMetrics(row.source_key, null, null),
    });
  }

  return out;
}

scrapers.get('/', async (c) => {
  const db = getDb(c.env);
  const sources = await getMergedSources(db);
  return c.json({ sources });
});

export default scrapers;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(warrants): add GET /scrapers merged source list route"
```

---

### Task 3: `GET /health` — rollup summary

**Files:**
- Modify: `test-workers/scrapers.test.ts`
- Modify: `src/routes/scrapers.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('GET /api/warrants/scrapers/health', () => {
  it('returns rollup counts derived from the merged source list', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/health', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; circuit_broken: number; healthy: number };
    expect(body.total).toBe(3);
    expect(body.circuit_broken).toBe(1); // ada-county-id
    expect(body.healthy).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — 404 for `GET /health`

- [ ] **Step 3: Implement the route** (insert in `src/routes/scrapers.ts` — **before** `export default scrapers;`, and note this must be registered before the `/:key/...` param routes added in later tasks so `/health` isn't swallowed as a `:key` value)

```ts
scrapers.get('/health', async (c) => {
  const db = getDb(c.env);
  const sources = await getMergedSources(db);
  const circuit_broken = sources.filter((s) => s.circuit_broken === 1).length;
  const failed = sources.filter((s) => s.last_error && s.circuit_broken === 0).length;
  const healthy = sources.length - circuit_broken - failed;
  return c.json({
    healthy,
    degraded: failed,
    failed: 0,
    circuit_broken,
    total: sources.length,
    last_hour_runs: 0,
    last_hour_inserted: 0,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(warrants): add GET /scrapers/health rollup route"
```

---

### Task 4: `POST /:key/trigger` — on-demand single-source run

**Files:**
- Modify: `test-workers/scrapers.test.ts`
- Modify: `src/routes/scrapers.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('POST /api/warrants/scrapers/:key/trigger', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/arcgis-arlington-tx/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown source key', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/not-a-real-source/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });

  it('triggers the Utah source via runUtahWarrantScan', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/utah-api/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    // The real Utah poller makes a live network call, which is unavailable in
    // Miniflare tests — accept either a successful run summary or a caught
    // network-error response, but never a 404/403 (the key must resolve).
    expect([200, 502]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — 404 for `POST /:key/trigger` (route not yet registered) for ALL three test cases, including the role-check one (Hono 404s before any handler runs)

- [ ] **Step 3: Implement the route** (insert in `src/routes/scrapers.ts`, after `GET /health`, before `export default scrapers;`)

```ts
scrapers.post('/:key/trigger', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const db = getDb(c.env);
  const key = c.req.param('key');

  if (key === 'utah-api') {
    try {
      const result = await runUtahWarrantScan(db);
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  const codeAdapters = await getEnabledAdapters(db);
  const codeMatch = codeAdapters.find((a) => a.meta.key === key);
  if (codeMatch) {
    try {
      const summaries = await runFullListLeg(db, [codeMatch]);
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  const configAdapters = await getConfigAdapters(db);
  const configMatch = configAdapters.find((a) => a.meta.key === key);
  if (configMatch) {
    try {
      const summaries = await runFullListLeg(db, [configMatch]);
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  return c.json({ error: `Unknown source key: ${key}` }, 404);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(warrants): add POST /scrapers/:key/trigger on-demand run route"
```

---

### Task 5: `POST /:key/reset-circuit`

**Files:**
- Modify: `test-workers/scrapers.test.ts`
- Modify: `src/routes/scrapers.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('POST /api/warrants/scrapers/:key/reset-circuit', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/ada-county-id/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('zeroes consecutive_errors and closes the circuit', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/ada-county-id/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const body = await listRes.json() as { sources: Array<{ source_key: string; circuit_broken: 0 | 1; consecutive_errors: number }> };
    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.consecutive_errors).toBe(0);
    expect(ada?.circuit_broken).toBe(0);
  });

  it('returns 404 for an unknown source key', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/not-a-real-source/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — 404 for `POST /:key/reset-circuit`

- [ ] **Step 3: Implement the route** (insert in `src/routes/scrapers.ts`, after `POST /:key/trigger`, before `export default scrapers;`)

```ts
scrapers.post('/:key/reset-circuit', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const db = getDb(c.env);
  const key = c.req.param('key');

  const configResult = await execute(
    db, `UPDATE warrant_scraper_config SET consecutive_errors = 0 WHERE source_name = ?`, key,
  );
  if (configResult.meta.changes > 0) return c.json({ success: true, source_key: key });

  const nationalResult = await execute(
    db, `UPDATE national_warrant_sources SET consecutive_errors = 0 WHERE source_key = ?`, key,
  );
  if (nationalResult.meta.changes > 0) return c.json({ success: true, source_key: key });

  return c.json({ error: `Unknown source key: ${key}` }, 404);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(warrants): add POST /scrapers/:key/reset-circuit route"
```

---

### Task 6: `POST /bulk` — enable/disable (backs AdminWarrantScrapersTab)

**Files:**
- Modify: `test-workers/scrapers.test.ts`
- Modify: `src/routes/scrapers.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('POST /api/warrants/scrapers/bulk', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ source_keys: ['ada-county-id'], enabled: false }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('disables sources across both frameworks in one call', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ source_keys: ['ada-county-id', 'arcgis-arlington-tx'], enabled: false }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; affected: number };
    expect(body.affected).toBe(2);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { sources: Array<{ source_key: string; enabled: 0 | 1 }> };
    expect(list.sources.find((s) => s.source_key === 'ada-county-id')?.enabled).toBe(0);
    expect(list.sources.find((s) => s.source_key === 'arcgis-arlington-tx')?.enabled).toBe(0);
  });

  it('rejects a request missing source_keys', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: FAIL — 404 for `POST /bulk`

- [ ] **Step 3: Implement the route** (insert in `src/routes/scrapers.ts`, after `POST /:key/reset-circuit`, before `export default scrapers;` — register this literal-path route so it's matched before `/:key/...` param routes for the same reason `/health` needed to come first)

```ts
scrapers.post('/bulk', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const body = await c.req.json<{ source_keys?: string[]; enabled?: boolean }>();
  if (!Array.isArray(body.source_keys) || body.source_keys.length === 0 || typeof body.enabled !== 'boolean') {
    return c.json({ error: 'source_keys (array) and enabled (boolean) are required' }, 400);
  }

  const db = getDb(c.env);
  const enabledVal = body.enabled ? 1 : 0;
  let affected = 0;

  for (const key of body.source_keys) {
    const configResult = await execute(
      db, `UPDATE warrant_scraper_config SET enabled = ? WHERE source_name = ?`, enabledVal, key,
    );
    if (configResult.meta.changes > 0) { affected++; continue; }

    const nationalResult = await execute(
      db, `UPDATE national_warrant_sources SET enabled = ? WHERE source_key = ?`, enabledVal, key,
    );
    if (nationalResult.meta.changes > 0) affected++;
  }

  return c.json({ success: true, affected });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts`
Expected: PASS — full file green

- [ ] **Step 5: Commit**

```bash
git add src/routes/scrapers.ts test-workers/scrapers.test.ts
git commit -m "feat(warrants): add POST /scrapers/bulk enable/disable route"
```

---

### Task 7: Mount the router

**Files:**
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Add the import**

Find the existing `import warrants from './routes/warrants';` line (around line 97) in `src/routesConfig.ts` and add immediately after it:

```ts
import scrapers from './routes/scrapers';
```

- [ ] **Step 2: Add the registry entry**

Find the existing entry:

```ts
  // ── Warrants — real implementation ─────────────────────────
  { prefix: '/api/warrants', router: warrants, auth: 'required' },
```

Replace it with (the `/scrapers` mount goes **first** — Hono/the registry iterator dispatches in array order, and `/api/warrants/scrapers` must be tried before the broader `/api/warrants` mount can claim the request):

```ts
  // ── Warrants — real implementation ─────────────────────────
  { prefix: '/api/warrants/scrapers', router: scrapers, auth: 'required',
    note: 'Warrant scraper ops: list/health (both warrant_scraper_config + national_warrant_sources frameworks), on-demand trigger, circuit reset, bulk enable/disable. Backs ScrapersTab.tsx + AdminWarrantScrapersTab.tsx, both previously unbacked (2026-07-04).' },
  { prefix: '/api/warrants', router: warrants, auth: 'required' },
```

- [ ] **Step 3: Verify mount ordering with a smoke request**

Run: `npm run dev` (in one terminal), then in another:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/api/warrants/scrapers
```

Expected: `401` (auth required, no token — proves the route is reached and not swallowed by `/api/warrants`, which would also 401 but you're confirming the scrapers router specifically responds by checking server logs show `scrapers.ts` handling it, or temporarily add a `console.log` in the route and remove it after confirming).

- [ ] **Step 4: Run the full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including `scrapers.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/routesConfig.ts
git commit -m "feat(warrants): mount /api/warrants/scrapers router"
```

---

### Task 8: Typecheck, full suite, manual smoke, PR

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full node test suite**

Run: `npx vitest run`
Expected: all pass (no regressions)

- [ ] **Step 3: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass

- [ ] **Step 4: Manual UI smoke check**

Run `npm run dev` (Worker) and `cd client && npm run dev` (Vite):
- Open the Warrants page's Scrapers tab: confirm the source list loads (no more 404), click "trigger now" on a source, confirm the health summary updates.
- Open the Admin page's Warrant Scrapers tab: confirm the bulk enable/disable toggle now persists (was cosmetic before migration 0151, per that migration's own comment).

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(warrants): add scraper ops routes (list/health/trigger/reset-circuit/bulk)" --body "$(cat <<'EOF'
## Summary
- New /api/warrants/scrapers router backs BOTH ScrapersTab.tsx and
  AdminWarrantScrapersTab.tsx — neither had any matching backend route
  before this PR (broken-functionality audit found the entire surface
  unbuilt, bigger than the original "just wire trigger/reset" ask)
- Merges warrant_scraper_config (code-resident adapters) and
  national_warrant_sources (federated config-driven pull) into one list
- circuit_broken derived per-request via the existing isCircuitOpen()
  pure function — no new stored flag
- On-demand trigger reuses existing scan machinery (runUtahWarrantScan /
  runFullListLeg) rather than duplicating fetch logic
- Deferred: run-history table, percentile metrics, A-F health grades
  (metrics_24h ships zeroed, documented as not-yet-computed)

## Test plan
- [x] npx vitest run --config vitest.workers.config.mts test-workers/scrapers.test.ts
- [x] npm run typecheck
- [x] Manual: ScrapersTab list/trigger/health + AdminWarrantScrapersTab bulk toggle

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After merge — apply migration to live D1**

```bash
scripts/apply-migration.sh 0172_scraper_consecutive_errors.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT consecutive_errors FROM warrant_scraper_config LIMIT 1"
npx wrangler d1 execute rmpg-flex --remote --command "SELECT consecutive_errors FROM national_warrant_sources LIMIT 1"
```

Expected: both queries succeed (columns exist), confirming the migration landed on live D1 `785de7ae-...`.
