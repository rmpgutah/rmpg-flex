# SOR State Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill `offense`/`risk_level`/`tier`/`registration_status` on `national_sex_offenders` rows for Utah, Idaho, Nevada, Wyoming, Colorado, and Arizona by fetching each offender's already-known `detail_url` and parsing the state's own page — no full-registry crawling, no new auth.

**Architecture:** New `src/utils/sorEnrichment/` module mirroring the existing `warrantSources/` adapter shape: pure `parseDetailPage(html)` functions per state (label-driven text extraction, since no live HTML samples are available to build exact selectors), a `registry.ts` keyed by 2-letter state code, and a `runner.ts` that fetches pending rows' `detail_url`s and applies the matching parser. One new audit table (`sor_enrichment_runs`), one new admin-gated trigger route (`POST /api/nsopw/enrich`), and one line added to the existing `*/30 * * * *` cron branch.

**Tech Stack:** Hono, Cloudflare D1, Vitest (Node suite for pure-function parser tests, Miniflare for the route test), existing `src/utils/db.ts` helpers, existing `src/middleware/auth.ts` `requireRole`.

---

### Task 1: Migration — `sor_enrichment_runs` table

**Files:**
- Create: `migrations/0173_sor_enrichment_runs.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0173: sor_enrichment_runs — audit log for per-state SOR detail-page
-- enrichment (fetches each offender's already-known detail_url and parses
-- offense/risk_level/tier out of it; see src/utils/sorEnrichment/). Not a
-- source-config table like national_warrant_sources — there's nothing to
-- toggle per-state in this pass, just 6 fixed code-resident parsers.
CREATE TABLE IF NOT EXISTS sor_enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_id INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error_message TEXT,
  parsed_offense TEXT,
  parsed_risk_level TEXT,
  raw_snippet TEXT,
  attempted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sor_enrichment_offender ON sor_enrichment_runs(offender_id);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npx wrangler d1 execute rmpg-flex --local --file=migrations/0173_sor_enrichment_runs.sql`
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='sor_enrichment_runs'"`
Expected: prints the CREATE TABLE statement above.

- [ ] **Step 3: Commit**

```bash
git add migrations/0173_sor_enrichment_runs.sql
git commit -m "feat(sor): add sor_enrichment_runs table migration"
```

---

### Task 2: Types + registry

**Files:**
- Create: `src/utils/sorEnrichment/types.ts`
- Create: `src/utils/sorEnrichment/registry.ts`

- [ ] **Step 1: Write `src/utils/sorEnrichment/types.ts`**

```ts
// Per-state SOR detail-page enrichment types.
//
// Each adapter is a PURE function: given the raw HTML of a state's public
// offender detail page (already fetched by the runner), extract whatever
// fields the page exposes. Adapters never fetch — that's the runner's job
// (one place to handle timeouts/retries/user-agent, not six).
//
// Parsing is label-driven/tolerant text extraction, not exact CSS selectors
// — these were built without a live HTML sample from any of the 6 target
// states, so precision will need tightening once real pages are captured
// (see raw_snippet on sor_enrichment_runs, meant for exactly that).

export interface ParsedEnrichment {
  offense: string | null;
  risk_level: string | null;
  tier: number | null;
  registration_status: string | null;
}

export interface SorEnrichmentAdapter {
  state: string; // 2-letter code, e.g. 'UT'
  parseDetailPage(html: string): ParsedEnrichment;
}
```

- [ ] **Step 2: Write `src/utils/sorEnrichment/registry.ts`**

```ts
import type { SorEnrichmentAdapter } from './types';
import { utahAdapter } from './adapters/utah';
import { idahoAdapter } from './adapters/idaho';
import { nevadaAdapter } from './adapters/nevada';
import { wyomingAdapter } from './adapters/wyoming';
import { coloradoAdapter } from './adapters/colorado';
import { arizonaAdapter } from './adapters/arizona';

/** Fixed 6-state set for this pass. Adding a 7th state = one new adapter
 *  file + one new entry here — nothing else changes. */
export const ADAPTERS: Record<string, SorEnrichmentAdapter> = {
  UT: utahAdapter,
  ID: idahoAdapter,
  NV: nevadaAdapter,
  WY: wyomingAdapter,
  CO: coloradoAdapter,
  AZ: arizonaAdapter,
};

export function getAdapterForJurisdiction(jurisdiction: string): SorEnrichmentAdapter | undefined {
  return ADAPTERS[jurisdiction.toUpperCase()];
}
```

- [ ] **Step 3: These files won't compile yet** (the 6 adapter imports don't exist) — that's expected, Task 3 creates them. No test/typecheck run yet.

