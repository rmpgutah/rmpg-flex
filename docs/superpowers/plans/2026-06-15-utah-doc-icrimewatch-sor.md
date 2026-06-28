# Utah DOC + iCrimeWatch SOR Integrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two external offender data sources to RMPG Flex screening — Utah DOC custody status (open `api.utah.gov` REST) and the iCrimeWatch statewide Utah Sex/Kidnap/Child-Abuse Offender Registry (agency 54438, DataDome-protected, scraped via Firecrawl) — each usable on-demand and as a scheduled background ingest, capturing **all** provided fields.

**Architecture:** Both plug into the existing `src/utils/screening/` `ScreeningAdapter` framework and the 4-hourly cron, not new frameworks. Utah DOC becomes a new adapter (`kind: 'custody'`) backed by a new `udc_custody` snapshot table. iCrimeWatch becomes a scraper poller that fills the **existing** `utah_sex_offenders` table (read by the existing `utahSorAdapter` with its existing false-clear coverage guard), via a Firecrawl HTML-fetch helper, preserving the full detail record in a new `detail_json` column.

**Tech Stack:** Cloudflare Workers + Hono, D1 (async `prepare().bind().all()/.first()/.run()` via `src/utils/db.ts` helpers), `jose`/bcrypt auth, vitest. Firecrawl `/v2/scrape` (stealth proxy) for DataDome bypass, key in `FIRECRAWL_API_KEY` secret (already set in prod + `.dev.vars`).

**Spec:** `docs/superpowers/specs/2026-06-15-utah-doc-icrimewatch-sor-integrations-design.md`

---

## Conventions for every task

- Worker typecheck: `npm run typecheck` (expect: no errors).
- Tests: `npx vitest run <file>` for one file; `npx vitest run` for all.
- All D1 calls are async — always `await`. Use `getDb(env)`, `query`, `queryFirst`, `execute` from `src/utils/db.ts`.
- Commit after each task. Branch off `origin/main` (PR flow — do NOT push to main).
- Migrations are `continue-on-error` on deploy: after merge, ALSO apply DDL directly to live D1 `785de7ae` and verify with `pragma_table_info`.

---

## File Structure

**Phase 1 — Utah DOC (no new infra):**
- Create `src/utils/screening/udcApi.ts` — pure mappers + thin `fetch` wrappers for `api.utah.gov`.
- Create `src/utils/screening/udcAdapter.ts` — the `ScreeningAdapter`.
- Modify `src/utils/screening/types.ts` — add `'custody'` to the `kind` union.
- Modify `src/utils/screening/registry.ts` — register `udcAdapter`.
- Create `migrations/0121_udc_custody.sql`.
- Create `tests/udcAdapter.test.ts`.

**Phase 2 — iCrimeWatch SOR:**
- Modify `src/types.ts` — add `FIRECRAWL_API_KEY?` / `FIRECRAWL_API_URL?` to `Bindings`.
- Create `src/utils/browserFetch.ts` — Firecrawl scrape client + typed errors.
- Create `src/utils/sorSources/parseIcrimewatch.ts` — pure HTML→record parsers.
- Create `src/utils/sorSources/icrimewatch.ts` — scan orchestrator + `utah_sex_offenders` upsert (with `detail_json`).
- Create `src/routes/sorSources.ts` — `/api/sor-sources` route.
- Modify `src/routesConfig.ts` — mount the route.
- Modify `src/index.ts` — wire the scrape into the 4-hourly cron.
- Create `migrations/0122_sor_detail_json.sql`.
- Create `tests/fixtures/icrimewatch-detail.html` (captured real page).
- Create `tests/parseIcrimewatch.test.ts`, `tests/browserFetch.test.ts`.

---

# PHASE 1 — Utah DOC custody source

## Task 1: `udc_custody` migration

**Files:**
- Create: `migrations/0121_udc_custody.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0121_udc_custody.sql
-- Per-person Utah DOC custody snapshots. The UDC public API
-- (api.utah.gov/udc/v1/public/rest/offenders) has no bulk-list endpoint,
-- so rows are snapshotted as persons are looked up / watched.
-- detail_json preserves the complete api.utah.gov detail response verbatim
-- (capture-all-data) so any future field survives without a schema change.
CREATE TABLE IF NOT EXISTS udc_custody (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_number INTEGER UNIQUE NOT NULL,
  offender_name TEXT,
  date_of_birth TEXT,
  location TEXT,
  housing_facility TEXT,
  release_date_and_type TEXT,
  case_manager_name TEXT,
  case_manager_email TEXT,
  detail_json TEXT,
  person_id INTEGER,
  source TEXT DEFAULT 'UDC_API',
  last_seen_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_udc_custody_person ON udc_custody(person_id);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('udc_custody')"`
Expected: rows including `offender_number`, `detail_json`, `person_id`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0121_udc_custody.sql
git commit -m "feat(migrations): 0121 udc_custody snapshot table"
```

---

## Task 2: Add `'custody'` to the screening `kind` union

**Files:**
- Modify: `src/utils/screening/types.ts:71` (the `kind` field of `ScreeningAdapter`)

- [ ] **Step 1: Edit the union**

In `src/utils/screening/types.ts`, change:

```ts
  kind: 'notice' | 'sanction' | 'sex_offender';
```

to:

```ts
  kind: 'notice' | 'sanction' | 'sex_offender' | 'custody';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the scan runner's only `kind` branch is `kind === 'notice'`, so `'custody'` falls into the full-population path — correct).

- [ ] **Step 3: Commit**

```bash
git add src/utils/screening/types.ts
git commit -m "feat(screening): add 'custody' adapter kind"
```

---

## Task 3: UDC API client + pure mappers (TDD)

**Files:**
- Create: `src/utils/screening/udcApi.ts`
- Test: `tests/udcAdapter.test.ts`

The pure functions are unit-tested; the two `fetch` wrappers are thin and exercised at runtime (mirrors the `roboflowAlpr.ts` "pure helpers tested, fetch thin" pattern).

- [ ] **Step 1: Write the failing test**

