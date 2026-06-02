# Warrant Puller — Phase 1 (Multi-Source Adapter Framework) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the single-source Utah warrant poller into a pluggable multi-source engine that writes the existing-but-dormant `scraped_warrants` table, and prove it with two new official county sources (Ada County ID, Natrona County WY) alongside the refactored Utah API source.

**Architecture:** Approach A — in-Worker `fetch`-based source adapters behind a registry. The cron iterates enabled sources × persons; each adapter returns raw hits; a generic store upserts `scraped_warrants`; a reconcile pass dedups + scores confidence + promotes confirmed hits + emits `warrant_watch_log` events. The adapter interface is designed to later swap its executor for Cloudflare Queues + Browser Rendering (Approach C) without changing adapters. LLM/Firecrawl extraction is a fallback transport only — never the source of truth.

**Tech Stack:** Cloudflare Workers, Hono, D1 (`src/utils/db.ts` → `query`/`queryFirst`/`execute`), TypeScript, vitest (root config `vitest.config.ts`, `tests/**/*.test.ts`, node env, tiny in-memory D1 double — see `tests/audit.test.ts`).

**Design doc:** `docs/plans/2026-06-02-warrant-puller-advancements-design.md`

**Branch:** `claude/warrant-puller-advancements-design` (off `origin/main`).

---

## Conventions for the executing engineer

- **D1 is async.** Always `await db.prepare(...).first()/.all()/.run()`. Use the `query`/`queryFirst`/`execute` wrappers in `src/utils/db.ts`.
- **Worker tests** live in `tests/` (root). Run a single file: `npx vitest run tests/warrantSources/<file>.test.ts`. Run all worker tests: `npm test`.
- **Pure functions first.** Parsers, charge-normalization, reconcile/confidence, and resilience math are pure (no I/O) → straightforward TDD. The D1-touching pieces (store, orchestrator) use the in-memory D1 double from `tests/audit.test.ts:32` (`makeFakeDb`).
- **Typecheck after each task:** `npm run typecheck` (worker). Must stay clean.
- **Commit after each task.** Conventional commits.
- The shared `scraped_warrants` columns (verified live):
  `id, source_key, full_name, first_name, last_name, middle_name, date_of_birth, age, gender, race, city, state, warrant_type, charge_description, court_name, case_number, bail_amount, offense_level, issue_date, status, warrant_id, person_id, photo_url, detail_url, scraped_at, first_seen_at, last_seen_at, cleared_at, dob_verified`.
- **Officer-safety invariant:** a hit is `confirmed` only when the linked person has a DOB and age corroborates; otherwise `unverified`. Confirmed-only is promoted to the canonical `warrants` table. (Mirrors the shipped Utah pipeline.)

---

## Task 0: Create the test-helper for the in-memory D1 double

The fake D1 in `tests/audit.test.ts` is file-local. Extract it so every warrant-sources test reuses it.

**Files:**
- Create: `tests/helpers/fakeD1.ts`

**Step 1:** Copy `makeFakeDb` (and its `CannedRow` type) verbatim from `tests/audit.test.ts:31-55` into `tests/helpers/fakeD1.ts`, exporting `makeFakeDb` and `CannedRow`. Add a second export `recordingDb()` that captures every `prepare(sql)` + `bind(...args)` into an array `calls: {sql, args}[]` and returns `{changes:1,last_row_id:1}` from `run()` — needed to assert upserts.

```ts
// tests/helpers/fakeD1.ts
export type CannedRow = Record<string, unknown>;

export function makeFakeDb(canned: { match: RegExp; rows: CannedRow[] }[]) {
  /* …verbatim from tests/audit.test.ts… */
}

/** Records every prepared statement + bound args for assertions. */
export function recordingDb(canned: { match: RegExp; rows: CannedRow[] }[] = []) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const resultsFor = (sql: string) => canned.find((c) => c.match.test(sql))?.rows ?? [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt: any = {
        bind: (...a: unknown[]) => { args = a; return stmt; },
        all: async () => ({ results: resultsFor(sql) }),
        first: async () => resultsFor(sql)[0] ?? null,
        run: async () => { calls.push({ sql, args }); return { meta: { changes: 1, last_row_id: calls.length } }; },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, calls };
}
```

