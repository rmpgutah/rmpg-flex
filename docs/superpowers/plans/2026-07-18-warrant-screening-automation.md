# Warrant Screening Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically screen a warrant's subject against all 7 screening sources (not just NSOPW) on warrant create/update, show a unified multi-source status panel on the warrant detail view, and link out to the existing ad-hoc screening search for follow-up queries.

**Architecture:** Extract the per-person match/score/upsert logic already inside `runScreeningScans.ts`'s batch loop into a shared, exported function. Build a new on-demand `screenPersonAllSources()` on top of it that runs all 7 adapters for one person immediately, independent of the watchlist/cadence system. Wire it into warrant create/update (fire-and-forget) and a new manual "screen now" route. Add a unified React panel to the one warrant-detail surface that actually has a `subject_person_id` to screen.

**Tech Stack:** Hono routes on Cloudflare Workers, D1 (`screening_hits`, `screening_source_state` — both pre-existing, no migration needed), React on the client.

## Global Constraints

- No schema changes — reuses `screening_hits`, `screening_source_state`, `screening_scan_runs` as-is.
- D1 `.prepare().bind().all()/.first()/.run()` calls must always be `await`ed.
- Fire-and-forget triggers (`c.executionCtx.waitUntil(...)`) must never fail the warrant write — always `.catch()`.
- **Scope correction from the design doc**: only `client/src/pages/warrants/WarrantsListTab.tsx`'s detail panel gets the new `WarrantScreeningStatus` component. The Utah-scraped-warrant modal in `WarrantsPage.tsx` has no `subject_person_id`-equivalent field on its `UtahWarrantResult` type (it's an external record with no local person link) — its `WarrantNsopwStatus` import is dead code today (never actually rendered in JSX) and stays untouched; do not add screening there.
- Testing convention for this codebase's Worker routes: prefer the lightweight `tests/helpers/fakeD1.ts` (`makeFakeDb`/`recordingDb`) + `vi.mock` of collaborator modules over Miniflare, matching `tests/warrantsSearchAll.test.ts`'s existing pattern.
- **Hono context quirk**: `c.executionCtx` throws `Error("This context has no ExecutionContext")` if the test harness's `app.request(path, init, env)` call omits a 4th `executionCtx` argument. Any test exercising a route that calls `c.executionCtx.waitUntil(...)` MUST pass a stub 4th argument: `{ waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} }`.
- Existing exported functions this plan reuses verbatim (do not re-derive different signatures): `shouldRunSource(state, cooldownHours?)` and its `SourceRunState` type from `src/utils/screening/runScreeningScans.ts`; `getAdapters()` from `src/utils/screening/registry.ts`; `PersonRow` type from `src/utils/screening/types.ts`.

---

### Task 1: Extract `scanPersonAgainstAdapter` from the batch loop

**Files:**
- Modify: `src/utils/screening/runScreeningScans.ts`
- Test: `tests/screeningScanPerson.test.ts`

**Interfaces:**
- Produces: `export async function scanPersonAgainstAdapter(env: Bindings, adapter: ScreeningAdapter, person: PersonRow, opts: { threshold: number }): Promise<{ checked: 1; newHits: number; errors: number }>` — pure per-person scan: fetch candidates, score, upsert `screening_hits`. No cadence/watchlist logic (that stays in `runOne`).
- Consumes (unchanged, already in this file): `getDb`, `query`, `queryFirst`, `execute` from `../db`; `ScreeningAdapter`, `PersonRow` types from `./types`.

- [ ] **Step 1: Write the failing test**