- [ ] **Step 4: Commit** (only after Task 3's adapters exist, so this compiles — see Task 3 Step 8 for the actual commit point covering both).

---

### Task 3: The 6 state parsers (pure functions, TDD)

**Files:**
- Create: `src/utils/sorEnrichment/adapters/utah.ts`
- Create: `src/utils/sorEnrichment/adapters/idaho.ts`
- Create: `src/utils/sorEnrichment/adapters/nevada.ts`
- Create: `src/utils/sorEnrichment/adapters/wyoming.ts`
- Create: `src/utils/sorEnrichment/adapters/colorado.ts`
- Create: `src/utils/sorEnrichment/adapters/arizona.ts`
- Create: `tests/sorEnrichment/adapters.test.ts`

All 6 parsers share the same label-driven approach: regex-search the HTML for `Label: value`-style text (tolerant of surrounding HTML tags), case-insensitive. Since no live page samples exist, each test fixture below is a **synthetic approximation** of a typical OffenderWatch/state-registry detail page layout — flag this in the test file's header comment so a future maintainer knows to swap in real captured HTML once available.

- [ ] **Step 1: Write the failing test file `tests/sorEnrichment/adapters.test.ts`**

```ts
// NOTE: these fixtures are SYNTHETIC approximations of each state's detail
// page (no live sample was available when this was written — see
// docs/superpowers/specs/2026-07-04-sor-state-enrichment-design.md).
// Replace with real captured HTML once a human confirms actual page
// structure post-merge; the parsers are intentionally tolerant/label-driven
// so they degrade gracefully rather than throw on a format mismatch.
import { describe, it, expect } from 'vitest';
import { utahAdapter } from '../../src/utils/sorEnrichment/adapters/utah';
import { idahoAdapter } from '../../src/utils/sorEnrichment/adapters/idaho';
import { nevadaAdapter } from '../../src/utils/sorEnrichment/adapters/nevada';
import { wyomingAdapter } from '../../src/utils/sorEnrichment/adapters/wyoming';
import { coloradoAdapter } from '../../src/utils/sorEnrichment/adapters/colorado';
import { arizonaAdapter } from '../../src/utils/sorEnrichment/adapters/arizona';

describe('utahAdapter', () => {
  it('extracts offense, risk level, and tier from a label-driven page', () => {
    const html = `<div class="offender-detail">
      <p>Offense: Lewdness Involving a Child</p>
      <p>Risk Level: High</p>
      <p>Tier: 3</p>
      <p>Registration Status: Compliant</p>
    </div>`;
    const result = utahAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Lewdness Involving a Child');
    expect(result.risk_level).toBe('High');
    expect(result.tier).toBe(3);
    expect(result.registration_status).toBe('Compliant');
  });

  it('returns nulls for all fields on unrecognized HTML rather than throwing', () => {
    const result = utahAdapter.parseDetailPage('<html><body>Not found</body></html>');
    expect(result).toEqual({ offense: null, risk_level: null, tier: null, registration_status: null });
  });
});

describe('idahoAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<span>Charge: Sexual Abuse of a Minor</span><span>Risk Tier: 2</span>`;
    const result = idahoAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Abuse of a Minor');
    expect(result.tier).toBe(2);
  });
});

describe('nevadaAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<td>Conviction: Statutory Sexual Seduction</td><td>Tier Level: 1</td>`;
    const result = nevadaAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Statutory Sexual Seduction');
    expect(result.tier).toBe(1);
  });
});

describe('wyomingAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<p>Offense(s): Sexual Assault in the Second Degree</p><p>Tier: 3</p>`;
    const result = wyomingAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Assault in the Second Degree');
    expect(result.tier).toBe(3);
  });
});

describe('coloradoAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<div>Offense Description: Sexual Assault on a Child</div><div>Registration Status: Non-Compliant</div>`;
    const result = coloradoAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Assault on a Child');
    expect(result.registration_status).toBe('Non-Compliant');
  });
});