**Step 2:** Refactor `tests/audit.test.ts` to import `makeFakeDb` from `../helpers/fakeD1` (delete the local copy). Run `npm test` → all existing tests still pass.

**Step 3:** Commit: `test(warrants): extract reusable in-memory D1 double to tests/helpers/fakeD1.ts`

---

## Task 1: Charge normalization + severity (pure, TDD)

**Files:**
- Create: `src/utils/warrantSources/chargeNormalize.ts`
- Test: `tests/warrantSources/chargeNormalize.test.ts`

**Step 1 — failing test:**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCharge } from '../../src/utils/warrantSources/chargeNormalize';

describe('normalizeCharge', () => {
  it('classifies an assault as a misdemeanor by default', () => {
    expect(normalizeCharge('ASSAULT').severity).toBe('misdemeanor');
  });
  it('flags felony keywords', () => {
    expect(normalizeCharge('FELONY DRUG POSSESSION').severity).toBe('felony');
    expect(normalizeCharge('AGGRAVATED ROBBERY').severity).toBe('felony');
  });
  it('flags DUI/influence', () => {
    expect(normalizeCharge('DRIVING UNDER THE INFLUENCE - 1ST').normalized).toMatch(/DUI/i);
  });
  it('returns infraction for traffic/equipment', () => {
    expect(normalizeCharge('TAIL LIGHT VIOLATION').severity).toBe('infraction');
  });
  it('handles a JSON-array charge string', () => {
    expect(normalizeCharge('["BATTERY"]').normalized).toBe('Battery');
  });
  it('degrades gracefully on empty', () => {
    expect(normalizeCharge('').severity).toBe('unknown');
  });
});
```

**Step 2:** Run `npx vitest run tests/warrantSources/chargeNormalize.test.ts` → FAIL (module not found).

**Step 3 — implement:** keyword tables → severity; title-case the human form; parse JSON-array input first (reuse the `chargesToText` idea from the poller). Signature:

```ts
export interface NormalizedCharge { raw: string; normalized: string; severity: 'felony' | 'misdemeanor' | 'infraction' | 'unknown'; }
export function normalizeCharge(raw: string | null | undefined): NormalizedCharge { /* … */ }
```

Felony keywords: `felony, aggravated, robbery, burglary, homicide, murder, rape, kidnap, weapon, firearm, trafficking, distribution`. Infraction: `tail light, speeding, equipment, registration, seatbelt, parking, infraction`. DUI synonyms → "DUI". Default → `misdemeanor` when text present, `unknown` when empty.

**Step 4:** Run the test → PASS. `npm run typecheck` → clean.

**Step 5:** Commit: `feat(warrants): charge normalization + severity classifier`

---

## Task 2: Adapter types + RawWarrantHit

**Files:**
- Create: `src/utils/warrantSources/types.ts`

No test (types only). Define:

```ts
import type { D1Database } from '@cloudflare/workers-types';

export interface PersonRow { id: number; first_name: string; middle_name: string | null; last_name: string; dob: string | null; }

/** Source-agnostic raw hit BEFORE persistence/normalization. */
export interface RawWarrantHit {
  source_key: string;
  warrant_id: string;          // source's stable id for the warrant
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  age?: number | null;
  city?: string | null;
  state?: string | null;
  charge_description?: string | null;  // raw; normalized later
  court_name?: string | null;
  case_number?: string | null;
  bail_amount?: number | null;
  issue_date?: string | null;
  warrant_type?: string | null;
  photo_url?: string | null;
  detail_url?: string | null;
}

export type SourceKind = 'api' | 'html' | 'browser' | 'portal';