Create `tests/screeningScanPerson.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { scanPersonAgainstAdapter } from '../src/utils/screening/runScreeningScans';
import { makeFakeDb } from './helpers/fakeD1';
import type { ScreeningAdapter, PersonRow, NormalizedCandidate, MatchResult } from '../src/utils/screening/types';

function makeAdapter(overrides: Partial<ScreeningAdapter> = {}): ScreeningAdapter {
  return {
    sourceKey: 'test-source',
    kind: 'sanction',
    label: 'Test Source',
    supportsSearch: false,
    supportsWatch: true,
    searchAdHoc: vi.fn().mockResolvedValue([]),
    fetchForPerson: vi.fn().mockResolvedValue([]),
    scoreMatch: vi.fn().mockReturnValue({ score: 0, matchedFields: [], isConfident: false } as MatchResult),
    normalize: vi.fn(),
    confirmHit: vi.fn(),
    ...overrides,
  } as ScreeningAdapter;
}

const person: PersonRow = { id: 42, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1980-01-01' };

const candidate: NormalizedCandidate = {
  sourceKey: 'test-source',
  externalId: 'ext-1',
  displayName: 'John Smith',
  summary: 'Sanctioned entity',
  raw: { foo: 'bar' },
};

describe('scanPersonAgainstAdapter', () => {
  it('inserts a new screening_hits row when a candidate scores above threshold', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: ['name'], isConfident: true }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 1, errors: 0 });
  });

  it('skips a candidate scoring below threshold', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.5, matchedFields: [], isConfident: false }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('updates (not re-inserts) an existing hit and does not count it as new', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: ['name'], isConfident: true }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [{ id: 7, status: 'pending' }] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('skips candidates with no externalId', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([{ ...candidate, externalId: '' }]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: [], isConfident: true }),
    });
    const db = makeFakeDb([]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('isolates an adapter error into the errors count instead of throwing', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockRejectedValue(new Error('upstream down')),
    });
    const db = makeFakeDb([]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/screeningScanPerson.test.ts`
Expected: FAIL — `scanPersonAgainstAdapter` is not exported (does not exist yet).

- [ ] **Step 3: Extract the function**

In `src/utils/screening/runScreeningScans.ts`, add this new exported function directly above `async function runOne(...)`:

```typescript
export async function scanPersonAgainstAdapter(
  env: Bindings,
  adapter: ScreeningAdapter,
  person: PersonRow,
  opts: { threshold: number },
): Promise<{ checked: 1; newHits: number; errors: number }> {
  const db = getDb(env);
  let newHits = 0;
  let errors = 0;
  try {
    const candidates = await adapter.fetchForPerson(env, person);
    for (const cand of candidates) {
      if (!cand.externalId) continue;
      const m = adapter.scoreMatch(person, cand);
      if (m.score < opts.threshold) continue;
      const existing = await queryFirst<{ id: number; status: string }>(db,
        'SELECT id, status FROM screening_hits WHERE source_key=? AND person_id=? AND external_id=?',
        adapter.sourceKey, person.id, cand.externalId);
      if (existing) {
        await execute(db, "UPDATE screening_hits SET last_seen_at=datetime('now'), match_score=?, is_active=1 WHERE id=?", m.score, existing.id);
      } else {
        await execute(db, `INSERT INTO screening_hits
            (source_key, person_id, external_id, match_score, matched_fields, status,
             display_name, summary, photo_url, country, list_type, raw_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          adapter.sourceKey, person.id, cand.externalId, m.score, JSON.stringify(m.matchedFields), 'pending',
          cand.displayName, cand.summary, cand.photoUrl ?? null, cand.country ?? null, cand.listType ?? null, JSON.stringify(cand.raw));
        newHits++;
      }
    }
  } catch (err) {
    errors++;
    console.warn(`[screening] ${adapter.sourceKey} person ${person.id} error:`, err);
  }
  return { checked: 1, newHits, errors };
}
```

Then replace `runOne`'s existing per-person `for` loop body with a call to this new function, so behavior is identical but no longer duplicated. Find this exact block inside `runOne`:

```typescript
  for (const person of slice) {
    try {
      checked++;
      const candidates = await adapter.fetchForPerson(env, person);
      for (const cand of candidates) {
        if (!cand.externalId) continue;
        const m = adapter.scoreMatch(person, cand);
        if (m.score < threshold) continue;
        const existing = await queryFirst<{ id: number; status: string }>(db,
          'SELECT id, status FROM screening_hits WHERE source_key=? AND person_id=? AND external_id=?',
          adapter.sourceKey, person.id, cand.externalId);
        if (existing) {
          await execute(db, "UPDATE screening_hits SET last_seen_at=datetime('now'), match_score=?, is_active=1 WHERE id=?", m.score, existing.id);
        } else {
          await execute(db, `INSERT INTO screening_hits
              (source_key, person_id, external_id, match_score, matched_fields, status,
               display_name, summary, photo_url, country, list_type, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            adapter.sourceKey, person.id, cand.externalId, m.score, JSON.stringify(m.matchedFields), 'pending',
            cand.displayName, cand.summary, cand.photoUrl ?? null, cand.country ?? null, cand.listType ?? null, JSON.stringify(cand.raw));
          newHits++;
        }
      }
    } catch (err) { errors++; console.warn(`[screening] ${adapter.sourceKey} person ${person.id} error:`, err); }
  }
```

Replace it with:

```typescript
  for (const person of slice) {
    checked++;
    const result = await scanPersonAgainstAdapter(env, adapter, person, { threshold });
    newHits += result.newHits;
    errors += result.errors;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/screeningScanPerson.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run the existing orchestrator tests to confirm no regression**

Run: `npx vitest run tests/screeningOrchestrator.test.ts tests/screeningRegistry.test.ts tests/screeningScoring.test.ts tests/screeningConfirm.test.ts tests/screeningCoverage.test.ts`
Expected: PASS — same pass counts as before this change (this refactor must not alter `runOne`'s external behavior).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/screening/runScreeningScans.ts tests/screeningScanPerson.test.ts
git commit -m "refactor(screening): extract scanPersonAgainstAdapter for reuse by on-demand screening"
```

---

### Task 2: On-demand `screenPersonAllSources`

**Files:**
- Create: `src/utils/screening/screenPerson.ts`
- Test: `tests/screenPersonAllSources.test.ts`

**Interfaces:**
- Consumes: `scanPersonAgainstAdapter`, `shouldRunSource`, `SourceRunState` (Task 1, all exported from `./runScreeningScans`); `getAdapters` from `./registry`; `PersonRow` from `./types`; `getDb`, `queryFirst` from `../db`; `Bindings` from `../../types`.
- Produces: `export interface ScreenPersonOpts { triggeredBy?: string }`, `export interface ScreenPersonResult { sourcesRun: number; newHits: number; errors: number }`, `export async function screenPersonAllSources(env: Bindings, personId: number, opts?: ScreenPersonOpts): Promise<ScreenPersonResult>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/screenPersonAllSources.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as orchestrator from '../src/utils/screening/runScreeningScans';
import * as registry from '../src/utils/screening/registry';
import { screenPersonAllSources } from '../src/utils/screening/screenPerson';
import { makeFakeDb } from './helpers/fakeD1';
import type { ScreeningAdapter } from '../src/utils/screening/types';

function makeAdapter(sourceKey: string, overrides: Partial<ScreeningAdapter> = {}): ScreeningAdapter {
  return {
    sourceKey,
    kind: 'sanction',
    label: sourceKey,
    supportsSearch: false,
    supportsWatch: true,
    searchAdHoc: vi.fn(),
    fetchForPerson: vi.fn().mockResolvedValue([]),
    scoreMatch: vi.fn(),
    normalize: vi.fn(),
    confirmHit: vi.fn(),
    ...overrides,
  } as ScreeningAdapter;
}

describe('screenPersonAllSources', () => {
  it('returns zeroed result when the person does not exist', async () => {
    const db = makeFakeDb([{ match: /FROM persons WHERE id/, rows: [] }]);
    const result = await screenPersonAllSources({ DB: db } as any, 999);
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('runs every supportsWatch adapter for the person and sums results', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1980-01-01', citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('source-a'),
      makeAdapter('source-b'),
    ]);
    vi.spyOn(orchestrator, 'scanPersonAgainstAdapter')
      .mockResolvedValueOnce({ checked: 1, newHits: 2, errors: 0 })
      .mockResolvedValueOnce({ checked: 1, newHits: 1, errors: 1 });

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 1, circuit_broken: 0, hours_since_run: 100 }] },
      { match: /FROM system_config/, rows: [] },
    ]);

    const result = await screenPersonAllSources({ DB: db } as any, 1, { triggeredBy: 'test' });

    expect(result).toEqual({ sourcesRun: 2, newHits: 3, errors: 1 });
  });

  it('skips an adapter whose supportsWatch is false', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('search-only', { supportsWatch: false }),
    ]);
    const scanSpy = vi.spyOn(orchestrator, 'scanPersonAgainstAdapter');

    const db = makeFakeDb([{ match: /FROM persons WHERE id/, rows: [personRow] }]);
    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('skips a deliberately disabled source', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([makeAdapter('disabled-source')]);
    const scanSpy = vi.spyOn(orchestrator, 'scanPersonAgainstAdapter');

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 0, circuit_broken: 0, hours_since_run: 0 }] },
    ]);
    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('isolates a thrown error from one adapter without aborting the others', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('bad-source'),
      makeAdapter('good-source'),
    ]);
    vi.spyOn(orchestrator, 'scanPersonAgainstAdapter')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ checked: 1, newHits: 1, errors: 0 });

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 1, circuit_broken: 0, hours_since_run: 100 }] },
      { match: /FROM system_config/, rows: [] },
    ]);

    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(result).toEqual({ sourcesRun: 1, newHits: 1, errors: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/screenPersonAllSources.test.ts`
Expected: FAIL — `src/utils/screening/screenPerson.ts` does not exist yet.

- [ ] **Step 3: Write `src/utils/screening/screenPerson.ts`**

```typescript
// ============================================================
// RMPG Flex — On-demand all-sources person screening
// ============================================================
// screenPersonAllSources() runs every registered screening adapter
// against ONE person right now, independent of the watchlist/cadence
// system runScreeningScans() drives (that system only scans persons
// already on screening_watchlist/intel_watchlist, on a per-source
// interval). This is the "screen this person against everything,
// immediately" entry point that didn't exist before.
//
// Callers: POST /warrants (warrant create, fire-and-forget),
// PUT /warrants/:id (subject_person_id change, fire-and-forget),
// POST /api/screening/screen-person/:id (manual "Screen Now" button,
// awaited so the caller sees the result).
//
// Shares scanPersonAgainstAdapter() with the batch cron path (see
// src/utils/screening/runScreeningScans.ts) so both call sites
// score/upsert screening_hits identically — no duplicated logic.
// ============================================================

import type { Bindings } from '../../types';
import type { PersonRow } from './types';
import { getDb, queryFirst } from '../db';
import { getAdapters } from './registry';
import { scanPersonAgainstAdapter, shouldRunSource, type SourceRunState } from './runScreeningScans';

async function configThreshold(env: Bindings, sourceKey: string): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(getDb(env),
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1',
    `screening_${sourceKey.replace(/-/g, '_')}_min_score`).catch(() => null);
  const n = row ? parseInt(row.config_value, 10) : NaN;
  return (Number.isFinite(n) ? n : 80) / 100;
}

export interface ScreenPersonOpts { triggeredBy?: string }
export interface ScreenPersonResult { sourcesRun: number; newHits: number; errors: number }

export async function screenPersonAllSources(
  env: Bindings,
  personId: number,
  opts: ScreenPersonOpts = {},
): Promise<ScreenPersonResult> {
  const db = getDb(env);
  const person = await queryFirst<PersonRow>(
    db, 'SELECT id, first_name, middle_name, last_name, dob, citizenship FROM persons WHERE id = ?', personId,
  );
  if (!person) return { sourcesRun: 0, newHits: 0, errors: 0 };

  let sourcesRun = 0, newHits = 0, errors = 0;
  for (const adapter of getAdapters()) {
    if (!adapter.supportsWatch) continue;
    const state = await queryFirst<SourceRunState>(db,
      `SELECT enabled, circuit_broken,
              (julianday('now') - julianday(last_run_at)) * 24 AS hours_since_run
         FROM screening_source_state WHERE source_key = ?`, adapter.sourceKey).catch(() => null);
    if (!shouldRunSource(state)) continue; // disabled or cooling down — same gate runOne uses
    const threshold = await configThreshold(env, adapter.sourceKey);
    try {
      const result = await scanPersonAgainstAdapter(env, adapter, person, { threshold });
      sourcesRun++;
      newHits += result.newHits;
      errors += result.errors;
    } catch (err) {
      errors++;
      console.warn(`[screening] on-demand ${adapter.sourceKey} for person ${personId} (${opts.triggeredBy ?? 'unknown'}) failed:`, err);
    }
  }
  return { sourcesRun, newHits, errors };
}
```

- [ ] **Step 4: Export `SourceRunState` from `runScreeningScans.ts`** (needed by Step 3's import)

In `src/utils/screening/runScreeningScans.ts`, find:

```typescript
export interface SourceRunState {
```

Confirm it already has `export` (it does per the current file) — no change needed here. If it did not have `export`, add it. (This step exists to make the implementer verify, not to blindly edit.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/screenPersonAllSources.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/screening/screenPerson.ts tests/screenPersonAllSources.test.ts
git commit -m "feat(screening): add on-demand screenPersonAllSources for all 7 sources"
```

---

### Task 3: Warrant create/update trigger

**Files:**
- Modify: `src/routes/warrants.ts`
- Test: `tests/warrantsScreeningTrigger.test.ts`

**Interfaces:**
- Consumes: `screenPersonAllSources` from `../utils/screening/screenPerson` (Task 2).

- [ ] **Step 1: Write the failing tests**

Create `tests/warrantsScreeningTrigger.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import warrants from '../src/routes/warrants';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

const screenPersonAllSourcesMock = vi.fn().mockResolvedValue({ sourcesRun: 7, newHits: 0, errors: 0 });

vi.mock('../src/utils/screening/screenPerson', () => ({
  screenPersonAllSources: (...args: unknown[]) => screenPersonAllSourcesMock(...args),
}));

// c.executionCtx throws if the harness omits a real ExecutionContext —
// this stub lets waitUntil-based fire-and-forget routes run under test.
function stubExecutionCtx() {
  return {
    waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' } as any);
    await next();
  });
  app.route('/api/warrants', warrants);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db }, stubExecutionCtx());
}

function postJson(body: Record<string, unknown>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
function putJson(body: Record<string, unknown>): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Give queued microtasks (the waitUntil'd promise) a turn to run.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('warrant create/update screening trigger', () => {
  it('POST / fires screenPersonAllSources when subject_person_id is given', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT first_name, last_name FROM persons/, rows: [{ first_name: 'John', last_name: 'Smith' }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 1, subject_person_id: 42 }] },
    ]));

    const res = await request('/api/warrants/', postJson({
      type: 'arrest', charge_description: 'Theft', subject_person_id: 42,
    }));
    expect(res.status).toBe(201);
    await flush();

    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 42, expect.objectContaining({ triggeredBy: 'warrant_create' }),
    );
  });

  it('POST / does not fire screening when no subject_person_id is given', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 1, subject_person_id: null }] },
    ]));

    const res = await request('/api/warrants/', postJson({ type: 'arrest', charge_description: 'Theft' }));
    expect(res.status).toBe(201);
    await flush();

    expect(screenPersonAllSourcesMock).not.toHaveBeenCalled();
  });

  it('PUT /:id fires screening when subject_person_id changes', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT id, subject_person_id FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 99 }] },
    ]));

    const res = await request('/api/warrants/5', putJson({ subject_person_id: 99 }));
    expect(res.status).toBe(200);
    await flush();

    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 99, expect.objectContaining({ triggeredBy: 'warrant_update' }),
    );
  });

  it('PUT /:id does not fire screening when subject_person_id is unchanged', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT id, subject_person_id FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
    ]));

    const res = await request('/api/warrants/5', putJson({ status: 'served' }));
    expect(res.status).toBe(200);
    await flush();

    expect(screenPersonAllSourcesMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/warrantsScreeningTrigger.test.ts`
Expected: FAIL — trigger not wired yet, mock never called where the test expects it.

- [ ] **Step 3: Import `screenPersonAllSources` in `src/routes/warrants.ts`**

Find the existing import line:

```typescript
import { runUtahWarrantScan, runUtahWarrantCheckForPerson, fetchWarrantsForPerson, recordWarrant } from '../utils/utahWarrantPoller';
```

Add a new import line directly after it:

```typescript
import { screenPersonAllSources } from '../utils/screening/screenPerson';
```

- [ ] **Step 4: Wire the trigger into `POST /`**

Find this block in `warrants.post('/', ...)` (near the end of the handler):

```typescript
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM warrants WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
```

Replace it with:

```typescript
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM warrants WHERE id = ?', result.meta.last_row_id);

    // Auto-screen the warrant's subject against all 7 screening sources
    // (Interpol, OFAC, Utah SOR, NSOPW, UDC, etc.) — fire-and-forget so a
    // screening failure never blocks warrant creation.
    if (body.subject_person_id) {
      c.executionCtx.waitUntil(
        screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_create' })
          .catch((err) => console.error('[warrants] screening trigger failed:', err)),
      );
    }

    return c.json(created, 201);
```

- [ ] **Step 5: Wire the trigger into `PUT /:id`**

Find this block in `warrants.put('/:id', ...)`:

```typescript
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of ALLOWED_WARRANT_COLUMNS) {
      if (col in body) {
        sets.push(`${col} = ?`);
        params.push(body[col]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await execute(db, `UPDATE warrants SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
```

Replace it with:

```typescript
    const existing = await queryFirst<{ id: number; subject_person_id: number | null }>(
      db, 'SELECT id, subject_person_id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of ALLOWED_WARRANT_COLUMNS) {
      if (col in body) {
        sets.push(`${col} = ?`);
        params.push(body[col]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await execute(db, `UPDATE warrants SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);

    // Only re-screen when subject_person_id actually changed — an edit to
    // status/bail/notes/etc. must not trigger a fresh 7-source scan.
    if ('subject_person_id' in body && body.subject_person_id != null
        && Number(body.subject_person_id) !== existing.subject_person_id) {
      c.executionCtx.waitUntil(
        screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_update' })
          .catch((err) => console.error('[warrants] screening trigger failed:', err)),
      );
    }

    return c.json(updated);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/warrantsScreeningTrigger.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Run the full warrants test suite to confirm no regression**

Run: `npx vitest run tests/warrantsSearchAll.test.ts tests/warrantsScreeningTrigger.test.ts`
Expected: PASS — 9 total tests (5 + 4) green. Also run `npm run typecheck` — no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/warrants.ts tests/warrantsScreeningTrigger.test.ts
git commit -m "feat(warrants): auto-screen subject against all 7 sources on create/update"
```

---

### Task 4: Manual screen-person route

**Files:**
- Modify: `src/routes/screening.ts`
- Test: `tests/screeningScreenPersonRoute.test.ts`

**Interfaces:**
- Consumes: `screenPersonAllSources` from `../utils/screening/screenPerson` (Task 2); existing `requireRole`, `SCAN_ROLES` already in this file.
- Produces (HTTP contract): `POST /api/screening/screen-person/:id` (role: admin/manager/supervisor) → `200 { success: true, sourcesRun, newHits, errors }` on success, `400 { success: false, error: 'Invalid person id' }` on a non-numeric/non-positive id, `500 { success: false, error: 'screen failed' }` on an unexpected throw.

- [ ] **Step 1: Write the failing test**

Create `tests/screeningScreenPersonRoute.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import screening from '../src/routes/screening';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

const screenPersonAllSourcesMock = vi.fn();

vi.mock('../src/utils/screening/screenPerson', () => ({
  screenPersonAllSources: (...args: unknown[]) => screenPersonAllSourcesMock(...args),
}));

function buildApp(role: string) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 9, username: 'tester', role, full_name: 'Test User' } as any);
    await next();
  });
  app.route('/api/screening', screening);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: makeFakeDb([]) });
}