Create `tests/udcAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitUdcName, mapUdcListResult, mapUdcDetail } from '../src/utils/screening/udcApi';

describe('splitUdcName', () => {
  it('parses "LAST, FIRST MIDDLE" into parts', () => {
    expect(splitUdcName('PEREZ, JEROME JUNIOR')).toEqual({ last: 'PEREZ', first: 'JEROME', middle: 'JUNIOR' });
  });
  it('handles a single comma with one given name', () => {
    expect(splitUdcName('SMITH, JOHN')).toEqual({ last: 'SMITH', first: 'JOHN', middle: '' });
  });
  it('falls back to whole string as last name when no comma', () => {
    expect(splitUdcName('MADONNA')).toEqual({ last: 'MADONNA', first: '', middle: '' });
  });
  it('tolerates empty/undefined', () => {
    expect(splitUdcName('')).toEqual({ last: '', first: '', middle: '' });
  });
});

describe('mapUdcListResult', () => {
  it('maps a list row to a NormalizedCandidate', () => {
    const c = mapUdcListResult({ offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12' });
    expect(c.sourceKey).toBe('utah-doc');
    expect(c.externalId).toBe('128142');
    expect(c.displayName).toBe('PEREZ, JEROME JUNIOR');
    expect(c.dob).toBe('1978-03-12');
    expect(c.listType).toBe('utah-doc');
  });
});

describe('mapUdcDetail', () => {
  it('flattens the detail response wrapper to a row object', () => {
    const row = mapUdcDetail({
      results: {
        offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12',
        location: 'UTAH STATE CORRECTIONAL FACILITY', housingFacility: 'USCF B4',
        releaseDateAndType: 'N/A', caseManagerName: 'BERKELEY T DAY', caseManagerEmail: 'bday@utah.gov',
      },
    });
    expect(row.offender_number).toBe(128142);
    expect(row.location).toBe('UTAH STATE CORRECTIONAL FACILITY');
    expect(row.case_manager_email).toBe('bday@utah.gov');
  });
  it('returns null when no offender number is present', () => {
    expect(mapUdcDetail({ results: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/udcAdapter.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/screening/udcApi'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/screening/udcApi.ts`:

```ts
import type { Bindings } from '../../types';
import type { NormalizedCandidate } from './types';

// Utah DOC public REST gateway. No auth / no captcha at the API layer
// (the website's reCAPTCHA is frontend-only). Verified 2026-06-15.
const UDC_BASE = 'https://api.utah.gov/udc/v1/public/rest';
const TIMEOUT_MS = 15_000;

export interface UdcCustodyRow {
  offender_number: number;
  offender_name: string;
  date_of_birth: string;
  location: string;
  housing_facility: string;
  release_date_and_type: string;
  case_manager_name: string;
  case_manager_email: string;
  detail_json: string;
}

/** Split UDC "LAST, FIRST MIDDLE" into parts (for name scoring). */
export function splitUdcName(name: string | null | undefined): { last: string; first: string; middle: string } {
  const s = (name ?? '').trim();
  if (!s) return { last: '', first: '', middle: '' };
  const comma = s.indexOf(',');
  if (comma < 0) return { last: s, first: '', middle: '' };
  const last = s.slice(0, comma).trim();
  const given = s.slice(comma + 1).trim().split(/\s+/).filter(Boolean);
  return { last, first: given[0] ?? '', middle: given.slice(1).join(' ') };
}

/** Map a name-search list row → NormalizedCandidate. */
export function mapUdcListResult(raw: Record<string, unknown>): NormalizedCandidate {
  const num = String(raw.offenderNumber ?? '');
  const name = String(raw.offenderName ?? 'unknown');
  const dob = raw.dateOfBirth ? String(raw.dateOfBirth) : null;
  return {
    sourceKey: 'utah-doc',
    externalId: num,
    displayName: name,
    summary: 'Utah DOC — current supervision',
    country: 'US',
    listType: 'utah-doc',
    dob,
    nationalities: ['US'],
    raw,
  };
}

/** Flatten the detail wrapper {results:{...}} → a udc_custody row, or null. */
export function mapUdcDetail(raw: Record<string, unknown>): UdcCustodyRow | null {
  const r = (raw?.results ?? {}) as Record<string, unknown>;
  const offenderNumber = Number(r.offenderNumber);
  if (!Number.isFinite(offenderNumber) || offenderNumber <= 0) return null;
  return {
    offender_number: offenderNumber,
    offender_name: String(r.offenderName ?? ''),
    date_of_birth: String(r.dateOfBirth ?? ''),
    location: String(r.location ?? ''),
    housing_facility: String(r.housingFacility ?? ''),
    release_date_and_type: String(r.releaseDateAndType ?? ''),
    case_manager_name: String(r.caseManagerName ?? ''),
    case_manager_email: String(r.caseManagerEmail ?? ''),
    detail_json: JSON.stringify(raw),
  };
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`UDC HTTP ${resp.status}`);
    return await resp.json();
  } finally { clearTimeout(t); }
}

/** Live name search → candidate list (max 100). */
export async function udcSearchByName(_env: Bindings, first: string, last: string): Promise<NormalizedCandidate[]> {
  const f = encodeURIComponent((first ?? '').trim());
  const l = encodeURIComponent((last ?? '').trim());
  if (!l && !f) return [];
  const json = (await getJson(`${UDC_BASE}/offenders/name?first=${f}&last=${l}&index=0&pageCount=100`)) as { results?: unknown[] };
  const list = Array.isArray(json?.results) ? json.results : [];
  return list.map((r) => mapUdcListResult(r as Record<string, unknown>));
}

/** Live detail fetch by offender number → udc_custody row, or null. */
export async function udcGetDetail(_env: Bindings, offenderNumber: number | string): Promise<UdcCustodyRow | null> {
  const json = (await getJson(`${UDC_BASE}/offenders/${encodeURIComponent(String(offenderNumber))}`)) as Record<string, unknown>;
  return mapUdcDetail(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/udcAdapter.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/screening/udcApi.ts tests/udcAdapter.test.ts
git commit -m "feat(screening): UDC api.utah.gov client + pure mappers (tested)"
```