export interface SourceMeta { key: string; display_name: string; state: string; county: string | null; source_url: string; kind: SourceKind; priority: 1 | 2 | 3 | 4; }

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  /** Query the source for ONE local person. Pure of persistence — returns raw hits or throws on transport error. Phase-2 browser/portal kinds may throw 'unsupported transport'. */
  fetchForPerson(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
```

Commit: `feat(warrants): source-adapter types (WarrantSourceAdapter, RawWarrantHit)`

---

## Task 3: Capture parser fixtures from the live pages

The parsers must be written against REAL markup. Capture once, commit as fixtures.

**Files:**
- Create: `tests/warrantSources/fixtures/ada-county.html`
- Create: `tests/warrantSources/fixtures/natrona.html`
- Create: `tests/warrantSources/fixtures/README.md` (source URL + capture date per file)

**Step 1:** Fetch a representative results page from each source and save the raw HTML:
- Ada County: `https://apps.adacounty.id.gov/sheriff/reports/warrants.aspx` (submit a common last name, e.g. `SMITH`, capture the results table HTML).
- Natrona County: `https://warrants.natronacounty-wy.gov/` (run a search, capture results).

Use `curl` with a browser User-Agent (mirror the poller's UA constant) or the Firecrawl skill. Save the exact bytes. **If a page is JS-rendered or CAPTCHA-gated, STOP and reclassify it as a Phase-2 `browser` source** — note it in the fixtures README and pick the next fetch-friendly source from the catalog (Aurora CO `court.auroragov.org/warrant`) instead.

**Step 2:** Commit: `test(warrants): capture Ada County + Natrona County warrant page fixtures`

---

## Task 4: Ada County parser (pure, fixture-driven TDD)

**Files:**
- Create: `src/utils/warrantSources/parse/adaCounty.ts`
- Test: `tests/warrantSources/adaCountyParse.test.ts`

**Step 1 — failing test:** load the fixture, assert the parser returns ≥1 `RawWarrantHit` with the fields the fixture visibly contains (name, warrant_id/number, issue_date, bond/bail, charge). Assert `source_key === 'ada-county-id'`. Assert it returns `[]` for an empty/no-results fixture string.

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseAdaCounty } from '../../src/utils/warrantSources/parse/adaCounty';

const html = readFileSync(new URL('./fixtures/ada-county.html', import.meta.url), 'utf8');

describe('parseAdaCounty', () => {
  it('extracts warrant rows with names + ids', () => {
    const hits = parseAdaCounty(html);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].warrant_id).toBeTruthy();
    expect(hits[0].last_name || hits[0].full_name).toBeTruthy();
    expect(hits[0].source_key).toBe('ada-county-id');
  });
  it('returns [] when no results', () => {
    expect(parseAdaCounty('<html><body>No records found</body></html>')).toEqual([]);
  });
});
```

**Step 2:** Run → FAIL.

**Step 3 — implement:** deterministic HTML parsing. Prefer a tiny dependency-free approach: regex/`DOMParser` is unavailable in Workers — use a lightweight HTML table scan (regex over `<tr>`/`<td>`), OR add `node-html-parser` (works in Workers, ~small) if the table is complex. Decide based on the fixture. Map columns → `RawWarrantHit`. Never throw on a malformed row — skip it. Set `source_key='ada-county-id'`, `state='ID'`, `city` from data if present.

> **If you add a parsing dep:** `npm i node-html-parser`, confirm it bundles under `wrangler deploy` (no Node built-ins). Justify in the commit.

**Step 4:** Run → PASS. `npm run typecheck` → clean.

**Step 5:** Commit: `feat(warrants): Ada County (ID) warrant HTML parser`

---

## Task 5: Natrona County parser (pure, fixture-driven TDD)

Same shape as Task 4 against `fixtures/natrona.html`. File: `src/utils/warrantSources/parse/natrona.ts`, test `tests/warrantSources/natronaParse.test.ts`, `source_key='natrona-county-wy'`, `state='WY'`.

Commit: `feat(warrants): Natrona County (WY) warrant HTML parser`

---

## Task 6: Resilience helpers (pure, TDD)

**Files:**
- Create: `src/utils/warrantSources/resilience.ts`
- Test: `tests/warrantSources/resilience.test.ts`

Pure helpers (no timers/I/O in the math):

```ts
/** ≥5 trailing failures → circuit open. trailing = errors counts newest-first. */
export function isCircuitOpen(trailingErrorCounts: number[]): boolean;
/** Conditional-GET request headers from stored config state. */
export function conditionalHeaders(cfg: { etag?: string|null; last_modified?: string|null }): Record<string,string>;
/** Was the response 304 (unchanged)? */
export function isUnchanged(status: number): boolean;
/** Deterministic-but-varied delay; seed from config jitter_seed + attempt index (NO Math.random — it's banned in some contexts; derive from seed). */
export function jitterDelayMs(baseMs: number, seed: number, attempt: number): number;
```

**Step 1–4:** TDD each: circuit opens at exactly 5 consecutive (`[1,1,1,1,1]`→true, `[1,1,0,1,1]`→false), `conditionalHeaders` emits `If-None-Match`/`If-Modified-Since` only when present, `isUnchanged(304)===true`, `jitterDelayMs` stays within `[baseMs, baseMs+2000)` and varies by attempt.

**Step 5:** Commit: `feat(warrants): per-source resilience helpers (circuit/conditional-GET/jitter)`

---

## Task 7: Reconcile — dedup + confidence (pure, TDD)

**Files:**
- Create: `src/utils/warrantSources/reconcile.ts`
- Test: `tests/warrantSources/reconcile.test.ts`

```ts
export interface CanonicalHit extends RawWarrantHit { person_id: number | null; confidence: 'confirmed' | 'unverified'; sources: string[]; }
/** Merge raw hits (possibly same warrant across sources) for ONE person into canonical hits. personHasDob drives confidence. dedupKey = warrant_id|case_number|name+court+issue_date fallback. */
export function reconcileHits(hits: RawWarrantHit[], person: PersonRow): CanonicalHit[];
```

**Step 1 — failing tests:**
- Two hits with the same `warrant_id` from different sources → ONE canonical hit with `sources.length === 2`.
- A DOB-less person → every canonical hit `confidence === 'unverified'`.
- A person WITH a dob whose age corroborates → `confidence === 'confirmed'`.
- Hits with no `warrant_id` dedup on `case_number`, else on `last_name+court_name+issue_date`.

**Step 2:** FAIL. **Step 3:** implement (reuse the age-tolerance logic ±1 from the Utah poller; factor it into a shared `ageFromDob`/`agesMatch` if convenient). **Step 4:** PASS + typecheck.

**Step 5:** Commit: `feat(warrants): cross-source dedup + confirmed/unverified reconcile`

---

## Task 8: Generic scraped_warrants store (fake-D1 TDD)

**Files:**
- Create: `src/utils/warrantSources/store.ts`
- Test: `tests/warrantSources/store.test.ts`

```ts
/** Upsert a hit into scraped_warrants. Idempotent on (source_key, warrant_id). Sets first_seen_at on insert, refreshes last_seen_at + mutable fields on conflict. */
export async function upsertScrapedWarrant(db: D1Database, hit: RawWarrantHit, personId: number | null): Promise<void>;
/** Clear rows of a source not seen since runStartedAt. MUST use datetime() on BOTH sides (the format-mismatch bug from the Utah poller). Returns count cleared. */
export async function markScrapedCleared(db: D1Database, sourceKey: string, runStartedAt: string): Promise<number>;
```

**Step 1 — failing tests** (use `recordingDb`):
- `upsertScrapedWarrant` issues an INSERT … ON CONFLICT containing `source_key` + `warrant_id` and binds the hit fields.
- `markScrapedCleared`'s SQL contains `datetime(last_seen_at) < datetime(?)` (assert via regex on the recorded `sql`) — this guards the exact format-comparison bug fixed in the Utah poller.

**Step 2:** FAIL. **Step 3:** implement (mirror `recordWarrant`/`markClearedWarrants` in `src/utils/utahWarrantPoller.ts`, but against `scraped_warrants` + a `source_key` scope). **Step 4:** PASS + typecheck.

**Step 5:** Commit: `feat(warrants): generic scraped_warrants upsert + datetime-normalized clear`

---

## Task 9: Utah API adapter (behavior-preserving refactor)

**Files:**
- Create: `src/utils/warrantSources/adapters/utahApi.ts`
- Modify: `src/utils/utahWarrantPoller.ts` (extract the fetch/`isLikelyMatch`/`fetchWarrantsForPerson` logic into the adapter; keep `runUtahWarrantScan` exported as a thin wrapper that delegates to the orchestrator for backward compat — `src/index.ts:236` and `src/routes/warrants.ts` import it).

**Step 1 — characterization test:** before refactoring, add `tests/warrantSources/utahApiAdapter.test.ts` that stubs `fetch` (vitest `vi.stubGlobal('fetch', …)`) to return a canned persons+warrants response and asserts the adapter yields a `RawWarrantHit` with `source_key='utah-warrant-watch'`, the warrant id, and that a DOB-mismatched candidate is rejected (namesake guard preserved).

**Step 2:** FAIL. **Step 3:** move logic into `utahApi.ts` implementing `WarrantSourceAdapter`; keep the UA constant, timeout, and `isLikelyMatch` semantics identical. **Step 4:** PASS + `npm run typecheck`.

**Step 5:** Commit: `refactor(warrants): Utah poller fetch logic → utahApi source adapter`

---

## Task 10: Ada + Natrona adapters (fetch + parse)

**Files:**
- Create: `src/utils/warrantSources/adapters/adaCounty.ts`, `.../natrona.ts`
- Test: extend the parser test files OR add `adapters.test.ts` stubbing `fetch` to return the captured fixture and asserting `fetchForPerson` returns parsed hits (and `[]` on 404/empty).

Each adapter: build the source's search request for `person` (last name, maybe first), `fetch` with the browser UA + timeout, pass the body to the matching `parse*` function, tag `source_key`. On non-OK status → throw (the orchestrator's per-source try/catch records the error → circuit math).

Commit: `feat(warrants): Ada County + Natrona County fetch adapters`

---

## Task 11: Source registry

**Files:**
- Create: `src/utils/warrantSources/registry.ts`

```ts
export const ADAPTERS: WarrantSourceAdapter[] = [utahApiAdapter, adaCountyAdapter, natronaAdapter];
/** Enabled = has a warrant_scraper_config row (or default-on for the 3 seeded). */
export async function getEnabledAdapters(db: D1Database): Promise<WarrantSourceAdapter[]>;
```

Test (fake-D1): `getEnabledAdapters` returns only adapters whose `source_name` appears in `warrant_scraper_config`. Commit: `feat(warrants): source adapter registry`

---

## Task 12: Orchestrator — runAllSourceScans

**Files:**
- Create: `src/utils/warrantSources/runScan.ts`
- Modify: `src/utils/utahWarrantPoller.ts` (`runUtahWarrantScan` now calls `runAllSourceScans`), `src/index.ts` (scheduled handler comment), `src/routes/warrants.ts` (the `/watch/scan` handler still works via the wrapper).

Orchestrator per run:
1. Open a `warrant_watch_runs` row (reuse existing helper).
2. `getEnabledAdapters(db)`; load the persons list (reuse the poller's filtered SELECT).
3. For each enabled source: skip if `isCircuitOpen`; for each person: `try { adapter.fetchForPerson } catch { errors++ }`; `upsertScrapedWarrant` each hit; `jitterDelayMs` between fetches. (Utah keeps writing `utah_warrants` via its adapter path OR via the unified store — keep Utah's dedicated table write to avoid regressing the shipped pipeline; scraped sources write `scraped_warrants`.)
4. After each source: `markScrapedCleared(db, sourceKey, runStartedAt)`.
5. Reconcile pass per person across BOTH `utah_warrants` + `scraped_warrants`; promote confirmed → canonical `warrants` (reuse `syncLocalWarrantRecord`); emit `warrant_watch_log` found/cleared (reuse `logWatchEvent`).
6. Close the run row + update `warrant_scraper_config` per source.

**Step 1 — smoke test** (`tests/warrantSources/runScan.smoke.test.ts`, fake-D1 + a fake in-memory adapter injected): assert one run inserts into `scraped_warrants`, writes a `warrant_watch_runs` completion, and does NOT double-count a warrant present in two sources. **Steps 2-4:** implement + PASS + typecheck. Keep per-source `try/catch` so one bad source can't abort the run.

**Step 5:** Commit: `feat(warrants): multi-source scan orchestrator (sources × persons + reconcile)`

---

## Task 13: Seed config + registry metadata (live D1 + migration)

**Files:**
- Create: `migrations/0067_seed_multi_source_scrapers.sql` (idempotent `INSERT … ON CONFLICT DO NOTHING` for `ada-county-id`, `natrona-county-wy` into `warrant_scraper_config`).
- Modify: `src/routes/warrants.ts` `SOURCE_REGISTRY` — add the two new entries (display_name, state, county, source_url, kind, priority).
- Apply to live D1 via `d1_database_query` MCP (per CLAUDE.md migrations-go-direct-to-live), AND keep the migration file for parity.

Test: none (data). Verify: `SELECT source_name FROM warrant_scraper_config` shows 3 rows. Commit: `feat(warrants): register Ada County + Natrona County scraper sources`

---

## Task 14: Wire the client — Multi-State UI + Scrapers tab

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx` (the `uniResults.scraped` Multi-State section already renders; confirm `/warrants/search-all` returns `scraped` from `scraped_warrants` — extend the rewrite `search-all` handler in `src/routes/warrants.ts` to query `scraped_warrants` for the `scraped` bucket).
- Modify: `src/routes/warrants.ts` `/scrapers` handler already synthesizes per-source rows from `warrant_scraper_config` — confirm the 2 new sources appear with health grades.