describe('arizonaAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<li>Crime: Molestation of a Child</li><li>Level: 3</li>`;
    const result = arizonaAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Molestation of a Child');
    expect(result.tier).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sorEnrichment/adapters.test.ts`
Expected: FAIL — cannot find modules (adapter files don't exist yet)

- [ ] **Step 3: Write `src/utils/sorEnrichment/adapters/utah.ts`**

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier', 'Tier Level', 'Level');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const utahAdapter: SorEnrichmentAdapter = {
  state: 'UT',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

- [ ] **Step 4: Run test to verify Utah tests pass**

Run: `npx vitest run tests/sorEnrichment/adapters.test.ts -t utahAdapter`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the remaining 5 adapters**, each following the exact same shared-helper pattern as `utah.ts` (each file redefines its own local `extractLabel`/`extractTier` — small, focused files per the plan's file-structure principle; sharing a helper module is a reasonable future refactor once 3+ states show truly identical logic, but not required now since each state's label vocabulary differs):

`src/utils/sorEnrichment/adapters/idaho.ts`:

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Risk Tier', 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const idahoAdapter: SorEnrichmentAdapter = {
  state: 'ID',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Charge', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

`src/utils/sorEnrichment/adapters/nevada.ts`:

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier Level', 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const nevadaAdapter: SorEnrichmentAdapter = {
  state: 'NV',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Conviction', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

`src/utils/sorEnrichment/adapters/wyoming.ts`:

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const wyomingAdapter: SorEnrichmentAdapter = {
  state: 'WY',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Offense\\(s\\)', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

`src/utils/sorEnrichment/adapters/colorado.ts`:

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const coloradoAdapter: SorEnrichmentAdapter = {
  state: 'CO',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Offense Description', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

`src/utils/sorEnrichment/adapters/arizona.ts`:

```ts
import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*<?[^>]*>?\\s*([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Level', 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const arizonaAdapter: SorEnrichmentAdapter = {
  state: 'AZ',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Crime', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
```

- [ ] **Step 6: Run the full adapter test file**

Run: `npx vitest run tests/sorEnrichment/adapters.test.ts`
Expected: PASS (all 7 tests — 2 for Utah, 1 each for the other 5)

- [ ] **Step 7: Run typecheck** to confirm `registry.ts` from Task 2 now compiles with all 6 adapter imports resolved:

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 8: Commit everything from Tasks 2 and 3 together** (registry.ts only compiles once all 6 adapters exist, so this is the first valid commit point for that file):

```bash
git add src/utils/sorEnrichment/types.ts src/utils/sorEnrichment/registry.ts src/utils/sorEnrichment/adapters/ tests/sorEnrichment/adapters.test.ts
git commit -m "feat(sor): add per-state detail-page parsers (UT/ID/NV/WY/CO/AZ)"
```

---

### Task 4: Runner

**Files:**
- Create: `src/utils/sorEnrichment/runner.ts`
- Create: `tests/sorEnrichment/runner.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Node-suite unit test for the runner's per-row logic, using a fake D1
// (no Miniflare needed — this doesn't touch Hono routing) and a stubbed
// global fetch so no real network call happens.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeFakeDb } from '../helpers/fakeD1';
import { enrichPendingOffenders } from '../../src/utils/sorEnrichment/runner';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enrichPendingOffenders', () => {
  it('fetches each pending row\'s detail_url, parses it, and updates the row', async () => {
    const rows = [
      { id: 1, jurisdiction: 'UT', detail_url: 'https://example.com/ut/1' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
      { match: /UPDATE national_sex_offenders/i, rows: [] },
      { match: /INSERT INTO sor_enrichment_runs/i, rows: [] },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<p>Offense: Test Offense</p><p>Risk Level: Low</p>',
    } as Response);

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips a row whose jurisdiction has no matching adapter', async () => {
    const rows = [
      { id: 2, jurisdiction: 'ZZ', detail_url: 'https://example.com/zz/2' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
    ]);
    global.fetch = vi.fn();

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('logs a failure and continues when fetch throws, without aborting the batch', async () => {
    const rows = [
      { id: 3, jurisdiction: 'UT', detail_url: 'https://example.com/ut/3' },
      { id: 4, jurisdiction: 'ID', detail_url: 'https://example.com/id/4' },
    ];
    const db = makeFakeDb([
      { match: /SELECT id, jurisdiction, detail_url FROM national_sex_offenders/i, rows },
      { match: /UPDATE national_sex_offenders/i, rows: [] },
      { match: /INSERT INTO sor_enrichment_runs/i, rows: [] },
    ]);

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '<p>Charge: Test Charge</p>',
      } as Response);

    const result = await enrichPendingOffenders(db as never);
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
```

Check `tests/helpers/fakeD1.ts` exists already (it's referenced by `tests/warrantSources/registry.test.ts` from earlier work) — reuse it as-is, don't recreate it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sorEnrichment/runner.test.ts`
Expected: FAIL — cannot find module `../../src/utils/sorEnrichment/runner`

- [ ] **Step 3: Write `src/utils/sorEnrichment/runner.ts`**

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from '../db';
import { getAdapterForJurisdiction } from './registry';

const MAX_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 10_000;

export interface EnrichmentSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backfills offense/risk_level/tier/registration_status on
 * national_sex_offenders rows for the 6 supported jurisdictions, by
 * fetching each row's already-known detail_url and running it through the
 * matching state's pure parser. Bounded to MAX_PER_RUN rows per invocation
 * (this runs inside a Worker cron tick, not an unbounded background job).
 * A per-row failure (network error, no matching adapter) never aborts the
 * batch — matches the existing warrant-poller pattern.
 */
export async function enrichPendingOffenders(db: D1Database): Promise<EnrichmentSummary> {
  const rows = await query<{ id: number; jurisdiction: string; detail_url: string }>(
    db,
    `SELECT id, jurisdiction, detail_url FROM national_sex_offenders
     WHERE jurisdiction IN ('UT','ID','NV','WY','CO','AZ')
       AND detail_url IS NOT NULL AND detail_url != ''
       AND offense IS NULL
     LIMIT ?`,
    MAX_PER_RUN,
  );

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const adapter = getAdapterForJurisdiction(row.jurisdiction);
    if (!adapter) continue; // no matching state parser — skip silently, not a failure

    attempted++;
    try {
      const res = await fetchWithTimeout(row.detail_url, FETCH_TIMEOUT_MS);
      const html = await res.text();
      const parsed = adapter.parseDetailPage(html);

      await execute(
        db,
        `UPDATE national_sex_offenders
         SET offense = ?, risk_level = ?, tier = ?, registration_status = ?, updated_at = datetime('now')
         WHERE id = ?`,
        parsed.offense, parsed.risk_level, parsed.tier, parsed.registration_status, row.id,
      );
      await execute(
        db,
        `INSERT INTO sor_enrichment_runs
         (offender_id, jurisdiction, detail_url, success, http_status, parsed_offense, parsed_risk_level, raw_snippet)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        row.id, row.jurisdiction, row.detail_url, res.status,
        parsed.offense, parsed.risk_level, html.slice(0, 2000),
      );
      succeeded++;
    } catch (err) {
      failed++;
      await execute(
        db,
        `INSERT INTO sor_enrichment_runs
         (offender_id, jurisdiction, detail_url, success, error_message)
         VALUES (?, ?, ?, 0, ?)`,
        row.id, row.jurisdiction, row.detail_url,
        err instanceof Error ? err.message : String(err),
      ).catch(() => {}); // logging the failure must never itself throw and abort the batch
    }
  }

  return { attempted, succeeded, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sorEnrichment/runner.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/sorEnrichment/runner.ts tests/sorEnrichment/runner.test.ts
git commit -m "feat(sor): add enrichPendingOffenders runner"
```

---

### Task 5: Route — `POST /api/nsopw/enrich`

**Files:**
- Modify: `src/routes/nsopw.ts`
- Create: `test-workers/nsopwEnrich.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for POST /api/nsopw/enrich.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import nsopw from '../src/routes/nsopw';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/nsopw', nsopw);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS national_sex_offenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, jurisdiction TEXT, detail_url TEXT,
    offense TEXT, risk_level TEXT, tier INTEGER, registration_status TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS sor_enrichment_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, offender_id INTEGER NOT NULL, jurisdiction TEXT NOT NULL,
    detail_url TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 0, http_status INTEGER,
    error_message TEXT, parsed_offense TEXT, parsed_risk_level TEXT, raw_snippet TEXT,
    attempted_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO national_sex_offenders (jurisdiction, detail_url) VALUES ('UT', 'https://example.com/ut/1')`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/nsopw/enrich', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/nsopw/enrich', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('runs a batch and returns a summary', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => '<p>Offense: Test Offense</p><p>Risk Level: Low</p>',
    } as Response);

    const app = buildApp('admin');
    const res = await app.request('/api/nsopw/enrich', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { attempted: number; succeeded: number; failed: number };
    expect(body.attempted).toBe(1);
    expect(body.succeeded).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/nsopwEnrich.test.ts`
Expected: FAIL — 404 for POST /enrich

- [ ] **Step 3: Implement the route**

In `src/routes/nsopw.ts`, add the import (alongside the existing imports near the top):

```ts
import { enrichPendingOffenders } from '../utils/sorEnrichment/runner';
```

Then add the route (find a sensible spot near the other admin-gated routes like `/cache/vacuum`, using the file's existing `ADMIN_ROLES` constant):

```ts
// ── POST /api/nsopw/enrich ──────────────────────────────────
// Admin-triggered batch run of the per-state SOR detail-page enrichment
// (see src/utils/sorEnrichment/). Also rides the */30 cron tick — see
// src/index.ts — this route exists for on-demand/manual runs.
nsopw.post('/enrich', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const summary = await enrichPendingOffenders(db);
  return c.json(summary);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/nsopwEnrich.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/routes/nsopw.ts test-workers/nsopwEnrich.test.ts
git commit -m "feat(sor): add POST /api/nsopw/enrich trigger route"
```

---

### Task 6: Cron wiring

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the call inside the existing `*/30 * * * *` branch**

In `src/index.ts`, find the `if (event.cron === '*/30 * * * *') { ... }` block (currently contains the ServeManager job poller). Add, inside that same `if` block, alongside the existing `ctx.waitUntil(...)` call:

```ts
    // ── Every 30 minutes ──
    if (event.cron === '*/30 * * * *') {
      // ServeManager job poller — syncs jobs from ServeManager into CFS dispatch
      ctx.waitUntil(
        import('./utils/serveManagerPoller').then((m) =>
          m.pollServeManagerJobs(env).then((r) => {
            if (r.synced > 0 || r.callsCreated > 0) {
              console.log(`[sm-poller] synced ${r.synced} jobs, created ${r.callsCreated} calls`);
            }
            if (r.error) console.error('[sm-poller]', r.error);
          }).catch((err) => console.error('[sm-poller] failed:', err)),
        ).catch(() => {}),
      );

      // SOR per-state detail-page enrichment — backfills offense/risk_level
      // for national_sex_offenders rows in the 6 supported states.
      ctx.waitUntil(
        import('./utils/sorEnrichment/runner').then((m) =>
          m.enrichPendingOffenders(env.DB).then((r) => {
            if (r.attempted > 0) {
              console.log(`[sor-enrich] attempted ${r.attempted}, succeeded ${r.succeeded}, failed ${r.failed}`);
            }
          }).catch((err) => console.error('[sor-enrich] failed:', err)),
        ).catch(() => {}),
      );
    }
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Run the full worker suite** (this doesn't add a new test — the cron branch itself isn't directly unit-tested in this repo's existing pattern, matching how the ServeManager poller line above it is handled — but confirm nothing broke):

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(sor): wire enrichPendingOffenders into the 30-minute cron tick"
```

---

### Task 7: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full node test suite**

Run: `npx vitest run`
Expected: all pass, including the new `tests/sorEnrichment/*.test.ts` files

- [ ] **Step 3: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including `test-workers/nsopwEnrich.test.ts`

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/sor-state-enrichment
gh pr create --title "feat(sor): add per-state detail-page enrichment for UT/ID/NV/WY/CO/AZ" --body "$(cat <<'EOF'
## Summary
- Backfills offense/risk_level/tier/registration_status on national_sex_offenders
  rows for 6 states by fetching each offender's already-known detail_url and
  parsing the state's own page — no full-registry crawling, no new auth
  (detail_url is a public deep-link NSOPW already gives us per confirmed hit)
- New src/utils/sorEnrichment/ module: 6 pure per-state parsers (label-driven
  text extraction — no live HTML sample was available, so precision will need
  tightening once real pages are captured; raw_snippet on sor_enrichment_runs
  exists specifically for that follow-up)
- New POST /api/nsopw/enrich admin-gated trigger route + rides the existing
  */30 cron tick (no new cron trigger)
- Explicitly out of scope: states 7+, any UI changes, Firecrawl fallback for
  JS-rendered/bot-challenged state pages (follow-up if a live test shows a
  given state needs it)

## Test plan
- [x] npx vitest run tests/sorEnrichment/ — parser + runner unit tests, all synthetic-fixture-based (flagged in test file headers)
- [x] npx vitest run --config vitest.workers.config.mts test-workers/nsopwEnrich.test.ts
- [x] npm run typecheck
- [x] Full node + worker suites green

## Post-merge
Apply the migration to live D1 per CLAUDE.md convention:
```
scripts/apply-migration.sh 0173_sor_enrichment_runs.sql
```

**Before relying on this in production**: the 6 parsers were built without live HTML samples from any target state. Capture a real detail page from each state (follow whatever NSOPW returns as detail_url for a known offender) and diff against the parser's raw_snippet output in sor_enrichment_runs to confirm/tighten the label patterns.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: After merge — apply migration to live D1**

```bash
scripts/apply-migration.sh 0173_sor_enrichment_runs.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE name='sor_enrichment_runs'"
```

Expected: prints the CREATE TABLE statement, confirming the migration landed on live D1 `785de7ae-...`.
