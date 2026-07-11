# National Warrant Search Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two missing endpoints (`GET /api/warrants/national-coverage`, `POST /api/warrants/national-search`) that `NationalWarrantSearchPage.tsx` already calls but that don't exist on the Worker, with strict DOB/age-based match confirmation and full-row data capture.

**Architecture:** Two new routes appended to the existing `src/routes/warrants.ts` (already mounted at `/api/warrants`, gated against `client_viewer`). A shared helper module `src/utils/warrantNationalSearch.ts` holds the 51-entry state list, the strict-match predicate, and the row-to-`Warrant`-shape mapper — kept out of the already-large route file per this repo's file-size discipline, and reusable if `/search-all` is ever fixed later.

**Tech Stack:** Hono, Cloudflare D1, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for route tests, plain Node Vitest for the pure-function match-predicate tests.

---

### Task 1: US state list + strict-match predicate (pure functions, TDD)

**Files:**
- Create: `src/utils/warrantNationalSearch.ts`
- Create: `tests/warrantNationalSearch.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from 'vitest';
import { US_STATES, matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../src/utils/warrantNationalSearch';

describe('US_STATES', () => {
  it('has exactly 51 entries (50 states + DC)', () => {
    expect(US_STATES).toHaveLength(51);
  });

  it('includes Utah and DC with correct shape', () => {
    expect(US_STATES.find((s) => s.code === 'UT')).toEqual({ code: 'UT', name: 'Utah' });
    expect(US_STATES.find((s) => s.code === 'DC')).toEqual({ code: 'DC', name: 'District of Columbia' });
  });
});

describe('matchesDobOrAge', () => {
  it('returns true when no query dob was provided (name-only fallback)', () => {
    expect(matchesDobOrAge(null, { dob: null, age: null })).toBe(true);
    expect(matchesDobOrAge(null, { dob: '1990-01-01', age: null })).toBe(true);
  });

  it('returns true when the record dob matches the query dob exactly', () => {
    expect(matchesDobOrAge('1990-05-12', { dob: '1990-05-12', age: null })).toBe(true);
  });

  it('returns false when the record dob does not match the query dob', () => {
    expect(matchesDobOrAge('1990-05-12', { dob: '1985-01-01', age: null })).toBe(false);
  });

  it('returns true when the record has only age and it falls within +/-1 year of the query dob\'s computed age', () => {
    // Query dob of exactly 30 years before "now" — computeAge uses real Date.now(),
    // so this test computes the expected age itself rather than hardcoding one.
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    const dobStr = dob.toISOString().slice(0, 10);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 30 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 29 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 31 })).toBe(true);
    expect(matchesDobOrAge(dobStr, { dob: null, age: 25 })).toBe(false);
  });

  it('returns false when the record has neither dob nor age but the query supplied a dob', () => {
    expect(matchesDobOrAge('1990-05-12', { dob: null, age: null })).toBe(false);
  });
});

describe('mapScrapedWarrantRow', () => {
  it('maps every scraped_warrants column to the client Warrant shape, passing through extras unchanged', () => {
    const row = {
      id: 5, source_key: 'arcgis-arlington-tx', full_name: 'John Doe', first_name: 'John',
      last_name: 'Doe', middle_name: null, date_of_birth: '1990-05-12', age: 35,
      warrant_type: 'arrest', charge_description: 'Theft', court_name: 'Arlington Municipal',
      case_number: 'CR-123', bail_amount: 500, offense_level: 'misdemeanor', issue_date: '2026-01-01',
      status: 'active', warrant_id: 'W-1', person_id: null, gender: 'M', race: 'White',
      city: 'Arlington', state: 'TX', photo_url: null, detail_url: 'https://example.com/1',
      first_seen_at: '2026-01-01', last_seen_at: '2026-07-01', cleared_at: null, dob_verified: 0,
    };
    const mapped = mapScrapedWarrantRow(row);
    expect(mapped.dob).toBe('1990-05-12');
    expect(mapped.charge).toBe('Theft');
    expect(mapped.court).toBe('Arlington Municipal');
    expect(mapped.source).toBe('arcgis-arlington-tx');
    // Extras pass through under their own column name, not dropped.
    expect((mapped as unknown as Record<string, unknown>).city).toBe('Arlington');
    expect((mapped as unknown as Record<string, unknown>).case_number).toBe('CR-123');
  });
});

describe('mapLocalWarrantRow', () => {
  it('maps every warrants column to the client Warrant shape', () => {
    const row = {
      id: 9, warrant_number: 'RMPG-1', type: 'arrest', status: 'active',
      subject_first_name: 'Jane', subject_last_name: 'Smith', subject_dob: '1985-03-01',
      offense: 'Assault', offense_description: 'Simple assault', charge_description: 'Assault',
      issuing_court: 'RMPG Court', bond_amount: 1000, bail_amount: null, issued_date: '2026-02-01',
      offense_level: 'felony', warrant_type: 'arrest',
    };
    const mapped = mapLocalWarrantRow(row);
    expect(mapped.dob).toBe('1985-03-01');
    expect(mapped.court).toBe('RMPG Court');
    expect(mapped.source).toBe('local');
    expect((mapped as unknown as Record<string, unknown>).warrant_number).toBe('RMPG-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warrantNationalSearch.test.ts`