Test: client `npx tsc --noEmit` clean; manually confirm the Scrapers tab lists 3 sources. Commit: `feat(warrants): surface scraped_warrants in Search-All + Scrapers tab`

---

## Task 15: Final verification + SW bump

**Steps:**
1. `npm run typecheck` (worker) → clean.
2. `cd client && npx tsc --noEmit` → clean.
3. `npm test` (worker tests) → all pass.
4. `cd client && npx vitest run` → all pass.
5. Bump `client/public/sw.js` `CACHE_NAME` to the next version with a one-line note.
6. Commit: `chore(sw): bump cache for multi-source warrant puller (Phase 1)`.
7. Push; open PR to `main` summarizing Phase 1 + linking the design doc.

---

## Out of scope (Phase 2-3 — do NOT build now)

Browser Rendering / Firecrawl transport, CAPTCHA/portal sources (MCSO, iCourt, AZ DPS if gated), Cloudflare Queues executor, real-time BOLO/radio alerts, watch-list tiers/auto-enroll, dispatch-linked alerts, photo/biometric corroboration, daily digest. These are tracked in the design doc §3 and §9.

## Risks / notes

- **Live markup drift:** parsers are fixture-pinned; a site redesign breaks parsing → the per-source circuit breaker + health grade surface it on the Scrapers tab (no silent failure).
- **A page turns out JS/CAPTCHA-gated:** reclassify to Phase 2 `browser` (Task 3 stop-condition) and substitute Aurora CO.
- **Don't regress the Utah pipeline:** Utah keeps its dedicated `utah_warrants` table + the shipped confirmed-promotion/notification/retain-on-clear behavior. The orchestrator unifies at the reconcile step, not by moving Utah onto `scraped_warrants`.
- **No `Math.random()` in scan scheduling paths** that could run under resume-sensitive contexts — derive jitter from `jitter_seed` + attempt (Task 6).