describe('POST /api/screening/screen-person/:id', () => {
  it('runs the on-demand scan and returns its summary', async () => {
    screenPersonAllSourcesMock.mockReset().mockResolvedValue({ sourcesRun: 7, newHits: 2, errors: 0 });
    const request = buildApp('admin');

    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, sourcesRun: 7, newHits: 2, errors: 0 });
    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 42, expect.objectContaining({ triggeredBy: 'manual:9' }),
    );
  });

  it('rejects a non-numeric id', async () => {
    const request = buildApp('admin');
    const res = await request('/api/screening/screen-person/not-a-number', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('rejects a role outside SCAN_ROLES', async () => {
    const request = buildApp('officer');
    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('returns 500 with a safe message when the scan throws', async () => {
    screenPersonAllSourcesMock.mockReset().mockRejectedValue(new Error('db exploded'));
    const request = buildApp('admin');
    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/screeningScreenPersonRoute.test.ts`
Expected: FAIL — route not mounted yet (404).

- [ ] **Step 3: Add the import to `src/routes/screening.ts`**

Find:

```typescript
import { confirmScreeningHit, dismissScreeningHit } from '../utils/screening/confirm';
```

Add directly after it:

```typescript
import { screenPersonAllSources } from '../utils/screening/screenPerson';
```

- [ ] **Step 4: Add the route**

Add this directly after the existing `GET /hits` route block (after its closing `});`, before the `POST /hits/:id/confirm` route):

```typescript
// POST /api/screening/screen-person/:id — manual "Screen Now" button.
// Runs every registered source for this person right now, independent of
// the watchlist/cadence system. Awaited (not fire-and-forget) since this
// is a user-initiated action expecting an immediate result.
screening.post('/screen-person/:id', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid person id' }, 400);
  const user = c.get('user') as { id?: number } | undefined;
  try {
    const result = await screenPersonAllSources(c.env, id, {
      triggeredBy: user?.id ? `manual:${user.id}` : 'manual',
    });
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error('[screening/screen-person]', err);
    return c.json({ success: false, error: 'screen failed' }, 500);
  }
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/screeningScreenPersonRoute.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/screening.ts tests/screeningScreenPersonRoute.test.ts
git commit -m "feat(screening): add POST /screen-person/:id manual all-sources scan"
```

---

### Task 5: Unified `WarrantScreeningStatus` panel

**Files:**
- Create: `client/src/components/WarrantScreeningStatus.tsx`
- Modify: `client/src/pages/warrants/WarrantsListTab.tsx`

**Interfaces:**
- Consumes: `apiFetch<T>(endpoint, options?)` from `../../hooks/useApi`; existing routes `GET /screening/sources`, `GET /screening/hits?person_id=`, `POST /screening/screen-person/:id` (Task 4).
- Produces: `<WarrantScreeningStatus personId={number} subjectSurname={string | undefined} />` — self-contained, no props flow back up.

- [ ] **Step 1: Write `client/src/components/WarrantScreeningStatus.tsx`**

```tsx
// ============================================================
// RMPG Flex — Unified multi-source screening status pane.
// ------------------------------------------------------------
// Embedded on WarrantsListTab's warrant-detail panel; shows hit
// status across ALL registered screening sources (Interpol,
// OFAC, Utah SOR, NSOPW, UDC, etc.) for the warrant's subject —
// not just NSOPW (see WarrantNsopwStatus, which this supersedes
// on the warrant-detail surface but is left in place for other
// consumers). Auto-screened in the background on warrant
// create/update (src/routes/warrants.ts); "Screen Now" re-runs
// on demand via POST /api/screening/screen-person/:id.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, Loader2, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';

interface ScreeningHit {
  id: number;
  source_key: string;
  match_score: number;
  status: 'pending' | 'confirmed' | 'dismissed';
  display_name: string | null;
}

interface ScreeningSource {
  sourceKey: string;
  label: string;
}

interface Props {
  personId: number;
  subjectSurname?: string;
}

export default function WarrantScreeningStatus({ personId, subjectSurname }: Props) {
  const [sources, setSources] = useState<ScreeningSource[] | null>(null);
  const [hits, setHits] = useState<ScreeningHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [screening, setScreening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [srcRes, hitsRes] = await Promise.all([
        apiFetch<{ data: ScreeningSource[] }>('/screening/sources'),
        apiFetch<{ data: ScreeningHit[] }>(`/screening/hits?person_id=${personId}`),
      ]);
      setSources(srcRes.data ?? []);
      setHits(hitsRes.data ?? []);
    } catch (err) {
      console.warn('[warrant-screening] load failed:', err);
      setSources([]);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  const screenNow = useCallback(async () => {
    setScreening(true);
    try {
      await apiFetch(`/screening/screen-person/${personId}`, { method: 'POST' });
      await load();
    } catch (err) {
      console.warn('[warrant-screening] screen-now failed:', err);
    } finally {
      setScreening(false);
    }
  }, [personId, load]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !sources) {
    return (
      <div className="panel-beveled p-4">
        <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[var(--brand-gold)]" /> Screening Status
        </h3>
        <div className="text-[11px] text-rmpg-300 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading screening status…
        </div>
      </div>
    );
  }

  const hitsBySource = new Map<string, ScreeningHit[]>();
  for (const h of hits ?? []) {
    const list = hitsBySource.get(h.source_key) ?? [];
    list.push(h);
    hitsBySource.set(h.source_key, list);
  }
  const totalActive = (hits ?? []).filter((h) => h.status !== 'dismissed').length;
  const HeaderIcon = totalActive > 0 ? ShieldAlert : ShieldCheck;
  const headerColor = totalActive > 0 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="panel-beveled p-4">
      <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
        <HeaderIcon className={`w-4 h-4 ${headerColor}`} /> Screening Status — All Sources
        <span className="ml-auto flex items-center gap-2">
          {subjectSurname && (
            <Link
              to={`/screening?surname=${encodeURIComponent(subjectSurname)}`}
              className="toolbar-btn text-[9px]"
              title="Search other sources for this subject"
            >
              <Search className="w-3 h-3" /> Search Other Sources
            </Link>
          )}
          <button type="button" onClick={() => void screenNow()} disabled={screening}
            className="toolbar-btn text-[9px]" title="Screen this subject against all sources now">
            {screening
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            Screen Now
          </button>
        </span>
      </h3>

      <div className="divide-y divide-rmpg-700/40">
        {(sources ?? []).map((s) => {
          const sourceHits = (hitsBySource.get(s.sourceKey) ?? []).filter((h) => h.status !== 'dismissed');
          return (
            <div key={s.sourceKey} className="flex items-center justify-between py-1.5 text-[11px]">
              <span className="text-rmpg-200">{s.label}</span>
              {sourceHits.length > 0
                ? <span className="text-red-400 font-bold">{sourceHits.length} hit{sourceHits.length === 1 ? '' : 's'}</span>
                : <span className="text-green-400">Clear</span>}
            </div>
          );
        })}
        {(sources ?? []).length === 0 && (
          <div className="text-[11px] text-rmpg-400 py-1.5">No screening sources registered.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `WarrantsListTab.tsx`**

Add the import near the other component imports:

```tsx
import WarrantScreeningStatus from '../../components/WarrantScreeningStatus';
```

Find this exact block (the current NSOPW-only panel):

```tsx
              {/* NSOPW Status — nationwide SOR cross-reference for the
                  warrant subject. Auto-fired when the warrant was created;
                  confirmed/possible hits flow through screening_hits and
                  surface here as the primary SOR retention pane. */}
              {selectedWarrant.subject_person_id && (
                <WarrantNsopwStatus personId={selectedWarrant.subject_person_id} />
              )}
```

Replace it with:

```tsx
              {/* Screening Status — unified cross-source (Interpol, OFAC,
                  Utah SOR, NSOPW, UDC, etc.) status for the warrant subject.
                  Auto-screened when the warrant's subject_person_id is set
                  or changed (src/routes/warrants.ts); "Screen Now" re-runs
                  on demand. Supersedes the NSOPW-only panel on this surface. */}
              {selectedWarrant.subject_person_id && (
                <WarrantScreeningStatus
                  personId={selectedWarrant.subject_person_id}
                  subjectSurname={selectedWarrant.subject_last_name ?? undefined}
                />
              )}
```

Note: verify `selectedWarrant.subject_last_name` is the correct field name against the `Warrant` interface at the top of `WarrantsPage.tsx` (it is, per that interface's `subject_last_name: string | null` field) before applying — do not guess a different field name.

The `WarrantNsopwStatus` import in this file (`import WarrantNsopwStatus from '../../components/WarrantNsopwStatus';`) becomes unused after this change — remove that import line. Do NOT delete `client/src/components/WarrantNsopwStatus.tsx` itself; it may still be used elsewhere (verify with `grep -rn "WarrantNsopwStatus" client/src --include="*.tsx"` before removing the import — if any other file still imports it, that's fine, this step only removes the import from `WarrantsListTab.tsx`).

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors, and no "unused import" issue (this repo has no lint gate on that per CLAUDE.md, but keep it clean anyway).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/WarrantScreeningStatus.tsx client/src/pages/warrants/WarrantsListTab.tsx
git commit -m "feat(warrants): add unified multi-source WarrantScreeningStatus panel"
```

---

### Task 6: `ScreeningPage` surname deep-link

**Files:**
- Modify: `client/src/pages/ScreeningPage.tsx`

**Interfaces:** None new — additive change to an existing `useEffect`.

- [ ] **Step 1: Add the `surname` param to the existing deep-link effect**

Find this exact block:

```tsx
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const screenId = searchParams.get('screen_id');
    const personId = searchParams.get('person_id');
    if (!screenId && !personId) return;
    deepLinkApplied.current = true;
    const next = new URLSearchParams(searchParams);
    if (screenId) { next.delete('screen_id'); setTab('review'); }
    if (personId) { next.delete('person_id'); setName(personId); }
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Replace it with:

```tsx
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const screenId = searchParams.get('screen_id');
    const personId = searchParams.get('person_id');
    const surname = searchParams.get('surname');
    if (!screenId && !personId && !surname) return;
    deepLinkApplied.current = true;
    const next = new URLSearchParams(searchParams);
    if (screenId) { next.delete('screen_id'); setTab('review'); }
    if (personId) { next.delete('person_id'); setName(personId); }
    if (surname) { next.delete('surname'); setName(surname); }
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(This is purely additive — the pre-existing `person_id` branch's behavior, including its known bug of setting `name` to the raw numeric ID, is untouched. `surname` is a new, separate, correctly-behaving param.)

- [ ] **Step 2: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd client && npm run dev`, navigate to `/screening?surname=Smith`, confirm the surname field pre-fills with "Smith" and the `?surname=` param is stripped from the URL after load.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ScreeningPage.tsx
git commit -m "feat(screening): add surname deep-link param for warrant-originated searches"
```

---

## Post-plan notes

- No migration to apply — this feature reuses existing tables.
- After merge, manually verify in the browser: open a warrant with a `subject_person_id`, confirm `WarrantScreeningStatus` renders in `WarrantsListTab.tsx`'s detail panel (not the Utah-scraped modal — that surface intentionally does not get this panel, see Global Constraints), click "Screen Now", and click "Search Other Sources" to confirm the `ScreeningPage` deep-link pre-fills correctly.