Expected: FAIL — cannot find module `../src/utils/warrantNationalSearch`

- [ ] **Step 3: Write `src/utils/warrantNationalSearch.ts`**

```ts
// Shared helpers for the national warrant search endpoints
// (GET /api/warrants/national-coverage, POST /api/warrants/national-search
// in src/routes/warrants.ts). Kept out of that file since it's already a
// large route file — this module is pure/testable on its own and reusable
// if the also-stubbed POST /search-all is ever fixed later.

export const US_STATES: Array<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/**
 * Strict match confirmation: when the query supplied a dob, a candidate
 * record is only considered a match if its OWN dob matches exactly, or —
 * for records that only carry an age — the age computed from the query's
 * dob (as of today) falls within +/-1 year of the record's stated age. A
 * record with neither dob nor age, when the query supplied a dob, does NOT
 * match — there's no basis to confirm identity. When the query supplied no
 * dob at all, every record passes (name/state-only fallback).
 */
export function matchesDobOrAge(
  queryDob: string | null,
  record: { dob: string | null; age: number | null },
): boolean {
  if (!queryDob) return true;
  if (record.dob) return record.dob === queryDob;
  if (record.age == null) return false;

  const parsed = new Date(queryDob);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  let computedAge = now.getFullYear() - parsed.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > parsed.getMonth() ||
    (now.getMonth() === parsed.getMonth() && now.getDate() >= parsed.getDate());
  if (!hasHadBirthdayThisYear) computedAge--;

  return Math.abs(computedAge - record.age) <= 1;
}

export interface MappedWarrant {
  id: string | number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  dob: string | null;
  age: number | string | null;
  state: string | null;
  warrant_type: string | null;
  offense_level: string | null;
  charge: string | null;
  issued_date: string | null;
  photo_url: string | null;
  status: string | null;
  bond_amount: number | string | null;
  court: string | null;
  source: string | null;
}

/** Maps a scraped_warrants row to the client Warrant shape, passing every
 *  other column through under its own name (capture-all-data requirement —
 *  nothing gets silently dropped, only renamed where the client expects a
 *  different key). */
export function mapScrapedWarrantRow(row: Record<string, unknown>): MappedWarrant & Record<string, unknown> {
  return {
    ...row,
    id: row.id as string | number,
    first_name: (row.first_name as string) ?? null,
    last_name: (row.last_name as string) ?? null,
    full_name: (row.full_name as string) ?? null,
    dob: (row.date_of_birth as string) ?? null,
    age: (row.age as number) ?? null,
    state: (row.state as string) ?? null,
    warrant_type: (row.warrant_type as string) ?? null,
    offense_level: (row.offense_level as string) ?? null,
    charge: (row.charge_description as string) ?? null,
    issued_date: (row.issue_date as string) ?? null,
    photo_url: (row.photo_url as string) ?? null,
    status: (row.status as string) ?? null,
    bond_amount: (row.bail_amount as number) ?? null,
    court: (row.court_name as string) ?? null,
    source: (row.source_key as string) ?? null,
  };
}

/** Maps a local `warrants` row to the client Warrant shape, same
 *  capture-all-data pass-through rule as mapScrapedWarrantRow. */
export function mapLocalWarrantRow(row: Record<string, unknown>): MappedWarrant & Record<string, unknown> {
  return {
    ...row,
    id: row.id as string | number,
    first_name: (row.subject_first_name as string) ?? null,
    last_name: (row.subject_last_name as string) ?? null,
    full_name: (row.subject_name as string) ?? null,
    dob: (row.subject_dob as string) ?? null,
    age: null,
    state: null,
    warrant_type: (row.warrant_type as string) ?? (row.type as string) ?? null,
    offense_level: (row.offense_level as string) ?? null,
    charge: (row.charge_description as string) ?? (row.offense as string) ?? null,
    issued_date: (row.issued_date as string) ?? null,
    photo_url: null,
    status: (row.status as string) ?? null,
    bond_amount: (row.bond_amount as number) ?? (row.bail_amount as number) ?? null,
    court: (row.issuing_court as string) ?? (row.court as string) ?? null,
    source: 'local',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warrantNationalSearch.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/warrantNationalSearch.ts tests/warrantNationalSearch.test.ts
git commit -m "feat(warrants): add US state list, strict-match predicate, and row mappers"
```