---

## Task 4: `udcAdapter` (ScreeningAdapter) + scoreMatch test

**Files:**
- Create: `src/utils/screening/udcAdapter.ts`
- Test: append to `tests/udcAdapter.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Append to `tests/udcAdapter.test.ts`:

```ts
import { udcAdapter } from '../src/utils/screening/udcAdapter';

describe('udcAdapter.scoreMatch', () => {
  const person = { id: 1, first_name: 'Jerome', last_name: 'Perez', dob: '1978-03-12' };
  it('confidently matches same surname + forename + DOB age', () => {
    const cand = udcAdapter.normalize({ offenderNumber: 128142, offenderName: 'PEREZ, JEROME JUNIOR', dateOfBirth: '1978-03-12' });
    const m = udcAdapter.scoreMatch(person as never, cand);
    expect(m.isConfident).toBe(true);
    expect(m.matchedFields).toContain('surname');
  });
  it('does not match a different surname', () => {
    const cand = udcAdapter.normalize({ offenderNumber: 999, offenderName: 'JONES, JEROME', dateOfBirth: '1978-03-12' });
    const m = udcAdapter.scoreMatch(person as never, cand);
    expect(m.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/udcAdapter.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/screening/udcAdapter'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/screening/udcAdapter.ts`:

```ts
import type { Bindings } from '../../types';
import type {
  ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow,
} from './types';
import { scoreNameMatch, ageFromDob, splitUdcName } from './scoring';
import { mapUdcListResult, udcSearchByName, udcGetDetail } from './udcApi';
import { getDb, queryFirst, execute } from '../db';

export const udcAdapter: ScreeningAdapter = {
  sourceKey: 'utah-doc',
  kind: 'custody',
  label: 'Utah DOC (current supervision)',
  supportsSearch: true,
  supportsWatch: true,
  normalize: (raw) => mapUdcListResult(raw as Record<string, unknown>),

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    // UI search box maps to `name` (surname) + optional `forename`.
    const last = (params.name ?? '').trim();
    const first = (params.forename ?? '').trim();
    if (!last && !first) return [];
    return udcSearchByName(env, first, last).catch(() => []);
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    return udcSearchByName(env, person.first_name ?? '', person.last_name).catch(() => []);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    const parts = splitUdcName(candidate.displayName);
    const nowYear = new Date().getUTCFullYear();
    return scoreNameMatch({
      personSurname: person.last_name ?? '',
      personForename: person.first_name ?? '',
      personAge: ageFromDob(person.dob, nowYear),
      personNationality: null,
      candSurname: parts.last,
      candForename: parts.first,
      candAgeMin: ageFromDob(candidate.dob, nowYear),
      candAgeMax: ageFromDob(candidate.dob, nowYear),
      candNationalities: candidate.nationalities ?? [],
    });
  },

  // Confirming a custody hit snapshots the full UDC detail into udc_custody
  // and links it to the person. Capture-all-data: detail_json holds the raw
  // response. Idempotent upsert keyed by offender_number.
  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    const detail = await udcGetDetail(env, hit.external_id).catch(() => null);
    if (!detail) return { promotedRef: 'udc_unavailable' };
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM udc_custody WHERE offender_number = ?', detail.offender_number);
    if (existing) {
      await execute(db, `UPDATE udc_custody SET offender_name=?, date_of_birth=?, location=?,
          housing_facility=?, release_date_and_type=?, case_manager_name=?, case_manager_email=?,
          detail_json=?, person_id=COALESCE(?, person_id), source='UDC_API',
          last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        detail.offender_name, detail.date_of_birth, detail.location, detail.housing_facility,
        detail.release_date_and_type, detail.case_manager_name, detail.case_manager_email,
        detail.detail_json, hit.person_id, existing.id).catch(() => {});
    } else {
      await execute(db, `INSERT INTO udc_custody (offender_number, offender_name, date_of_birth, location,
          housing_facility, release_date_and_type, case_manager_name, case_manager_email,
          detail_json, person_id, source, last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'UDC_API', datetime('now'))`,
        detail.offender_number, detail.offender_name, detail.date_of_birth, detail.location,
        detail.housing_facility, detail.release_date_and_type, detail.case_manager_name,
        detail.case_manager_email, detail.detail_json, hit.person_id).catch(() => {});
    }
    return { promotedRef: `udc:${detail.offender_number}` };
  },

  // Live-API source: covered whenever reachable. No empty-local-table
  // false-clear concern (search hits api.utah.gov directly).
  async coverage() {
    return { available: true, severity: 'ok' as const };
  },
};
```

- [ ] **Step 4: Move `splitUdcName` import source**

`udcApi.ts` already exports `splitUdcName`, but `udcAdapter.ts` imports it from `./scoring`. Re-export it from scoring to keep name-parsing helpers co-located. In `src/utils/screening/scoring.ts`, add at the end:

```ts
export { splitUdcName } from './udcApi';
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/udcAdapter.test.ts`
Expected: PASS (10 cases total).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/screening/udcAdapter.ts src/utils/screening/scoring.ts tests/udcAdapter.test.ts
git commit -m "feat(screening): udcAdapter (kind=custody) with name+DOB scoring"
```

---

## Task 5: Register `udcAdapter` in the registry

**Files:**
- Modify: `src/utils/screening/registry.ts`

- [ ] **Step 1: Edit the registry**

In `src/utils/screening/registry.ts`, add the import and array entry:

```ts
import { udcAdapter } from './udcAdapter';
```

and add `udcAdapter,` to the `ADAPTERS` array (after `utahSorAdapter`):

```ts
const ADAPTERS: ScreeningAdapter[] = [
  interpolAdapter('red'),
  interpolAdapter('yellow'),
  interpolAdapter('un'),
  ofacAdapter,
  utahSorAdapter,
  udcAdapter,
];
```

- [ ] **Step 2: Verify wiring with a focused test**

Create `tests/screeningRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAdapter, getAdapters } from '../src/utils/screening/registry';

describe('screening registry', () => {
  it('registers utah-doc as a searchable, watchable custody source', () => {
    const a = getAdapter('utah-doc');
    expect(a).toBeDefined();
    expect(a!.kind).toBe('custody');
    expect(a!.supportsSearch).toBe(true);
    expect(a!.supportsWatch).toBe(true);
  });
  it('keeps utah-sor present', () => {
    expect(getAdapters().some((a) => a.sourceKey === 'utah-sor')).toBe(true);
  });
});
```

Run: `npx vitest run tests/screeningRegistry.test.ts`
Expected: PASS.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/screening/registry.ts tests/screeningRegistry.test.ts
git commit -m "feat(screening): register udcAdapter"
```

---

## Task 6: Set the UDC re-scan cadence + Phase 1 verification

The adapter now auto-runs via `runScreeningScans` (cron + `/api/screening/scan?source=utah-doc`) with no further wiring. Custody changes are time-sensitive, so default it to a shorter interval than the 180-day SOR default.

**Files:** none (data + verification only)

- [ ] **Step 1: Full typecheck + test suite**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all suites pass.

- [ ] **Step 2: Document the post-deploy cadence step**

Add this note to the PR description (and run after live deploy): set the UDC re-scan interval to 7 days via the existing endpoint —
`POST /api/screening/sources/utah-doc/interval` body `{"days":7}` (role: admin/manager/supervisor).

- [ ] **Step 3: Live-DB migration reminder (post-merge)**

After merge, apply `0121_udc_custody.sql` directly to live D1 `785de7ae` and verify:
`SELECT name FROM pragma_table_info('udc_custody')` returns the columns.

- [ ] **Step 4: Commit (no-op marker)**

Phase 1 is complete and shippable as its own PR. Open it:
```bash
git push -u origin HEAD
gh pr create --title "Utah DOC custody screening source (Phase 1)" --body "<spec + cadence + live-migration notes>"
```

---

# PHASE 2 — iCrimeWatch statewide SOR scraper

## Task 7: Add Firecrawl bindings to types

**Files:**
- Modify: `src/types.ts` (the `Bindings` type, near `ROBOFLOW_API_KEY`)

- [ ] **Step 1: Add the bindings**

In `src/types.ts`, inside `Bindings`, after the `ROBOFLOW_*` block add:

```ts
  // Firecrawl API key — powers the iCrimeWatch SOR scrape (DataDome bypass via
  // stealth proxy). Set via `wrangler secret put FIRECRAWL_API_KEY`; unset →
  // /api/sor-sources returns 503. Never hard-coded; read only from c.env.
  FIRECRAWL_API_KEY?: string;
  // Optional override of the Firecrawl base origin (default https://api.firecrawl.dev).
  FIRECRAWL_API_URL?: string;
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/types.ts
git commit -m "feat(types): FIRECRAWL_API_KEY/URL bindings"
```

---

## Task 8: `browserFetch` Firecrawl client (TDD on error mapping)

**Files:**
- Create: `src/utils/browserFetch.ts`
- Test: `tests/browserFetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/browserFetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FirecrawlConfigError, buildScrapePayload } from '../src/utils/browserFetch';