---

### Task 2: `GET /api/warrants/national-coverage`

**Files:**
- Modify: `src/routes/warrants.ts`
- Create: `test-workers/warrantsNationalCoverage.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for
// GET /api/warrants/national-coverage.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS national_warrant_sources (
    source_key TEXT PRIMARY KEY, family TEXT NOT NULL, display_name TEXT NOT NULL,
    state TEXT, jurisdiction TEXT, mode TEXT NOT NULL DEFAULT 'full-list',
    format TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 3
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, first_name TEXT, last_name TEXT,
    date_of_birth TEXT, age INTEGER, state TEXT, status TEXT DEFAULT 'active'
  )`);

  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority)
    VALUES ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington', 'arcgis', 1, 2)`);
  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority)
    VALUES ('socrata-brla-citycourt', 'socrata', 'Baton Rouge City Court Warrants', 'LA', 'Baton Rouge', 'socrata', 0, 2)`);

  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status) VALUES ('arcgis-arlington-tx', 'John', 'Doe', 'TX', 'active')`);
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status) VALUES ('arcgis-arlington-tx', 'Jane', 'Roe', 'TX', 'active')`);
});

describe('GET /api/warrants/national-coverage', () => {
  it('returns all 51 states with active/disabled status and per-state counts', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-coverage', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      states: Array<{ stateCode: string; stateName: string; available: boolean; message?: string }>;
      sources: number;
      states_covered: number;
      active_warrants: number;
      state_status: Record<string, string>;
      state_sources: Record<string, number>;
      state_warrants: Record<string, number>;
    };

    expect(body.states).toHaveLength(51);

    const tx = body.states.find((s) => s.stateCode === 'TX');
    expect(tx?.available).toBe(true);
    expect(body.state_sources.TX).toBe(1);
    expect(body.state_warrants.TX).toBe(2);

    // Louisiana's only source is disabled, and Utah has a code-resident
    // adapter (utahApi.ts) even with no national_warrant_sources row.
    const la = body.states.find((s) => s.stateCode === 'LA');
    expect(la?.available).toBe(false);
    expect(la?.message).toBeTruthy();

    const ut = body.states.find((s) => s.stateCode === 'UT');
    expect(ut?.available).toBe(true);

    // A state with zero sources of any kind, e.g. Hawaii.
    const hi = body.states.find((s) => s.stateCode === 'HI');
    expect(hi?.available).toBe(false);

    expect(body.states_covered).toBeGreaterThanOrEqual(2); // at least TX + UT
    expect(body.active_warrants).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalCoverage.test.ts`
Expected: FAIL — 404 for GET /national-coverage

- [ ] **Step 3: Implement the route**

Add the import at the top of `src/routes/warrants.ts` (alongside the existing `runUtahWarrantScan` import):

```ts
import { getEnabledAdapters } from '../utils/warrantSources/registry';
import { US_STATES } from '../utils/warrantNationalSearch';
```

Add the route just before `export default warrants;`:

```ts
// GET /national-coverage — per-state source/warrant counts for the
// NationalWarrantSearchPage coverage map. A state counts as 'active' if it
// has at least one enabled source, from EITHER national_warrant_sources
// (config-driven) or the code-resident ADAPTERS registry (excluding the
// FBI adapter's state:'US' — that's federal, not state-specific coverage).
warrants.get('/national-coverage', async (c) => {
  const db = getDb(c.env);

  const configRows = await query<{ state: string | null; enabled: number }>(
    db, `SELECT state, enabled FROM national_warrant_sources WHERE enabled = 1`,
  );
  const codeAdapters = await getEnabledAdapters(db);

  const stateSources = new Map<string, number>();
  for (const row of configRows) {
    if (!row.state) continue;
    const code = row.state.toUpperCase();
    stateSources.set(code, (stateSources.get(code) ?? 0) + 1);
  }
  for (const adapter of codeAdapters) {
    if (adapter.meta.state === 'US') continue;
    const code = adapter.meta.state.toUpperCase();
    stateSources.set(code, (stateSources.get(code) ?? 0) + 1);
  }

  const warrantCountRows = await query<{ state: string | null; n: number }>(
    db, `SELECT state, COUNT(*) as n FROM scraped_warrants WHERE status = 'active' GROUP BY state`,
  );
  const stateWarrants = new Map<string, number>();
  for (const row of warrantCountRows) {
    if (!row.state) continue;
    stateWarrants.set(row.state.toUpperCase(), row.n);
  }

  const state_sources: Record<string, number> = {};
  const state_warrants: Record<string, number> = {};
  const state_status: Record<string, string> = {};
  const states = US_STATES.map(({ code, name }) => {
    const sourceCount = stateSources.get(code) ?? 0;
    const warrantCount = stateWarrants.get(code) ?? 0;
    const available = sourceCount > 0;
    state_sources[code] = sourceCount;
    state_warrants[code] = warrantCount;
    state_status[code] = available ? 'active' : 'disabled';
    return {
      stateCode: code,
      stateName: name,
      available,
      ...(available ? {} : { message: 'No active sources configured' }),
    };
  });

  const states_covered = states.filter((s) => s.available).length;
  const sources = Object.values(state_sources).reduce((a, b) => a + b, 0);
  const active_warrants = Object.values(state_warrants).reduce((a, b) => a + b, 0);

  return c.json({
    states,
    updatedAt: new Date().toISOString(),
    sources,
    states_covered,
    active_warrants,
    state_status,
    state_sources,
    state_warrants,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalCoverage.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/warrants.ts test-workers/warrantsNationalCoverage.test.ts
git commit -m "feat(warrants): add GET /national-coverage route"
```

---

### Task 3: `POST /api/warrants/national-search`

**Files:**
- Modify: `src/routes/warrants.ts`
- Create: `test-workers/warrantsNationalSearch.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for
// POST /api/warrants/national-search.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, full_name TEXT, first_name TEXT,
    last_name TEXT, date_of_birth TEXT, warrant_type TEXT, charge_description TEXT,
    court_name TEXT, case_number TEXT, bail_amount REAL, offense_level TEXT, issue_date TEXT,
    status TEXT DEFAULT 'active', warrant_id TEXT, person_id INTEGER, middle_name TEXT,
    age INTEGER, gender TEXT, race TEXT, city TEXT, state TEXT, photo_url TEXT, detail_url TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, type TEXT, status TEXT DEFAULT 'active',
    subject_name TEXT, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT,
    offense TEXT, offense_description TEXT, charge_description TEXT, issuing_court TEXT,
    bond_amount REAL, bail_amount REAL, issued_date TEXT, offense_level TEXT, warrant_type TEXT
  )`);

  // Exact DOB match — should be included when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, date_of_birth, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', '1990-05-12', 'TX', 'active')`);
  // Same name, different DOB — should be EXCLUDED when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, date_of_birth, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', '1975-01-01', 'TX', 'active')`);
  // Same name, no dob, but age unset either — should be EXCLUDED when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', 'TX', 'active')`);

  await execute(db, `INSERT INTO warrants (warrant_number, subject_first_name, subject_last_name, subject_dob, status)
    VALUES ('RMPG-1', 'John', 'Smith', '1990-05-12', 'active')`);
});