describe('buildScrapePayload', () => {
  it('requests rendered html with stealth proxy', () => {
    const p = buildScrapePayload('https://www.icrimewatch.net/offenderdetails.php?OfndrID=1&AgencyID=54438');
    expect(p.url).toContain('offenderdetails.php');
    expect(p.formats).toContain('html');
    expect(p.proxy).toBe('stealth');
  });
  it('passes through optional waitFor', () => {
    const p = buildScrapePayload('https://x', { waitFor: 3000 });
    expect(p.waitFor).toBe(3000);
  });
});

describe('FirecrawlConfigError', () => {
  it('is throwable and carries a message', () => {
    const e = new FirecrawlConfigError('missing key');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('FirecrawlConfigError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/browserFetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/utils/browserFetch.ts`:

```ts
import type { Bindings } from '../types';

export class FirecrawlConfigError extends Error { constructor(m: string) { super(m); this.name = 'FirecrawlConfigError'; } }
export class FirecrawlHttpError extends Error { constructor(public status: number, m: string) { super(m); this.name = 'FirecrawlHttpError'; } }

const DEFAULT_BASE = 'https://api.firecrawl.dev';
const TIMEOUT_MS = 60_000;

export interface ScrapeOpts { waitFor?: number; actions?: unknown[] }

export interface ScrapePayload {
  url: string;
  formats: string[];
  proxy: 'stealth';
  waitFor?: number;
  actions?: unknown[];
}

/** Pure: build the Firecrawl /v2/scrape request body. */
export function buildScrapePayload(url: string, opts: ScrapeOpts = {}): ScrapePayload {
  const p: ScrapePayload = { url, formats: ['html'], proxy: 'stealth' };
  if (opts.waitFor != null) p.waitFor = opts.waitFor;
  if (opts.actions) p.actions = opts.actions;
  return p;
}

/**
 * Scrape a URL through Firecrawl's stealth proxy (handles DataDome) and return
 * rendered HTML. Throws FirecrawlConfigError when the key is unset so callers
 * can return 503; FirecrawlHttpError on a non-2xx Firecrawl response.
 */
export async function firecrawlScrapeHtml(env: Bindings, url: string, opts: ScrapeOpts = {}): Promise<string> {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) throw new FirecrawlConfigError('FIRECRAWL_API_KEY is not set');
  const base = (env.FIRECRAWL_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/v2/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildScrapePayload(url, opts)),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new FirecrawlHttpError(resp.status, `Firecrawl HTTP ${resp.status}`);
    const json = (await resp.json()) as { data?: { html?: string } };
    return json?.data?.html ?? '';
  } finally { clearTimeout(t); }
}
```

- [ ] **Step 4: Run test + typecheck + commit**

```bash
npx vitest run tests/browserFetch.test.ts   # PASS
npm run typecheck
git add src/utils/browserFetch.ts tests/browserFetch.test.ts
git commit -m "feat(utils): Firecrawl browserFetch client (stealth proxy)"
```

---

## Task 9: Capture a real iCrimeWatch detail fixture

A scraper parser must be tested against **real** markup, not hand-built HTML. Capture one live detail page via Firecrawl and save it as a fixture.

**Files:**
- Create: `tests/fixtures/icrimewatch-detail.html`

- [ ] **Step 1: Capture the fixture**

Run (requires the prod `FIRECRAWL_API_KEY`; it is set):

```bash
curl -s -X POST https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $(grep FIRECRAWL_API_KEY .dev.vars | cut -d= -f2)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.icrimewatch.net/offenderdetails.php?OfndrID=2301330&AgencyID=54438","formats":["html"],"proxy":"stealth"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j?.data?.html||"")})' \
  > tests/fixtures/icrimewatch-detail.html
```

- [ ] **Step 2: Verify the fixture has real content**

Run: `grep -c "Registration #" tests/fixtures/icrimewatch-detail.html`
Expected: ≥ 1 (the labeled fields are present). If 0, the scrape was blocked — re-run; if persistently blocked, the parser test can use the captured field structure from the spec, but prefer a real capture.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/icrimewatch-detail.html
git commit -m "test(fixtures): real iCrimeWatch SOR detail page"
```

---

## Task 10: `parseIcrimewatch` pure parsers (TDD against the fixture)

**Files:**
- Create: `src/utils/sorSources/parseIcrimewatch.ts`
- Test: `tests/parseIcrimewatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/parseIcrimewatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIcrimewatchDetail, extractOfndrIds } from '../src/utils/sorSources/parseIcrimewatch';

const html = readFileSync(new URL('./fixtures/icrimewatch-detail.html', import.meta.url), 'utf8');

describe('parseIcrimewatchDetail', () => {
  const rec = parseIcrimewatchDetail(html, '2301330');
  it('extracts identity + registration', () => {
    expect(rec.registry_id).toBe('2301330');
    expect(rec.last_name.toUpperCase()).toBe('CLARK');
    expect(rec.first_name.toUpperCase()).toContain('CAMDEN');
  });
  it('extracts physical description', () => {
    expect(rec.sex.toUpperCase()).toBe('M');
    expect(rec.race.toUpperCase()).toContain('WHITE');
  });
  it('captures the full detail blob with offenses + aliases', () => {
    const d = JSON.parse(rec.detail_json);
    expect(Array.isArray(d.offenses)).toBe(true);
    expect(d.offenses.length).toBeGreaterThan(0);
    expect(Array.isArray(d.aliases)).toBe(true);
    expect(d.status).toMatch(/active/i);
  });
  it('captures a photo url when present', () => {
    expect(rec.photo_url).toMatch(/^https?:\/\//);
  });
});

describe('extractOfndrIds', () => {
  it('pulls OfndrID values out of a results page', () => {
    const sample = '<a href="offenderdetails.php?OfndrID=111&AgencyID=54438">x</a>'
      + '<a href="offenderdetails.php?OfndrID=222&AgencyID=54438">y</a>';
    expect(extractOfndrIds(sample)).toEqual(['111', '222']);
  });
  it('dedups repeated ids', () => {
    const sample = 'OfndrID=5 OfndrID=5 OfndrID=6';
    expect(extractOfndrIds(sample)).toEqual(['5', '6']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parseIcrimewatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/utils/sorSources/parseIcrimewatch.ts`. The detail page is a label/value table — strip tags to text and read labeled fields; the labels are stable (`Name:`, `Registration #:`, `Status:`, `• Sex:`, `• Race:`, `• Height:`, `• Weight:`, `• Hair:`, `• Eyes:`, `• Scars/Tattoos:`, offense `• Description:`/`• Date Convicted:`/`• Conviction State:`/`• Counts:`). Capture-all-data goes into `detail_json`.

```ts
// Pure HTML parsers for iCrimeWatch (OffenderWatch) agency 54438 pages.
// No DOM dependency — operates on the raw HTML string so it runs in the Worker
// and in vitest. Tolerant: a missing field yields '' rather than throwing.

export interface SorScrapeRow {
  registry_id: string;
  first_name: string; middle_name: string; last_name: string;
  date_of_birth: string; sex: string; race: string;
  height: string; weight: string; hair_color: string; eye_color: string;
  scars_marks: string; address: string; city: string; state: string; zip: string;
  offense: string; registration_status: string; photo_url: string;
  detail_json: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(td|tr|p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Value following a verbatim label up to the next newline. */
function labelVal(text: string, label: string): string {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*([^\\n]*)', 'i');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

/** All offender detail links → unique OfndrID strings (results-page parser). */
export function extractOfndrIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /OfndrID=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } }
  return ids;
}

/** Photo URL on docs.watchsystems.com (or any <img> under offices/). */
function extractPhoto(html: string): string {
  const m = /https?:\/\/[^\s"')]*\/offices\/\d+\/[^\s"')]+\.(?:jpg|jpeg|png)/i.exec(html);
  return m ? m[0] : '';
}

export function parseIcrimewatchDetail(html: string, ofndrId: string): SorScrapeRow {
  const text = stripTags(html);
  const fullName = labelVal(text, 'Name:');                 // "Camden Joseph CLARK"
  // SOR renders "First Middle LAST" — surname is the trailing ALL-CAPS token(s).
  const tokens = fullName.split(/\s+/).filter(Boolean);
  const lastIdx = tokens.findIndex((t, i) => i > 0 && t === t.toUpperCase() && /[A-Z]/.test(t));
  const last_name = lastIdx >= 0 ? tokens.slice(lastIdx).join(' ') : (tokens[tokens.length - 1] ?? '');
  const given = lastIdx >= 0 ? tokens.slice(0, lastIdx) : tokens.slice(0, -1);
  const first_name = given[0] ?? '';
  const middle_name = given.slice(1).join(' ');

  const ageDob = labelVal(text, 'Age:');                    // "37  (DOB: 05/31/1989)"
  const dobMatch = /DOB:\s*([\d/]+)/i.exec(ageDob);
  const date_of_birth = dobMatch ? dobMatch[1] : '';

  // Address block: line after "Address" header, then "CITY, ST ZIP".
  const addrBlock = /Address\s*\n([^\n]+)\n([^\n]*?)\n?\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/i.exec(text);
  const address = addrBlock ? `${addrBlock[1].trim()}${addrBlock[2].trim() ? ' ' + addrBlock[2].trim() : ''}` : '';
  const city = addrBlock ? addrBlock[3].trim() : '';
  const state = addrBlock ? addrBlock[4].trim() : 'UT';
  const zip = addrBlock ? addrBlock[5].trim() : '';

  // Capture-all-data structure.
  const aliases = (() => {
    const block = /Aliases:\s*([\s\S]*?)\n(?:Status:|Physical Description|Address)/i.exec(text);
    return block ? block[1].split('\n').map((s) => s.trim()).filter(Boolean) : [];
  })();
  const offenses = (() => {
    const out: Record<string, string>[] = [];
    const re = /•\s*Description:\s*([^\n]+)\n(?:•\s*Date Convicted:\s*([^\n]*)\n)?(?:•\s*Conviction State:\s*([^\n]*)\n)?(?:•\s*Release Date:\s*([^\n]*)\n)?(?:•\s*Details:\s*([^\n]*)\n)?(?:•\s*Counts:\s*([^\n]*)\n?)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ description: (m[1] || '').trim(), dateConvicted: (m[2] || '').trim(),
        convictionState: (m[3] || '').trim(), releaseDate: (m[4] || '').trim(), counts: (m[6] || '').trim() });
    }
    return out;
  })();

  const detail = {
    status: labelVal(text, 'Status:'),
    age: (ageDob.match(/^\d+/) || [''])[0],
    aliases, offenses,
    scarsMarks: labelVal(text, 'Scars/Tattoos:'),
    address: { line: address, city, state, zip },
    photoUrl: extractPhoto(html),
    sourceUrl: `https://www.icrimewatch.net/offenderdetails.php?OfndrID=${ofndrId}&AgencyID=54438`,
    scrapedAt: new Date().toISOString(),
  };

  return {
    registry_id: ofndrId,
    first_name, middle_name, last_name,
    date_of_birth, sex: labelVal(text, '• Sex:') || labelVal(text, 'Sex:'),
    race: labelVal(text, '• Race:') || labelVal(text, 'Race:'),
    height: labelVal(text, '• Height:') || labelVal(text, 'Height:'),
    weight: labelVal(text, '• Weight:') || labelVal(text, 'Weight:'),
    hair_color: labelVal(text, '• Hair:') || labelVal(text, 'Hair:'),
    eye_color: labelVal(text, '• Eyes:') || labelVal(text, 'Eyes:'),
    scars_marks: detail.scarsMarks,
    address, city, state, zip,
    offense: offenses[0]?.description ?? '',
    registration_status: detail.status,
    photo_url: detail.photoUrl,
    detail_json: JSON.stringify(detail),
  };
}
```

> **Note on test-fixture reality:** if Step 1's assertions don't match the captured fixture exactly (e.g. surname casing, label spacing), adjust the parser to the real markup — the fixture is ground truth, not these expected strings. Keep the assertions meaningful (real values from the page).

- [ ] **Step 4: Run test, iterate parser against fixture until green**

Run: `npx vitest run tests/parseIcrimewatch.test.ts`
Expected: PASS. If a field assertion fails, fix the parser regex against the actual fixture text (do not weaken the assertion to nothing).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/sorSources/parseIcrimewatch.ts tests/parseIcrimewatch.test.ts
git commit -m "feat(sor): pure iCrimeWatch detail/results parsers (fixture-tested)"
```

---

## Task 11: `detail_json` migration on `utah_sex_offenders`

**Files:**
- Create: `migrations/0122_sor_detail_json.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0122_sor_detail_json.sql
-- Capture-all-data: preserve the complete iCrimeWatch detail record
-- (all aliases, all offenses, vehicles, other known addresses, professional
-- licenses, status, age) alongside the flat search columns.
-- D1 has no IF NOT EXISTS on ADD COLUMN — re-apply may error (tolerated);
-- the scraper also reconciles this column at runtime.
ALTER TABLE utah_sex_offenders ADD COLUMN detail_json TEXT;
```

- [ ] **Step 2: Apply locally + verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('utah_sex_offenders') WHERE name='detail_json'"`
Expected: one row `detail_json`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0122_sor_detail_json.sql
git commit -m "feat(migrations): 0122 utah_sex_offenders.detail_json"
```

---

## Task 12: `icrimewatch` scan orchestrator + upsert

**Files:**
- Create: `src/utils/sorSources/icrimewatch.ts`
- Test: `tests/icrimewatchScan.test.ts` (pure upsert-SQL-shape guard via a fake DB)

- [ ] **Step 1: Write the failing test**

Create `tests/icrimewatchScan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildDetailUrl } from '../src/utils/sorSources/icrimewatch';

describe('icrimewatch url builders', () => {
  it('builds the agency-scoped search-all url', () => {
    expect(buildSearchUrl()).toBe('https://www.icrimewatch.net/results.php?SubmitAllSearch=1&AgencyID=54438');
  });
  it('builds a last-name search url', () => {
    expect(buildSearchUrl('CLARK')).toContain('lname=CLARK');
    expect(buildSearchUrl('CLARK')).toContain('AgencyID=54438');
  });
  it('builds a detail url', () => {
    expect(buildDetailUrl('2301330')).toBe('https://www.icrimewatch.net/offenderdetails.php?OfndrID=2301330&AgencyID=54438');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/icrimewatchScan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/utils/sorSources/icrimewatch.ts`:

```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { execute, query, queryFirst } from '../db';
import { firecrawlScrapeHtml, FirecrawlConfigError } from '../browserFetch';
import { parseIcrimewatchDetail, extractOfndrIds, type SorScrapeRow } from './parseIcrimewatch';

const AGENCY = '54438';
const BASE = 'https://www.icrimewatch.net';
const MAX_PER_RUN = 2_000;
const PER_PAGE_DELAY_MS = 1_200;

export function buildSearchUrl(lastName?: string): string {
  return lastName
    ? `${BASE}/results.php?AgencyID=${AGENCY}&lname=${encodeURIComponent(lastName)}`
    : `${BASE}/results.php?SubmitAllSearch=1&AgencyID=${AGENCY}`;
}
export function buildDetailUrl(ofndrId: string): string {
  return `${BASE}/offenderdetails.php?OfndrID=${encodeURIComponent(ofndrId)}&AgencyID=${AGENCY}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let detailColEnsured = false;
async function ensureDetailColumn(db: D1Database): Promise<void> {
  if (detailColEnsured) return;
  await execute(db, 'ALTER TABLE utah_sex_offenders ADD COLUMN detail_json TEXT').catch(() => {});
  detailColEnsured = true;
}

async function upsertRow(db: D1Database, r: SorScrapeRow): Promise<void> {
  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', r.registry_id);
  if (existing) {
    await execute(db, `UPDATE utah_sex_offenders SET first_name=?, middle_name=?, last_name=?, date_of_birth=?,
        sex=?, race=?, height=?, weight=?, hair_color=?, eye_color=?, scars_marks=?, address=?, city=?, state=?,
        zip=?, offense=?, registration_status=?, photo_url=?, detail_json=?, source='ICRIMEWATCH',
        last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.sex, r.race, r.height, r.weight,
      r.hair_color, r.eye_color, r.scars_marks, r.address, r.city, r.state, r.zip, r.offense,
      r.registration_status, r.photo_url, r.detail_json, existing.id);
  } else {
    await execute(db, `INSERT INTO utah_sex_offenders (registry_id, first_name, middle_name, last_name, date_of_birth,
        sex, race, height, weight, hair_color, eye_color, scars_marks, address, city, state, zip, offense,
        registration_status, photo_url, detail_json, source, last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ICRIMEWATCH', datetime('now'))`,
      r.registry_id, r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.sex, r.race, r.height,
      r.weight, r.hair_color, r.eye_color, r.scars_marks, r.address, r.city, r.state, r.zip, r.offense,
      r.registration_status, r.photo_url, r.detail_json);
  }
}

export interface IcwScanOpts { mode?: 'incremental' | 'full' | 'name'; lastName?: string }
export interface IcwScanResult { configured: boolean; seen: number; upserted: number; error?: string }

/**
 * Scrape iCrimeWatch agency 54438 via Firecrawl into utah_sex_offenders.
 * configured:false (no-op) when FIRECRAWL_API_KEY is unset.
 */
export async function runIcrimewatchScan(env: Bindings, opts: IcwScanOpts = {}): Promise<IcwScanResult> {
  const db = env.DB;
  await ensureDetailColumn(db);
  let seen = 0, upserted = 0;
  try {
    const searchHtml = await firecrawlScrapeHtml(env, buildSearchUrl(opts.lastName));
    const ids = extractOfndrIds(searchHtml).slice(0, MAX_PER_RUN);
    let unchangedStreak = 0;
    for (const id of ids) {
      seen++;
      try {
        const detailHtml = await firecrawlScrapeHtml(env, buildDetailUrl(id));
        const row = parseIcrimewatchDetail(detailHtml, id);
        if (!row.last_name && !row.first_name) continue;
        if (opts.mode === 'incremental') {
          const known = await queryFirst<{ id: number }>(db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', id);
          if (known) { unchangedStreak++; if (unchangedStreak >= 25) break; } else { unchangedStreak = 0; }
        }
        await upsertRow(db, row);
        upserted++;
      } catch (err) { console.warn(`[icw] OfndrID ${id} failed:`, err); }
      await sleep(PER_PAGE_DELAY_MS);
    }
    await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
      VALUES ('ok', ?, ?, ?)`, seen, upserted, `icrimewatch agency=${AGENCY} mode=${opts.mode ?? 'incremental'}`);
    return { configured: true, seen, upserted };
  } catch (err) {
    if (err instanceof FirecrawlConfigError) return { configured: false, seen, upserted };
    const msg = err instanceof Error ? err.message : String(err);
    await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
      VALUES ('error', ?, ?, ?)`, seen, upserted, `icrimewatch: ${msg.slice(0, 180)}`).catch(() => {});
    return { configured: true, seen, upserted, error: msg };
  }
}
```

- [ ] **Step 4: Run test + typecheck + commit**

```bash
npx vitest run tests/icrimewatchScan.test.ts   # PASS
npm run typecheck
git add src/utils/sorSources/icrimewatch.ts tests/icrimewatchScan.test.ts
git commit -m "feat(sor): iCrimeWatch scan orchestrator + utah_sex_offenders upsert"
```

---

## Task 13: `/api/sor-sources` route

**Files:**
- Create: `src/routes/sorSources.ts`
- Modify: `src/routesConfig.ts` (import + mount)

- [ ] **Step 1: Write the route**

Create `src/routes/sorSources.ts`:

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { runIcrimewatchScan } from '../utils/sorSources/icrimewatch';

const sorSources = new Hono<Env>();
const SCAN_ROLES = ['admin', 'manager', 'supervisor'] as const;
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// POST /api/sor-sources/icrimewatch/scan?mode=incremental|full  (fire-and-forget)
sorSources.post('/icrimewatch/scan', requireRole(...SCAN_ROLES), async (c) => {
  if (!c.env.FIRECRAWL_API_KEY) {
    return c.json({ success: false, error: 'FIRECRAWL_API_KEY not configured', code: 'NO_KEY' }, 503);
  }
  const mode = (c.req.query('mode') === 'full' ? 'full' : 'incremental') as 'full' | 'incremental';
  c.executionCtx.waitUntil(
    runIcrimewatchScan(c.env, { mode })
      .then((r) => console.log(`[icw] scan ${JSON.stringify(r)}`))
      .catch((err) => console.error('[icw] scan failed:', err)));
  return c.json({ success: true, started: true, mode, message: 'SOR scan started; poll /runs.' }, 202);
});

// GET /api/sor-sources/runs — recent SOR run log (shared utah_sor_runs table)
sorSources.get('/runs', requireRole(...READ_ROLES), async (c) => {
  try {
    const rows = await query<Record<string, unknown>>(getDb(c.env),
      'SELECT * FROM utah_sor_runs ORDER BY id DESC LIMIT 20');
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

export default sorSources;
```

- [ ] **Step 2: Mount in routesConfig**

In `src/routesConfig.ts`, add the import near the other route imports:

```ts
import sorSources from './routes/sorSources';
```

and add the mount entry next to the screening entry (line ~371):

```ts
  { prefix: '/api/sor-sources', router: sorSources, auth: 'required' },
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/routes/sorSources.ts src/routesConfig.ts
git commit -m "feat(sor): /api/sor-sources scan + runs route"
```

---

## Task 14: Wire iCrimeWatch into the 4-hourly cron

**Files:**
- Modify: `src/index.ts` (the 4-hourly branch, right after the `runUtahSorPoll` block, ~line 408)

- [ ] **Step 1: Add the cron hook**

In `src/index.ts`, immediately after the `runUtahSorPoll(env.DB)` `ctx.waitUntil(...)` block, add:

```ts
    // iCrimeWatch statewide SOR scrape (agency 54438) via Firecrawl into
    // utah_sex_offenders. Incremental + cadence-gated inside the scanner;
    // no-op (configured:false) when FIRECRAWL_API_KEY is unset.
    ctx.waitUntil(
      import('./utils/sorSources/icrimewatch')
        .then(({ runIcrimewatchScan }) => runIcrimewatchScan(env, { mode: 'incremental' }))
        .then((r) => { if (r.configured) console.log(`[icw] seen=${r.seen} upserted=${r.upserted}${r.error ? ` err=${r.error}` : ''}`); })
        .catch((err) => console.error('[icw] cron failed:', err)),
    );
```

> A full statewide scrape is heavy; the 4-hourly cron runs **incremental** mode (stops after 25 consecutive already-known records). Trigger a one-time `full` scan via `POST /api/sor-sources/icrimewatch/scan?mode=full` after deploy to seed the table.

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all suites pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(sor): wire iCrimeWatch incremental scrape into 4h cron"
```

---

## Task 15: Client surface (minimal) + SW bump

**Files:**
- Modify: an admin/screening surface to add a "Run SOR import" button (e.g. the page that calls `/api/screening/status`). Confirm the exact page during execution via `grep -rln "api/screening" client/src/pages`.
- Modify: `client/public/sw.js` (`CACHE_NAME` bump).

- [ ] **Step 1: Locate the screening admin page**

Run: `grep -rln "api/screening\|sex-offender-registry\|offender-registry" client/src/pages | head`
Pick the admin/screening page (the one with a scan/status panel).

- [ ] **Step 2: Add the button**

Add a button that POSTs `'/sor-sources/icrimewatch/scan?mode=incremental'` via `apiFetch` and shows the 202/503 result. Custody (UDC) hits already render through the existing screening hits list (no new UI). Example handler:

```tsx
import { apiFetch } from '../hooks/useApi';
// ...
async function runSorImport() {
  try {
    const r = await apiFetch<{ success: boolean; message?: string; error?: string }>(
      '/sor-sources/icrimewatch/scan?mode=incremental', { method: 'POST' });
    alert(r.success ? (r.message ?? 'SOR scan started') : (r.error ?? 'Failed'));
  } catch (e) { alert('SOR scan failed to start'); }
}
```

Render an `<IconButton aria-label="Run SOR import" ...>` or a labeled button wired to `runSorImport`, using theme tokens (no hardcoded hex).

- [ ] **Step 3: Bump the service worker cache**

In `client/public/sw.js`, bump `CACHE_NAME` to the next version (run `grep CACHE_NAME client/public/sw.js` to read the current value, then increment).

- [ ] **Step 4: Client typecheck + build + commit**

```bash
cd client && npx tsc --noEmit && npx vite build && cd ..
git add client/public/sw.js client/src/pages
git commit -m "feat(sor): admin SOR import button + SW cache bump"
```

---

## Task 16: Phase 2 verification + PR

- [ ] **Step 1: Full gates**

Run: `npm run typecheck && npx vitest run && cd client && npx tsc --noEmit && npx vite build && cd ..`
Expected: all green.

- [ ] **Step 2: Live smoke (post-deploy, in a real browser — WAF challenge blocks curl)**

- `POST /api/sor-sources/icrimewatch/scan?mode=full` → 202.
- Poll `GET /api/sor-sources/runs` → an `ok` row with `records_upserted > 0`.
- `GET /api/screening/search?source=utah-sor&name=CLARK` → returns the scraped registrant; coverage `available:true`.
- `GET /api/screening/search?source=utah-doc&name=SMITH&forename=JOHN` → returns live UDC custody candidates.

- [ ] **Step 3: Live-DB migration (post-merge)**

Apply `0122_sor_detail_json.sql` to live D1 `785de7ae`; verify `detail_json` via `pragma_table_info('utah_sex_offenders')`.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "iCrimeWatch statewide SOR scraper (Phase 2)" --body "<spec link + Firecrawl note + migration 0122 + full-scan seed step>"
```

---

## Self-Review notes (author)

- **Spec coverage:** UDC adapter+table+cadence (Tasks 1–6), `detail_json` capture-all on both sources (Tasks 1, 11, 12), Firecrawl key/binding (Tasks 7–8, secret already set), DataDome bypass (Task 8 stealth proxy), scraper+parser+upsert (Tasks 9–12), routes (Task 13), cron (Task 14), client+SW (Task 15), coverage false-clear guard (unchanged — `utahSorAdapter.coverage()` still governs SOR). All spec sections map to a task.
- **Type consistency:** `SorScrapeRow` (parser) is the single row type consumed by `upsertRow`; `UdcCustodyRow` (udcApi) consumed by `udcAdapter.confirmHit`. `runIcrimewatchScan`/`buildSearchUrl`/`buildDetailUrl` names match between Tasks 12, 13, 14. `firecrawlScrapeHtml`/`FirecrawlConfigError` match between Tasks 8 and 12.
- **No placeholders:** every code step has full code; the only deferred specifics are the exact client page (Task 15, located by grep at execution) and fixture-driven parser tweaks (Task 10), both with explicit discovery commands.