describe('POST /api/warrants/national-search', () => {
  it('rejects an empty query', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST', body: JSON.stringify({}),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  it('applies strict DOB matching: only the exact-DOB row and the local row are returned, not the DOB-mismatch or no-DOB rows', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith', dob: '1990-05-12' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; by_state: Record<string, Array<{ dob: string }>>; local: Array<{ dob: string }> };

    expect(body.by_state.TX).toHaveLength(1);
    expect(body.by_state.TX[0].dob).toBe('1990-05-12');
    expect(body.local).toHaveLength(1);
    expect(body.local[0].dob).toBe('1990-05-12');
    expect(body.total).toBe(2);
  });

  it('falls back to name-only matching (all 3 scraped rows) when no dob is supplied', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { by_state: Record<string, unknown[]> };
    expect(body.by_state.TX).toHaveLength(3);
  });

  it('captures every column from the source row, not just a curated subset', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith', dob: '1990-05-12' }),
    }, env as unknown as Record<string, unknown>);
    const body = await res.json() as { by_state: Record<string, Array<Record<string, unknown>>> };
    // source_key/city/state (not part of the curated MappedWarrant fields)
    // must still be present, passed through under their own column name.
    expect(body.by_state.TX[0].source_key).toBe('arcgis-arlington-tx');
    expect(body.by_state.TX[0].state).toBe('TX');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalSearch.test.ts`
Expected: FAIL — 404 for POST /national-search

- [ ] **Step 3: Implement the route**

Add the import at the top of `src/routes/warrants.ts` (alongside the other new import from Task 2):

```ts
import { matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../utils/warrantNationalSearch';
```

Add the route just before `export default warrants;` (after the `national-coverage` route from Task 2):

```ts
// POST /national-search — federated search across scraped_warrants +
// local warrants, with strict DOB/age match confirmation. Read-only: never
// sets status/cleared_at — clearing stays governed exclusively by
// src/utils/warrantSources/runScan.ts's "never wrongly clear" invariant.
warrants.post('/national-search', async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json<{
    first_name?: string; last_name?: string; dob?: string; state?: string;
    offense_level?: string; warrant_type?: string; charge_keyword?: string;
  }>().catch(() => ({}));

  if (!body.first_name && !body.last_name && !body.state) {
    return c.json({ error: 'At least one of first_name, last_name, or state is required' }, 400);
  }

  const db = getDb(c.env);
  const queryDob = body.dob ?? null;

  const scrapedWhere: string[] = [];
  const scrapedParams: unknown[] = [];
  if (body.first_name) { scrapedWhere.push('first_name LIKE ?'); scrapedParams.push(`%${body.first_name}%`); }
  if (body.last_name) { scrapedWhere.push('last_name LIKE ?'); scrapedParams.push(`%${body.last_name}%`); }
  if (body.state) { scrapedWhere.push('UPPER(state) = ?'); scrapedParams.push(body.state.toUpperCase()); }
  if (body.offense_level) { scrapedWhere.push('UPPER(offense_level) = ?'); scrapedParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { scrapedWhere.push('UPPER(warrant_type) = ?'); scrapedParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { scrapedWhere.push('charge_description LIKE ?'); scrapedParams.push(`%${body.charge_keyword}%`); }

  const scrapedSql = `SELECT * FROM scraped_warrants${scrapedWhere.length ? ' WHERE ' + scrapedWhere.join(' AND ') : ''}`;
  const scrapedRows = await query<Record<string, unknown>>(db, scrapedSql, ...scrapedParams);

  const by_state: Record<string, ReturnType<typeof mapScrapedWarrantRow>[]> = {};
  for (const row of scrapedRows) {
    if (!matchesDobOrAge(queryDob, { dob: (row.date_of_birth as string) ?? null, age: (row.age as number) ?? null })) continue;
    const mapped = mapScrapedWarrantRow(row);
    const stateKey = ((row.state as string) ?? 'UNKNOWN').toUpperCase();
    if (!by_state[stateKey]) by_state[stateKey] = [];
    by_state[stateKey].push(mapped);
  }

  const localWhere: string[] = [];
  const localParams: unknown[] = [];
  if (body.first_name) { localWhere.push('subject_first_name LIKE ?'); localParams.push(`%${body.first_name}%`); }
  if (body.last_name) { localWhere.push('subject_last_name LIKE ?'); localParams.push(`%${body.last_name}%`); }
  if (body.offense_level) { localWhere.push('UPPER(offense_level) = ?'); localParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { localWhere.push("UPPER(COALESCE(warrant_type, type)) = ?"); localParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { localWhere.push('COALESCE(charge_description, offense_description, offense) LIKE ?'); localParams.push(`%${body.charge_keyword}%`); }

  const localSql = `SELECT * FROM warrants${localWhere.length ? ' WHERE ' + localWhere.join(' AND ') : ''}`;
  const localRows = await query<Record<string, unknown>>(db, localSql, ...localParams);

  const local = localRows
    .filter((row) => matchesDobOrAge(queryDob, { dob: (row.subject_dob as string) ?? null, age: null }))
    .map(mapLocalWarrantRow);

  const total = Object.values(by_state).reduce((a, arr) => a + arr.length, 0) + local.length;

  return c.json({
    total,
    search_time_ms: Date.now() - startedAt,
    by_state,
    local,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsNationalSearch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/warrants.ts test-workers/warrantsNationalSearch.test.ts
git commit -m "feat(warrants): add POST /national-search route with strict DOB/age matching"
```

---

### Task 4: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full node test suite**

Run: `npx vitest run`
Expected: all pass, including `tests/warrantNationalSearch.test.ts`

- [ ] **Step 3: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including both new `test-workers/warrantsNational*.test.ts` files

- [ ] **Step 4: Manual UI smoke check**

Run `npm run dev` (Worker) and `cd client && npm run dev` (Vite), open the National Warrant Search page (`/national-warrant-search`), confirm the coverage map renders without errors and a name+DOB search returns results (or an empty-but-not-erroring state if no scraped data exists locally).

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin feat/national-warrant-search
gh pr create --title "feat(warrants): build national warrant search backend (coverage + search)" --body "$(cat <<'EOF'
## Summary
- NationalWarrantSearchPage.tsx was a fully-built client page calling two
  endpoints that didn't exist on the Worker: GET /api/warrants/national-coverage
  and POST /api/warrants/national-search
- Coverage endpoint enumerates all 50 states + DC, computing per-state
  source/warrant counts from BOTH national_warrant_sources (config-driven)
  and the code-resident ADAPTERS registry
- Search endpoint applies strict DOB/age match confirmation: when a DOB is
  supplied, a candidate must match it exactly OR (for age-only records) fall
  within +/-1 year of the computed age — a record with neither DOB nor age
  is excluded rather than assumed to match. No DOB in the query falls back
  to name/state-only matching (existing client behavior)
- Every response row passes through ALL source columns (capture-all-data),
  not a curated subset
- Read-only: never touches status/cleared_at — clearing stays governed by
  the existing runScan.ts "never wrongly clear" invariant, untouched here
- Explicitly deferred: merging this page with WarrantsPage, fixing the
  separate (also-stubbed) POST /search-all endpoint, new scraper sources

## Test plan
- [x] npx vitest run tests/warrantNationalSearch.test.ts — 10/10 (state list, strict-match predicate boundary cases, row mappers)
- [x] npx vitest run --config vitest.workers.config.mts test-workers/warrantsNational*.test.ts — coverage + search route tests
- [x] npm run typecheck — clean
- [x] Full node + worker suites green
- [x] Manual UI smoke check in a browser

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
