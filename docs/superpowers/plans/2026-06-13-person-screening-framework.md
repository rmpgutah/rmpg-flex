# Person-Screening Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-source person-screening subsystem to RMPG Flex — on-demand search + a throttled background watch against INTERPOL Notices, OFAC/CSL sanctions, and the existing Utah Sex Offender Registry, with a human pending-review gate before any officer-safety alert fires.

**Architecture:** One pluggable `ScreeningAdapter` interface behind a unified `screening_hits` review queue. The Worker proxies/ingests each source, normalizes to a common candidate shape, scores matches with pure functions, and stores confident matches as `pending` hits. A `SCAN_ROLES` user confirms (source-aware promotion: INTERPOL Red → canonical `warrants`; OFAC/UN → person caution-flag; others → dossier surfacing) or dismisses. A 4-hourly cron orchestrator screens only watch-listed persons.

**Tech Stack:** Hono on Cloudflare Workers, D1 (via `src/utils/db.ts` helpers), KV for short-lived search cache, React 18 + Vite client, vitest (`tests/*.test.ts`, node env).

**Spec:** [`docs/superpowers/specs/2026-06-13-person-screening-framework-design.md`](../specs/2026-06-13-person-screening-framework-design.md)

---

## Confirmed codebase facts (verified during planning)

- DB helpers (`src/utils/db.ts`): `getDb(env)`, `query<T>(db,sql,...b)`, `queryFirst<T>(db,sql,...b)`, `execute(db,sql,...b)`, `columnExists(db,table,col)`, `executeBatch(db,stmts)`. All async.
- Route auth: routers add inline `requireRole(...roles)` from `src/middleware/auth.ts`. `c.get('user')` = `{ id, role, ... }`. Existing `warrants.ts` uses `READ_ROLES`/`SCAN_ROLES`.
- Route mounting: append a `{ prefix, router, auth }` entry to `ROUTE_REGISTRY` in `src/routesConfig.ts` (RMS section is alphabetical by prefix). `Env = { Bindings; Variables }`; `Bindings` has `DB`, `KV`, `MAP_DATA`, `WELFARE_WATCH`, `JWT_SECRET`.
- `warrants` table HAS: `warrant_number TEXT UNIQUE`, `external_warrant_id`, `external_source_key`, `subject_person_id`, `subject_first_name`, `subject_last_name`, `warrant_type`, `source`, `priority`, `issuing_agency`, `auto_created`, `charge_description`, `status`.
- Alert helper: `emitAlert(env, type, data)` in `src/utils/alertHub.ts`.
- Cron hook: `src/index.ts` `scheduled()` 4-hourly branch (`event.cron !== '* * * * *'`) already runs `runAllSourceScans(env.DB)` and `runUtahSorPoll(env.DB)` via `ctx.waitUntil(...)`. Add `runScreeningScans` there.
- `intel_watchlist` (mig 0099): `entity_type` ('person'|'vehicle'), `entity_id` INTEGER (= persons.id), `active`. Union source for watch.
- Utah SOR already exists: `utah_sex_offenders` table (mig 0096), `runUtahSorPoll`/`importSorRows` in `src/utils/utahSorPoller.ts`, kept fresh by the cron. The adapter only READS it.
- Client: pages lazy-loaded in `client/src/App.tsx` (`const X = lazyRetry(() => import('./pages/X'))` + `<Route .../>`); nav in `client/src/components/Sidebar.tsx` (`{ path, icon, label }`); window sizing in `client/src/utils/windowManager.ts`; SW `CACHE_NAME = 'rmpg-flex-v921'` in `client/public/sw.js`; admin keys in `client/src/pages/admin/AdminIntegrationsTab.tsx` (`LAW_ENFORCEMENT_KEYS` line 112, help-link map line 215).

## File Structure

**Worker (create):**
- `src/utils/screening/types.ts` — shared interfaces (`ScreeningAdapter`, `NormalizedCandidate`, `MatchResult`, `PersonRow`, `SearchParams`, `ScreeningHitRow`).
- `src/utils/screening/scoring.ts` — pure: `normalizeName`, `ageFromDob`, `scoreNameMatch`, `scoreSanctionMatch`.
- `src/utils/screening/interpolAdapter.ts` — INTERPOL adapter factory (red/yellow/un).
- `src/utils/screening/ofacAdapter.ts` — OFAC/CSL adapter (bulk ingest + local match + optional live).
- `src/utils/screening/utahSorAdapter.ts` — wraps `utah_sex_offenders`.
- `src/utils/screening/registry.ts` — `getAdapters()`.
- `src/utils/screening/runScreeningScans.ts` — cron orchestrator.
- `src/utils/screening/confirm.ts` — `confirmHit` / `dismissHit` dispatch.
- `src/routes/screening.ts` — Hono router `/api/screening/*`.
- `migrations/0106_screening.sql` — schema.

**Worker (modify):** `src/index.ts` (cron hook), `src/routesConfig.ts` (mount), `src/utils/intelDossier.ts` (timeline source).

**Tests (create):** `tests/screeningScoring.test.ts`, `tests/interpolNormalize.test.ts`, `tests/ofacNormalize.test.ts`, `tests/screeningConfirm.test.ts`.

**Client (create):** `client/src/pages/ScreeningPage.tsx`.
**Client (modify):** `client/src/App.tsx`, `client/src/components/Sidebar.tsx`, `client/src/utils/windowManager.ts`, `client/src/pages/admin/AdminIntegrationsTab.tsx`, `client/public/sw.js`.

---

## Phase 0 — Migration & scaffolding

### Task 1: Migration `0106_screening.sql`

**Files:** Create `migrations/0106_screening.sql`

- [ ] **Step 1: Write the migration** (idempotent; no ALTERs on capped tables)

```sql
-- 0106: Person-Screening framework — unified review queue + per-source caches.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
-- Spec: docs/superpowers/specs/2026-06-13-person-screening-framework-design.md

CREATE TABLE IF NOT EXISTS screening_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  person_id INTEGER,
  external_id TEXT NOT NULL,
  match_score REAL DEFAULT 0,
  matched_fields TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  display_name TEXT,
  summary TEXT,
  photo_url TEXT,
  country TEXT,
  list_type TEXT,
  raw_json TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  promoted_ref TEXT,
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_hits_uniq ON screening_hits(source_key, person_id, external_id);
CREATE INDEX IF NOT EXISTS idx_screening_hits_status ON screening_hits(status, is_active);
CREATE INDEX IF NOT EXISTS idx_screening_hits_person ON screening_hits(person_id);

CREATE TABLE IF NOT EXISTS screening_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  source_scope TEXT,
  reason TEXT,
  added_by INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_screening_watch_person ON screening_watchlist(person_id, active);

CREATE TABLE IF NOT EXISTS screening_source_state (
  source_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  circuit_broken INTEGER DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screening_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  persons_checked INTEGER DEFAULT 0,
  new_hits INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS interpol_notices (
  entity_id TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  forename TEXT, name TEXT,
  date_of_birth TEXT,
  nationalities TEXT,
  sex_id TEXT,
  charges TEXT,
  thumbnail_url TEXT,
  raw_json TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (notice_type, entity_id)
);

CREATE TABLE IF NOT EXISTS ofac_sanctions (
  uid TEXT PRIMARY KEY,
  source_list TEXT,
  entity_type TEXT,
  name TEXT,
  alt_names TEXT,
  programs TEXT,
  addresses TEXT,
  dob TEXT,
  nationalities TEXT,
  remarks TEXT,
  raw_json TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ofac_name ON ofac_sanctions(name);

CREATE TABLE IF NOT EXISTS ofac_ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  rows_loaded INTEGER DEFAULT 0,
  source_url TEXT,
  error TEXT
);

INSERT OR IGNORE INTO screening_source_state (source_key, enabled) VALUES
  ('interpol-red', 1), ('interpol-yellow', 1), ('interpol-un', 1),
  ('ofac-csl', 1), ('utah-sor', 1);
```

- [ ] **Step 2: Apply locally & verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'screening_%' OR name LIKE 'ofac_%' OR name='interpol_notices';"`
Expected: 7 tables listed (`screening_hits`, `screening_watchlist`, `screening_source_state`, `screening_scan_runs`, `interpol_notices`, `ofac_sanctions`, `ofac_ingest_runs`).

- [ ] **Step 3: Commit**

```bash
git add migrations/0106_screening.sql
git commit -m "feat(screening): migration 0106 — screening framework tables"
```

---

## Phase 1 — Framework core (types + pure scoring)

### Task 2: Shared types

**Files:** Create `src/utils/screening/types.ts`

- [ ] **Step 1: Write the file** (types only — no test; verified by typecheck)

```ts
import type { Bindings } from '../../types';

export interface PersonRow {
  id: number;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  dob?: string | null;            // 'YYYY-MM-DD'
  nationality?: string | null;
  citizenship?: string | null;
  sex?: string | null;
}

export interface SearchParams {
  source?: string;
  forename?: string;
  name?: string;
  nationality?: string;
  ageMin?: number;
  ageMax?: number;
  sexId?: string;
  page?: number;
}

export interface NormalizedCandidate {
  sourceKey: string;
  externalId: string;
  displayName: string;
  summary: string;
  photoUrl?: string;
  country?: string;
  listType?: string;
  dob?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  nationalities?: string[];
  raw: unknown;
}

export interface MatchResult {
  score: number;
  matchedFields: string[];
  isConfident: boolean;
}

export interface ScreeningHitRow {
  id: number;
  source_key: string;
  person_id: number | null;
  external_id: string;
  match_score: number;
  matched_fields: string | null;
  status: 'pending' | 'confirmed' | 'dismissed';
  display_name: string | null;
  summary: string | null;
  photo_url: string | null;
  country: string | null;
  list_type: string | null;
  raw_json: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  promoted_ref: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: number;
}

export interface ScreeningAdapter {
  sourceKey: string;
  kind: 'notice' | 'sanction' | 'sex_offender';
  label: string;
  supportsSearch: boolean;
  supportsWatch: boolean;
  searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]>;
  fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]>;
  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult;
  normalize(raw: unknown): NormalizedCandidate;
  confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/utils/screening/types.ts
git commit -m "feat(screening): shared adapter + candidate types"
```

### Task 3: Pure scoring functions (TDD)

**Files:** Create `src/utils/screening/scoring.ts`, `tests/screeningScoring.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/screeningScoring.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeName, ageFromDob, scoreNameMatch, scoreSanctionMatch } from '../src/utils/screening/scoring';

describe('normalizeName', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(normalizeName('  José-María  O\'Brien ')).toBe('jose maria o brien');
  });
  it('returns empty string for nullish', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('ageFromDob', () => {
  it('derives age from the birth year', () => {
    expect(ageFromDob('1985-04-12', 2026)).toBe(41);
  });
  it('returns null when dob missing or malformed', () => {
    expect(ageFromDob(null, 2026)).toBeNull();
    expect(ageFromDob('unknown', 2026)).toBeNull();
  });
});

describe('scoreNameMatch', () => {
  const base = {
    personSurname: 'Petrov', personForename: 'Ivan', personAge: 40, personNationality: 'RU',
    candSurname: 'Petrov', candForename: 'Ivan', candAgeMin: 39, candAgeMax: 41,
    candNationalities: ['RU'],
  };
  it('scores a full match as confident', () => {
    const r = scoreNameMatch(base, 0.8);
    expect(r.isConfident).toBe(true);
    expect(r.matchedFields).toEqual(expect.arrayContaining(['surname', 'forename', 'age', 'nationality']));
  });
  it('requires a surname match — different surname scores 0', () => {
    const r = scoreNameMatch({ ...base, candSurname: 'Ivanov' }, 0.8);
    expect(r.score).toBe(0);
    expect(r.isConfident).toBe(false);
  });
  it('forename initial alone is not enough to be confident', () => {
    const r = scoreNameMatch(
      { ...base, candForename: 'Igor', personAge: null, candAgeMin: null, candAgeMax: null, personNationality: null },
      0.8,
    );
    expect(r.matchedFields).toContain('forename-initial');
    expect(r.isConfident).toBe(false);
  });
  it('respects a configurable threshold', () => {
    const input = { ...base, candForename: 'Igor', personNationality: null }; // surname+initial+age = 0.6+0.1+0.15
    expect(scoreNameMatch(input, 0.9).isConfident).toBe(false);
    expect(scoreNameMatch(input, 0.8).isConfident).toBe(true);
  });
});

describe('scoreSanctionMatch', () => {
  it('confident when all person name tokens appear in the candidate name', () => {
    const r = scoreSanctionMatch('Petrov', 'Ivan', 'PETROV, Ivan Sergeyevich', 0.8);
    expect(r.isConfident).toBe(true);
    expect(r.matchedFields).toContain('surname');
  });
  it('not confident when surname token is absent', () => {
    const r = scoreSanctionMatch('Petrov', 'Ivan', 'Smith, John', 0.8);
    expect(r.isConfident).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/screeningScoring.test.ts`
Expected: FAIL — module `../src/utils/screening/scoring` not found.

- [ ] **Step 3: Implement `src/utils/screening/scoring.ts`**

```ts
import type { MatchResult } from './types';

export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ageFromDob(dob: string | null | undefined, nowYear: number): number | null {
  if (!dob) return null;
  const m = /(\d{4})/.exec(dob);
  if (!m) return null;
  const birthYear = parseInt(m[1], 10);
  if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > nowYear) return null;
  return nowYear - birthYear;
}

export interface NameScoreInput {
  personSurname: string; personForename: string;
  personAge: number | null; personNationality: string | null;
  candSurname: string; candForename: string;
  candAgeMin: number | null; candAgeMax: number | null;
  candNationalities: string[];
}

export function scoreNameMatch(input: NameScoreInput, threshold = 0.8): MatchResult {
  const matched: string[] = [];
  const ps = normalizeName(input.personSurname);
  const cs = normalizeName(input.candSurname);
  if (!ps || !cs || ps !== cs) return { score: 0, matchedFields: [], isConfident: false };
  matched.push('surname');
  let score = 0.6;
  const pf = normalizeName(input.personForename);
  const cf = normalizeName(input.candForename);
  if (pf && cf) {
    if (pf === cf) { score += 0.25; matched.push('forename'); }
    else if (pf[0] === cf[0]) { score += 0.1; matched.push('forename-initial'); }
  }
  if (input.personAge != null && (input.candAgeMin != null || input.candAgeMax != null)) {
    const lo = (input.candAgeMin ?? input.candAgeMax)! - 1;
    const hi = (input.candAgeMax ?? input.candAgeMin)! + 1;
    if (input.personAge >= lo && input.personAge <= hi) { score += 0.15; matched.push('age'); }
  }
  if (input.personNationality) {
    const pn = normalizeName(input.personNationality);
    if (pn && input.candNationalities.some((n) => { const x = normalizeName(n); return x === pn || x.includes(pn) || pn.includes(x); })) {
      score += 0.1; matched.push('nationality');
    }
  }
  score = Math.min(score, 1);
  return { score, matchedFields: matched, isConfident: score >= threshold };
}

// Sanctions/SO lists often store a single free-form name. Require every person
// name token to appear among the candidate's normalized tokens.
export function scoreSanctionMatch(personSurname: string, personForename: string, candName: string, threshold = 0.8): MatchResult {
  const surname = normalizeName(personSurname);
  const forename = normalizeName(personForename);
  const candTokens = new Set(normalizeName(candName).split(' ').filter(Boolean));
  if (!surname || !candTokens.has(surname)) return { score: 0, matchedFields: [], isConfident: false };
  const matched = ['surname'];
  let score = 0.7;
  if (forename && candTokens.has(forename)) { score += 0.3; matched.push('forename'); }
  score = Math.min(score, 1);
  return { score, matchedFields: matched, isConfident: score >= threshold };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/screeningScoring.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/screening/scoring.ts tests/screeningScoring.test.ts
git commit -m "feat(screening): pure name/age/sanction match scoring + tests"
```

---

## Phase 2 — Adapters

### Task 4: INTERPOL adapter normalize (TDD pure parse)

**Files:** Create `src/utils/screening/interpolAdapter.ts`, `tests/interpolNormalize.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/interpolNormalize.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeInterpolNotice } from '../src/utils/screening/interpolAdapter';

const RED = {
  entity_id: '2021/12345',
  forename: 'IVAN', name: 'PETROV',
  date_of_birth: '1985/04/12',
  nationalities: ['RU'], sex_id: 'M',
  _links: { thumbnail: { href: 'https://ws-public.interpol.int/.../thumbnail' } },
};

describe('normalizeInterpolNotice', () => {
  it('maps a HAL notice to a NormalizedCandidate', () => {
    const c = normalizeInterpolNotice(RED, 'red');
    expect(c.sourceKey).toBe('interpol-red');
    expect(c.externalId).toBe('2021/12345');
    expect(c.displayName).toBe('IVAN PETROV');
    expect(c.listType).toBe('red');
    expect(c.nationalities).toEqual(['RU']);
    expect(c.photoUrl).toContain('thumbnail');
    expect(c.dob).toBe('1985/04/12');
  });
  it('tolerates missing optional fields', () => {
    const c = normalizeInterpolNotice({ entity_id: 'x/1' }, 'yellow');
    expect(c.externalId).toBe('x/1');
    expect(c.sourceKey).toBe('interpol-yellow');
    expect(c.nationalities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/interpolNormalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/utils/screening/interpolAdapter.ts`**

```ts
import type { Bindings } from '../../types';
import type { ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow } from './types';
import { normalizeName, ageFromDob, scoreNameMatch } from './scoring';
import { getDb, queryFirst, execute } from '../db';
import { emitAlert } from '../alertHub';

const BASE = 'https://ws-public.interpol.int/notices/v1';
export type InterpolType = 'red' | 'yellow' | 'un';

interface RawNotice {
  entity_id?: string;
  forename?: string; name?: string;
  date_of_birth?: string;
  nationalities?: string[];
  sex_id?: string;
  _links?: { thumbnail?: { href?: string }; images?: { href?: string } };
}

export function normalizeInterpolNotice(raw: unknown, type: InterpolType): NormalizedCandidate {
  const n = (raw ?? {}) as RawNotice;
  const displayName = [n.forename, n.name].filter(Boolean).join(' ').trim() || (n.entity_id ?? 'unknown');
  const nats = Array.isArray(n.nationalities) ? n.nationalities : [];
  return {
    sourceKey: `interpol-${type}`,
    externalId: n.entity_id ?? '',
    displayName,
    summary: `INTERPOL ${type.toUpperCase()} Notice${nats.length ? ` · ${nats.join('/')}` : ''}`,
    photoUrl: n._links?.thumbnail?.href,
    country: nats[0],
    listType: type,
    dob: n.date_of_birth ?? null,
    nationalities: nats,
    raw,
  };
}

async function fetchNotices(type: InterpolType, qs: Record<string, string>): Promise<RawNotice[]> {
  const params = new URLSearchParams({ resultPerPage: '20', ...qs });
  const res = await fetch(`${BASE}/${type}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = (await res.json()) as { _embedded?: { notices?: RawNotice[] } };
  return body._embedded?.notices ?? [];
}

export function interpolAdapter(type: InterpolType): ScreeningAdapter {
  return {
    sourceKey: `interpol-${type}`,
    kind: 'notice',
    label: `INTERPOL ${type[0].toUpperCase()}${type.slice(1)} Notice`,
    supportsSearch: true,
    supportsWatch: true,

    normalize: (raw) => normalizeInterpolNotice(raw, type),

    async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
      const qs: Record<string, string> = {};
      if (params.name) qs.name = params.name;
      if (params.forename) qs.forename = params.forename;
      if (params.nationality) qs.nationality = params.nationality;
      if (params.ageMin != null) qs.ageMin = String(params.ageMin);
      if (params.ageMax != null) qs.ageMax = String(params.ageMax);
      if (params.sexId) qs.sexId = params.sexId;
      if (params.page != null) qs.page = String(params.page);
      // KV cache (1h) keyed by query
      const cacheKey = `interpol:${type}:${JSON.stringify(qs)}`;
      const cached = await env.KV.get(cacheKey, 'json').catch(() => null);
      if (cached) return cached as NormalizedCandidate[];
      const notices = await fetchNotices(type, qs);
      const out = notices.map((n) => normalizeInterpolNotice(n, type));
      await env.KV.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 }).catch(() => {});
      return out;
    },

    async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
      if (!person.last_name) return [];
      const qs: Record<string, string> = { name: person.last_name };
      if (person.first_name) qs.forename = person.first_name;
      const notices = await fetchNotices(type, qs);
      return notices.map((n) => normalizeInterpolNotice(n, type));
    },

    scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
      const raw = candidate.raw as RawNotice;
      const candAge = ageFromDob(candidate.dob, new Date().getUTCFullYear());
      return scoreNameMatch({
        personSurname: person.last_name ?? '',
        personForename: person.first_name ?? '',
        personAge: ageFromDob(person.dob, new Date().getUTCFullYear()),
        personNationality: person.nationality ?? person.citizenship ?? null,
        candSurname: raw?.name ?? '',
        candForename: raw?.forename ?? '',
        candAgeMin: candAge, candAgeMax: candAge,
        candNationalities: candidate.nationalities ?? [],
      });
    },

    async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
      const db = getDb(env);
      if (type !== 'red') return { promotedRef: 'noted' }; // yellow/un surface via dossier; un also flagged in confirm.ts
      const [first, ...rest] = (hit.display_name ?? '').split(' ');
      const last = rest.join(' ') || first;
      const warrantNumber = `INTERPOL-RED-${hit.external_id}`;
      const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber);
      if (!existing) {
        await execute(db,
          `INSERT INTO warrants
             (warrant_number, external_warrant_id, external_source_key, subject_person_id,
              subject_first_name, subject_last_name, warrant_type, source, priority,
              issuing_agency, auto_created, charge_description, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          warrantNumber, hit.external_id, 'interpol-red', hit.person_id,
          first ?? null, last ?? null, 'INTERPOL_RED', 'interpol', 'P2',
          'INTERPOL', 1, hit.summary ?? 'INTERPOL Red Notice', 'active',
        );
      }
      const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber);
      await emitAlert(env, 'screening:hit_confirmed', {
        source: 'interpol-red', personId: hit.person_id, name: hit.display_name, warrantId: row?.id,
      }).catch(() => {});
      return { promotedRef: `warrant:${row?.id ?? ''}` };
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/interpolNormalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/screening/interpolAdapter.ts tests/interpolNormalize.test.ts
git commit -m "feat(screening): INTERPOL adapter (red/yellow/un) + normalize tests"
```

### Task 5: OFAC/CSL adapter (TDD normalize; bulk ingest + local match + optional live)

**Files:** Create `src/utils/screening/ofacAdapter.ts`, `tests/ofacNormalize.test.ts`

> **Pre-step:** confirm the consolidated.json result field names against a live sample once: `curl -s 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json' | head -c 2000`. The fixture below reflects the documented shape (`{ results: [...] }` with `id, source, type, name, alt_names, programs, addresses, dates_of_birth, nationalities, remarks`). Adjust `normalizeOfacRow` field reads if the live sample differs.

- [ ] **Step 1: Write the failing test** — `tests/ofacNormalize.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeOfacRow } from '../src/utils/screening/ofacAdapter';

const ROW = {
  id: 'ofac-12345',
  source: 'Specially Designated Nationals (SDN) - Treasury Department',
  type: 'Individual',
  name: 'PETROV, Ivan Sergeyevich',
  alt_names: ['PETROW, Ivan'],
  programs: ['UKRAINE-EO13662'],
  addresses: [{ country: 'RU' }],
  dates_of_birth: ['1985'],
  nationalities: ['Russia'],
  remarks: 'DOB approximate',
};

describe('normalizeOfacRow', () => {
  it('maps a CSL result to a NormalizedCandidate', () => {
    const c = normalizeOfacRow(ROW);
    expect(c.sourceKey).toBe('ofac-csl');
    expect(c.externalId).toBe('ofac-12345');
    expect(c.displayName).toBe('PETROV, Ivan Sergeyevich');
    expect(c.listType).toContain('SDN');
    expect(c.summary).toContain('UKRAINE-EO13662');
    expect(c.country).toBe('RU');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ofacNormalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/utils/screening/ofacAdapter.ts`**

```ts
import type { Bindings } from '../../types';
import type { ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow } from './types';
import { normalizeName, scoreSanctionMatch } from './scoring';
import { getDb, query, queryFirst, execute, executeBatch } from '../db';

const BULK_URL = 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json';

interface CslResult {
  id?: string; source?: string; type?: string; name?: string;
  alt_names?: string[]; programs?: string[];
  addresses?: { country?: string }[];
  dates_of_birth?: string[]; nationalities?: string[]; remarks?: string;
}

export function normalizeOfacRow(raw: unknown): NormalizedCandidate {
  const r = (raw ?? {}) as CslResult;
  const programs = Array.isArray(r.programs) ? r.programs : [];
  const nats = Array.isArray(r.nationalities) ? r.nationalities : [];
  const country = r.addresses?.[0]?.country ?? nats[0];
  const listType = (r.source ?? '').includes('SDN') ? 'SDN' : (r.source ?? 'CSL');
  return {
    sourceKey: 'ofac-csl',
    externalId: r.id ?? '',
    displayName: r.name ?? 'unknown',
    summary: `OFAC ${listType}${programs.length ? ` · ${programs.join(', ')}` : ''}`,
    country,
    listType,
    dob: r.dates_of_birth?.[0] ?? null,
    nationalities: nats,
    raw,
  };
}

// Row stored in ofac_sanctions → candidate (for local search/match results).
function rowToCandidate(row: Record<string, unknown>): NormalizedCandidate {
  const programs = JSON.parse((row.programs as string) || '[]');
  return {
    sourceKey: 'ofac-csl',
    externalId: String(row.uid ?? ''),
    displayName: String(row.name ?? 'unknown'),
    summary: `OFAC ${row.source_list ?? 'CSL'}${programs.length ? ` · ${programs.join(', ')}` : ''}`,
    country: (JSON.parse((row.nationalities as string) || '[]'))[0],
    listType: String(row.source_list ?? 'CSL'),
    dob: (row.dob as string) ?? null,
    nationalities: JSON.parse((row.nationalities as string) || '[]'),
    raw: row.raw_json ? JSON.parse(row.raw_json as string) : row,
  };
}

export async function ingestOfac(env: Bindings): Promise<{ rowsLoaded: number }> {
  const db = getDb(env);
  const startRun = await execute(db, 'INSERT INTO ofac_ingest_runs (source_url) VALUES (?)', BULK_URL);
  const runId = startRun.meta.last_row_id;
  try {
    const res = await fetch(BULK_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`bulk fetch ${res.status}`);
    const body = (await res.json()) as { results?: CslResult[] };
    const results = body.results ?? [];
    // Replace the dataset in chunks (INSERT OR REPLACE keyed by uid).
    const CHUNK = 100;
    for (let i = 0; i < results.length; i += CHUNK) {
      const slice = results.slice(i, i + CHUNK);
      await executeBatch(db, slice.map((r) => ({
        sql: `INSERT OR REPLACE INTO ofac_sanctions
                (uid, source_list, entity_type, name, alt_names, programs, addresses, dob, nationalities, remarks, raw_json, ingested_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
        bindings: [
          r.id ?? '', (r.source ?? '').includes('SDN') ? 'SDN' : (r.source ?? 'CSL'), r.type ?? '',
          r.name ?? '', JSON.stringify(r.alt_names ?? []), JSON.stringify(r.programs ?? []),
          JSON.stringify(r.addresses ?? []), r.dates_of_birth?.[0] ?? null,
          JSON.stringify(r.nationalities ?? []), r.remarks ?? '', JSON.stringify(r),
        ],
      })));
    }
    await execute(db, "UPDATE ofac_ingest_runs SET finished_at = datetime('now'), rows_loaded = ? WHERE id = ?", results.length, runId);
    await execute(db, "UPDATE screening_source_state SET items_count = ?, last_success_at = datetime('now') WHERE source_key = 'ofac-csl'", results.length);
    return { rowsLoaded: results.length };
  } catch (err) {
    await execute(db, "UPDATE ofac_ingest_runs SET finished_at = datetime('now'), error = ? WHERE id = ?", String(err), runId);
    throw err;
  }
}

export async function ofacDataAgeHours(env: Bindings): Promise<number | null> {
  const row = await queryFirst<{ h: number }>(getDb(env),
    "SELECT (julianday('now') - julianday(MAX(ingested_at))) * 24 AS h FROM ofac_sanctions");
  return row?.h ?? null;
}

export const ofacAdapter: ScreeningAdapter = {
  sourceKey: 'ofac-csl',
  kind: 'sanction',
  label: 'OFAC / Consolidated Screening List',
  supportsSearch: true,
  supportsWatch: true,
  normalize: normalizeOfacRow,

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    const db = getDb(env);
    const term = `%${(params.name ?? '').trim()}%`;
    const rows = await query<Record<string, unknown>>(db,
      "SELECT * FROM ofac_sanctions WHERE name LIKE ? ESCAPE '\\' LIMIT 50", term).catch(() => []);
    const local = rows.map(rowToCandidate);
    // Optional live CSL fuzzy search when a key is configured.
    const key = await queryFirst<{ config_value: string }>(db,
      "SELECT config_value FROM system_config WHERE config_key='screening_ofac_csl_api_key' AND is_active=1").catch(() => null);
    if (key?.config_value && params.name) {
      // VERIFY exact endpoint/auth header against developer.trade.gov during impl.
      const u = `https://data.trade.gov/consolidated_screening_list/v1/search?name=${encodeURIComponent(params.name)}&fuzzy_name=true`;
      const res = await fetch(u, { headers: { 'subscription-key': key.config_value, Accept: 'application/json' } }).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { results?: unknown[] };
        return (body.results ?? []).map(normalizeOfacRow);
      }
    }
    return local;
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    const db = getDb(env);
    const rows = await query<Record<string, unknown>>(db,
      "SELECT * FROM ofac_sanctions WHERE name LIKE ? ESCAPE '\\' LIMIT 50", `%${person.last_name}%`).catch(() => []);
    return rows.map(rowToCandidate);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    return scoreSanctionMatch(person.last_name ?? '', person.first_name ?? '', candidate.displayName);
  },

  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    if (hit.person_id) {
      const p = await queryFirst<{ caution_flags: string | null }>(db, 'SELECT caution_flags FROM persons WHERE id = ?', hit.person_id).catch(() => null);
      const flag = `OFAC SANCTIONS: ${hit.list_type ?? 'CSL'} (${hit.external_id})`;
      const existing = p?.caution_flags ?? '';
      if (!existing.includes('OFAC SANCTIONS')) {
        await execute(db, 'UPDATE persons SET caution_flags = ? WHERE id = ?', [existing, flag].filter(Boolean).join('; '), hit.person_id).catch(() => {});
      }
    }
    return { promotedRef: 'caution_flag' };
  },
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ofacNormalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/screening/ofacAdapter.ts tests/ofacNormalize.test.ts
git commit -m "feat(screening): OFAC/CSL adapter — bulk ingest + local match + optional live"
```

### Task 6: Utah SOR adapter (wraps existing data)

**Files:** Create `src/utils/screening/utahSorAdapter.ts`

- [ ] **Step 1: Get the exact columns**

Run: `sed -n '1,60p' migrations/0096_utah_sex_offenders.sql`
Note the actual column names (expected roughly: `offender_id`/`sor_number`, `first_name`, `last_name`, `dob`, `address`, `city`, `offense`). Use the real names in Step 2's SQL + `rowToCandidate`.

- [ ] **Step 2: Implement `src/utils/screening/utahSorAdapter.ts`** (replace `<col>` placeholders with the verified column names from Step 1)

```ts
import type { Bindings } from '../../types';
import type { ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow } from './types';
import { scoreSanctionMatch } from './scoring';
import { getDb, query, execute } from '../db';

function rowToCandidate(row: Record<string, unknown>): NormalizedCandidate {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return {
    sourceKey: 'utah-sor',
    externalId: String(row.sor_number ?? row.offender_id ?? row.id ?? ''),
    displayName: name || 'unknown',
    summary: `Utah Sex Offender Registry${row.city ? ` · ${row.city}` : ''}`,
    country: 'US',
    listType: 'utah-sor',
    dob: (row.dob as string) ?? null,
    nationalities: ['US'],
    raw: row,
  };
}

export const utahSorAdapter: ScreeningAdapter = {
  sourceKey: 'utah-sor',
  kind: 'sex_offender',
  label: 'Utah Sex Offender Registry',
  supportsSearch: true,
  supportsWatch: true,
  normalize: rowToCandidate,

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    const rows = await query<Record<string, unknown>>(getDb(env),
      "SELECT * FROM utah_sex_offenders WHERE last_name LIKE ? ESCAPE '\\' LIMIT 50", `%${(params.name ?? '').trim()}%`).catch(() => []);
    return rows.map(rowToCandidate);
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    const rows = await query<Record<string, unknown>>(getDb(env),
      "SELECT * FROM utah_sex_offenders WHERE last_name LIKE ? ESCAPE '\\' LIMIT 50", `%${person.last_name}%`).catch(() => []);
    return rows.map(rowToCandidate);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    return scoreSanctionMatch(person.last_name ?? '', person.first_name ?? '', candidate.displayName);
  },

  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    if (hit.person_id) {
      await execute(db, 'UPDATE persons SET is_sex_offender = 1, sor_number = COALESCE(NULLIF(sor_number, \'\'), ?) WHERE id = ?', hit.external_id, hit.person_id).catch(() => {});
    }
    return { promotedRef: 'sor_flag' };
  },
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/screening/utahSorAdapter.ts
git commit -m "feat(screening): Utah SOR adapter wrapping existing utah_sex_offenders"
```

### Task 7: Registry

**Files:** Create `src/utils/screening/registry.ts`

- [ ] **Step 1: Implement**

```ts
import type { ScreeningAdapter } from './types';
import { interpolAdapter } from './interpolAdapter';
import { ofacAdapter } from './ofacAdapter';
import { utahSorAdapter } from './utahSorAdapter';

const ADAPTERS: ScreeningAdapter[] = [
  interpolAdapter('red'),
  interpolAdapter('yellow'),
  interpolAdapter('un'),
  ofacAdapter,
  utahSorAdapter,
];

export function getAdapters(): ScreeningAdapter[] { return ADAPTERS; }
export function getAdapter(sourceKey: string): ScreeningAdapter | undefined {
  return ADAPTERS.find((a) => a.sourceKey === sourceKey);
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npm run typecheck` → PASS
```bash
git add src/utils/screening/registry.ts
git commit -m "feat(screening): adapter registry"
```

---

## Phase 3 — Orchestrator + confirm/dismiss

### Task 8: Cron orchestrator + index hook

**Files:** Create `src/utils/screening/runScreeningScans.ts`; Modify `src/index.ts`

- [ ] **Step 1: Implement `src/utils/screening/runScreeningScans.ts`**

```ts
import type { Bindings } from '../../types';
import type { PersonRow, ScreeningAdapter } from './types';
import { getDb, query, queryFirst, execute } from '../db';
import { getAdapters } from './registry';
import { ofacDataAgeHours, ingestOfac } from './ofacAdapter';

const DEFAULT_MAX = 10;

async function watchPopulation(env: Bindings, sourceKey: string): Promise<PersonRow[]> {
  const db = getDb(env);
  // Union: intel_watchlist persons + dedicated screening_watchlist (all-source or this source).
  const rows = await query<PersonRow>(db, `
    SELECT p.id, p.first_name, p.middle_name, p.last_name, p.dob, p.nationality, p.citizenship
      FROM persons p
     WHERE p.id IN (
        SELECT entity_id FROM intel_watchlist WHERE entity_type='person' AND active=1
        UNION
        SELECT person_id FROM screening_watchlist WHERE active=1 AND (source_scope IS NULL OR source_scope = ?)
     )
     ORDER BY p.id LIMIT 500`, sourceKey).catch(() => []);
  return rows;
}

async function configInt(env: Bindings, key: string, fallback: number): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(getDb(env),
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1', key).catch(() => null);
  const n = row ? parseInt(row.config_value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function runOne(env: Bindings, adapter: ScreeningAdapter): Promise<void> {
  const db = getDb(env);
  const state = await queryFirst<{ enabled: number; circuit_broken: number }>(db,
    'SELECT enabled, circuit_broken FROM screening_source_state WHERE source_key = ?', adapter.sourceKey).catch(() => null);
  if (state && (state.enabled === 0 || state.circuit_broken === 1)) return;
  if (!adapter.supportsWatch) return;

  const run = await execute(db, 'INSERT INTO screening_scan_runs (source_key) VALUES (?)', adapter.sourceKey);
  const runId = run.meta.last_row_id;
  let checked = 0, newHits = 0, errors = 0;
  const threshold = (await configInt(env, `screening_${adapter.sourceKey.replace(/-/g, '_')}_min_score`, 80)) / 100;
  const max = await configInt(env, `screening_${adapter.sourceKey.replace(/-/g, '_')}_max_per_run`, DEFAULT_MAX);

  const persons = await watchPopulation(env, adapter.sourceKey);
  // INTERPOL is remote/rate-limited → cap; local sources can take all.
  const slice = adapter.kind === 'notice' ? persons.slice(0, max) : persons;

  for (const person of slice) {
    try {
      checked++;
      const candidates = await adapter.fetchForPerson(env, person);
      for (const cand of candidates) {
        if (!cand.externalId) continue;
        const m = adapter.scoreMatch(person, cand);
        if (!m.isConfident && m.score < threshold) continue;
        // Upsert as pending; keep prior status if already reviewed.
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
    } catch { errors++; }
  }

  await execute(db, "UPDATE screening_scan_runs SET finished_at=datetime('now'), persons_checked=?, new_hits=?, errors=? WHERE id=?",
    checked, newHits, errors, runId);
  await execute(db, "UPDATE screening_source_state SET last_run_at=datetime('now'), last_success_at=datetime('now'), circuit_broken=0 WHERE source_key=?", adapter.sourceKey);
}

export async function runScreeningScans(env: Bindings): Promise<void> {
  // Keep OFAC dataset fresh (>20h stale → re-ingest); no dedicated cron entry.
  try {
    const age = await ofacDataAgeHours(env);
    if (age == null || age > 20) await ingestOfac(env);
  } catch (err) { console.error('[screening] ofac ingest failed:', err); }

  for (const adapter of getAdapters()) {
    try { await runOne(env, adapter); }
    catch (err) {
      console.error(`[screening] ${adapter.sourceKey} scan failed:`, err);
      await execute(getDb(env), "UPDATE screening_source_state SET last_error=?, circuit_broken=1 WHERE source_key=?", String(err), adapter.sourceKey).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: Hook into `src/index.ts` scheduled()** — add the import near the other util imports (after `import { runAllSourceScans } ...`):

```ts
import { runScreeningScans } from './utils/screening/runScreeningScans';
```

Then in the 4-hourly branch, immediately after the existing `runUtahSorPoll(env.DB)` `ctx.waitUntil(...)` block, add:

```ts
    // Person-screening framework (INTERPOL / OFAC / Utah SOR). Watch-listed
    // persons only; OFAC dataset is bulk-refreshed inside the orchestrator.
    ctx.waitUntil(
      runScreeningScans(env).catch((err) => console.error('[screening] scan failed:', err)),
    );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/screening/runScreeningScans.ts src/index.ts
git commit -m "feat(screening): cron orchestrator (watch population, throttle, OFAC refresh) + index hook"
```

### Task 9: Confirm / dismiss dispatch (TDD the dispatch wiring)

**Files:** Create `src/utils/screening/confirm.ts`, `tests/screeningConfirm.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/screeningConfirm.test.ts` (pure dispatch logic with a fake DB/env)

```ts
import { describe, it, expect, vi } from 'vitest';
import { confirmScreeningHit, dismissScreeningHit } from '../src/utils/screening/confirm';

// Minimal fake: confirm.ts should look up the hit, call the adapter's confirmHit,
// then mark the row confirmed. We assert it returns the adapter's promotedRef
// and sets status. Adapter side-effects (warrant insert) are covered by integration.
function fakeEnv(hitRow: any) {
  const calls: any[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind: (...b: any[]) => ({
          first: async () => (sql.includes('SELECT') ? hitRow : null),
          run: async () => { calls.push({ sql, b }); return { meta: {} }; },
          all: async () => ({ results: [] }),
        }),
        first: async () => (sql.includes('SELECT') ? hitRow : null),
        run: async () => { calls.push({ sql, b: [] }); return { meta: {} }; },
      };
    },
  };
  return { env: { DB, KV: { get: async () => null, put: async () => {} } } as any, calls };
}

describe('confirmScreeningHit', () => {
  it('marks an unknown source hit confirmed and returns a promotedRef', async () => {
    const { env } = fakeEnv({ id: 1, source_key: 'utah-sor', person_id: 5, external_id: 'X', status: 'pending', display_name: 'A B' });
    const res = await confirmScreeningHit(env, 1, 99);
    expect(res.status).toBe('confirmed');
    expect(typeof res.promotedRef).toBe('string');
  });
  it('throws on a missing hit', async () => {
    const { env } = fakeEnv(null);
    await expect(confirmScreeningHit(env, 404, 99)).rejects.toThrow();
  });
});

describe('dismissScreeningHit', () => {
  it('marks a hit dismissed', async () => {
    const { env } = fakeEnv({ id: 2, source_key: 'ofac-csl', person_id: 5, external_id: 'Y', status: 'pending' });
    const res = await dismissScreeningHit(env, 2, 99);
    expect(res.status).toBe('dismissed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/screeningConfirm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/utils/screening/confirm.ts`**

```ts
import type { Bindings } from '../../types';
import type { ScreeningHitRow } from './types';
import { getDb, queryFirst, execute } from '../db';
import { getAdapter } from './registry';

export async function confirmScreeningHit(env: Bindings, hitId: number, userId: number): Promise<ScreeningHitRow & { promotedRef: string }> {
  const db = getDb(env);
  const hit = await queryFirst<ScreeningHitRow>(db, 'SELECT * FROM screening_hits WHERE id = ?', hitId);
  if (!hit) throw new Error(`screening_hit ${hitId} not found`);
  const adapter = getAdapter(hit.source_key);
  let promotedRef = 'noted';
  if (adapter) {
    const r = await adapter.confirmHit(env, hit);
    promotedRef = r.promotedRef;
  }
  await execute(db,
    "UPDATE screening_hits SET status='confirmed', reviewed_by=?, reviewed_at=datetime('now'), promoted_ref=? WHERE id=?",
    userId, promotedRef, hitId);
  return { ...hit, status: 'confirmed', promoted_ref: promotedRef, reviewed_by: userId, promotedRef };
}

export async function dismissScreeningHit(env: Bindings, hitId: number, userId: number): Promise<ScreeningHitRow> {
  const db = getDb(env);
  const hit = await queryFirst<ScreeningHitRow>(db, 'SELECT * FROM screening_hits WHERE id = ?', hitId);
  if (!hit) throw new Error(`screening_hit ${hitId} not found`);
  await execute(db, "UPDATE screening_hits SET status='dismissed', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?", userId, hitId);
  return { ...hit, status: 'dismissed', reviewed_by: userId };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/screeningConfirm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/screening/confirm.ts tests/screeningConfirm.test.ts
git commit -m "feat(screening): confirm/dismiss dispatch + tests"
```

---

## Phase 4 — Worker routes

### Task 10: `/api/screening` router

**Files:** Create `src/routes/screening.ts`

- [ ] **Step 1: Implement** (mirrors `warrants.ts` conventions: `requireRole`, defensive `try/catch → []`, fire-and-forget scan)

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { getAdapters, getAdapter } from '../utils/screening/registry';
import { runScreeningScans } from '../utils/screening/runScreeningScans';
import { confirmScreeningHit, dismissScreeningHit } from '../utils/screening/confirm';

const screening = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const SCAN_ROLES = ['admin', 'manager', 'supervisor'] as const;

// GET /api/screening/sources — registry + per-source state
screening.get('/sources', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const state = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_source_state');
    const byKey = new Map(state.map((s) => [s.source_key, s]));
    const sources = getAdapters().map((a) => ({
      sourceKey: a.sourceKey, label: a.label, kind: a.kind,
      supportsSearch: a.supportsSearch, supportsWatch: a.supportsWatch,
      state: byKey.get(a.sourceKey) ?? null,
    }));
    return c.json({ data: sources });
  } catch { return c.json({ data: [] }); }
});

// GET /api/screening/search?source=&name=&forename=&nationality=&ageMin=&ageMax=&sexId=&page=
screening.get('/search', requireRole(...READ_ROLES), async (c) => {
  const sourceKey = c.req.query('source') ?? '';
  const adapter = getAdapter(sourceKey);
  if (!adapter || !adapter.supportsSearch) return c.json({ data: [], error: 'unknown or non-searchable source' }, 400);
  try {
    const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const results = await adapter.searchAdHoc(c.env, {
      name: c.req.query('name'), forename: c.req.query('forename'),
      nationality: c.req.query('nationality'), sexId: c.req.query('sexId'),
      ageMin: num(c.req.query('ageMin')), ageMax: num(c.req.query('ageMax')),
      page: num(c.req.query('page')),
    });
    return c.json({ data: results });
  } catch (err) { return c.json({ data: [], error: String(err) }); }
});

// GET /api/screening/notice/:type/:id  (+ /images) — INTERPOL detail proxy
screening.get('/notice/:type/:id', requireRole(...READ_ROLES), async (c) => {
  const { type, id } = c.req.param();
  if (!['red', 'yellow', 'un'].includes(type)) return c.json({ error: 'bad type' }, 400);
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ error: 'not found' }, res.status as 404);
  return c.json(await res.json());
});
screening.get('/notice/:type/:id/images', requireRole(...READ_ROLES), async (c) => {
  const { type, id } = c.req.param();
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${encodeURIComponent(id)}/images`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ _embedded: { images: [] } });
  return c.json(await res.json());
});

// GET /api/screening/hits?status=&person_id=&source=
screening.get('/hits', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const filters: string[] = ['is_active = 1']; const params: unknown[] = [];
    const status = c.req.query('status'); if (status) { filters.push('status = ?'); params.push(status); }
    const pid = c.req.query('person_id'); if (pid && Number.isFinite(Number(pid))) { filters.push('person_id = ?'); params.push(Number(pid)); }
    const src = c.req.query('source'); if (src) { filters.push('source_key = ?'); params.push(src); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM screening_hits WHERE ${filters.join(' AND ')} ORDER BY match_score DESC, last_seen_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

// POST /api/screening/hits/:id/confirm
screening.post('/hits/:id/confirm', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    const res = await confirmScreeningHit(c.env, id, user.id);
    return c.json({ success: true, status: res.status, promotedRef: res.promotedRef });
  } catch (err) { return c.json({ success: false, error: String(err) }, 400); }
});

// POST /api/screening/hits/:id/dismiss
screening.post('/hits/:id/dismiss', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    await dismissScreeningHit(c.env, id, user.id);
    return c.json({ success: true });
  } catch (err) { return c.json({ success: false, error: String(err) }, 400); }
});

// GET/POST/DELETE /api/screening/watchlist
screening.get('/watchlist', requireRole(...READ_ROLES), async (c) => {
  try {
    const rows = await query<Record<string, unknown>>(getDb(c.env), `
      SELECT sw.id, sw.person_id, sw.source_scope, sw.reason, sw.active,
             p.first_name, p.last_name
        FROM screening_watchlist sw LEFT JOIN persons p ON p.id = sw.person_id
       WHERE sw.active = 1 ORDER BY sw.created_at DESC LIMIT 200`);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});
screening.post('/watchlist', requireRole(...SCAN_ROLES), async (c) => {
  const body = await c.req.json<{ person_id?: number; source_scope?: string; reason?: string }>().catch(() => ({}));
  const user = c.get('user') as { id: number };
  if (!body.person_id) return c.json({ success: false, error: 'person_id required' }, 400);
  const r = await execute(getDb(c.env),
    'INSERT INTO screening_watchlist (person_id, source_scope, reason, added_by) VALUES (?,?,?,?)',
    body.person_id, body.source_scope ?? null, body.reason ?? null, user.id);
  return c.json({ success: true, id: r.meta.last_row_id });
});
screening.delete('/watchlist/:id', requireRole(...SCAN_ROLES), async (c) => {
  await execute(getDb(c.env), 'UPDATE screening_watchlist SET active = 0 WHERE id = ?', Number(c.req.param('id')));
  return c.json({ success: true });
});

// POST /api/screening/scan — manual trigger (fire-and-forget)
screening.post('/scan', requireRole(...SCAN_ROLES), async (c) => {
  c.executionCtx.waitUntil(runScreeningScans(c.env).catch((err) => console.error('[screening] manual scan failed:', err)));
  return c.json({ success: true, started: true, message: 'Scan started; poll /hits and /status.' }, 202);
});

// GET /api/screening/status — recent runs + state
screening.get('/status', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const runs = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_scan_runs ORDER BY started_at DESC LIMIT 20');
    const state = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_source_state');
    const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM screening_hits WHERE status='pending' AND is_active=1");
    return c.json({ runs, state, pendingCount: pending?.n ?? 0 });
  } catch { return c.json({ runs: [], state: [], pendingCount: 0 }); }
});

export default screening;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/screening.ts
git commit -m "feat(screening): /api/screening Hono router"
```

### Task 11: Mount the router

**Files:** Modify `src/routesConfig.ts`

- [ ] **Step 1: Add the import** alongside the other route imports (alphabetical area near `import screening...` — place after the existing `import` for the prefix that precedes it; e.g. near `scrapers`/`serve`):

```ts
import screening from './routes/screening';
```

- [ ] **Step 2: Add the registry entry** in the RMS section of `ROUTE_REGISTRY` (alphabetical by prefix — place `/api/screening` between its alphabetical neighbors):

```ts
  { prefix: '/api/screening', router: screening, auth: 'required' },
```

- [ ] **Step 3: Typecheck & smoke (local dev)**

Run: `npm run typecheck` → PASS
Run (optional): `npm run dev` then `curl -s localhost:8787/api/screening/sources -H "Authorization: Bearer <dev-jwt>"` → JSON `{ "data": [ ... 5 sources ... ] }` (or 401 without a token, proving the route is mounted+gated).

- [ ] **Step 4: Commit**

```bash
git add src/routesConfig.ts
git commit -m "feat(screening): mount /api/screening (auth required)"
```

---

## Phase 5 — Client

### Task 12: ScreeningPage

**Files:** Create `client/src/pages/ScreeningPage.tsx`

> Follow existing patterns: `apiFetch` from `../hooks/useApi`, `PanelTitleBar` from `../components/PanelTitleBar`, pure-black tokens, 2px radius, table classes used in `WarrantsPage.tsx`. Role check: read the current user from the same context WarrantsPage uses (grep `useAuth`/`AuthContext` in `WarrantsPage.tsx`) to hide Confirm/Dismiss for non-`SCAN_ROLES`.

- [ ] **Step 1: Implement the page** (functional; refine styling to match WarrantsPage after it compiles)

```tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { ShieldAlert } from 'lucide-react';

interface SourceInfo { sourceKey: string; label: string; kind: string; supportsSearch: boolean; }
interface Candidate { sourceKey: string; externalId: string; displayName: string; summary: string; photoUrl?: string; country?: string; listType?: string; dob?: string | null; }
interface Hit { id: number; source_key: string; person_id: number | null; display_name: string; summary: string; match_score: number; matched_fields: string; status: string; }

type Tab = 'search' | 'review' | 'watchlist' | 'sources';

export default function ScreeningPage() {
  const [tab, setTab] = useState<Tab>('search');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [source, setSource] = useState('interpol-red');
  const [name, setName] = useState(''); const [forename, setForename] = useState(''); const [nationality, setNationality] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch<{ data: SourceInfo[] }>('/screening/sources').then((r) => setSources(r.data)).catch(() => {}); }, []);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ source });
      if (name) qs.set('name', name);
      if (forename) qs.set('forename', forename);
      if (nationality) qs.set('nationality', nationality);
      const r = await apiFetch<{ data: Candidate[] }>(`/screening/search?${qs}`);
      setResults(r.data ?? []);
    } catch { setResults([]); } finally { setLoading(false); }
  }, [source, name, forename, nationality]);

  const loadHits = useCallback(() => {
    apiFetch<{ data: Hit[] }>('/screening/hits?status=pending').then((r) => setHits(r.data ?? [])).catch(() => setHits([]));
  }, []);
  useEffect(() => { if (tab === 'review') loadHits(); }, [tab, loadHits]);

  const reviewHit = async (id: number, action: 'confirm' | 'dismiss') => {
    await apiFetch(`/screening/hits/${id}/${action}`, { method: 'POST' }).catch(() => {});
    loadHits();
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PERSON SCREENING" icon={ShieldAlert} />
      <div className="flex gap-2 text-[11px]">
        {(['search', 'review', 'watchlist', 'sources'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 border border-[#232323] ${tab === t ? 'bg-[#0b0b0b] text-[#d4a017]' : 'text-[#888]'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]">
              {sources.filter((s) => s.supportsSearch).map((s) => <option key={s.sourceKey} value={s.sourceKey}>{s.label}</option>)}
            </select>
            <input placeholder="Surname" value={name} onChange={(e) => setName(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <input placeholder="Forename" value={forename} onChange={(e) => setForename(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <input placeholder="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <button onClick={search} className="px-3 py-1 border border-[#d4a017] text-[#d4a017] text-[11px]">SEARCH</button>
          </div>
          {loading ? <div className="text-[#888] text-[11px]">Searching…</div> : (
            <table className="w-full text-[11px]">
              <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">NAME</th><th className="text-left">SUMMARY</th><th className="text-left">COUNTRY</th><th className="text-left">DOB</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.sourceKey}-${r.externalId}`} className="border-t border-[#121212]">
                    <td className="py-[2px] flex items-center gap-2">{r.photoUrl && <img src={r.photoUrl} alt="" className="w-6 h-6 object-cover" />}{r.displayName}</td>
                    <td>{r.summary}</td><td>{r.country ?? '—'}</td><td>{r.dob ?? '—'}</td>
                  </tr>
                ))}
                {!results.length && <tr><td colSpan={4} className="text-[#888] py-2">No results.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'review' && (
        <table className="w-full text-[11px]">
          <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SOURCE</th><th className="text-left">MATCH</th><th className="text-left">FIELDS</th><th /></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} className="border-t border-[#121212]">
                <td className="py-[2px]">{h.display_name}</td><td>{h.source_key}</td>
                <td>{Math.round(h.match_score * 100)}%</td><td>{(JSON.parse(h.matched_fields || '[]') as string[]).join(', ')}</td>
                <td className="text-right">
                  <button onClick={() => reviewHit(h.id, 'confirm')} className="px-2 py-[2px] border border-[#d4a017] text-[#d4a017] mr-1">CONFIRM</button>
                  <button onClick={() => reviewHit(h.id, 'dismiss')} className="px-2 py-[2px] border border-[#232323] text-[#888]">DISMISS</button>
                </td>
              </tr>
            ))}
            {!hits.length && <tr><td colSpan={5} className="text-[#888] py-2">No pending hits.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'watchlist' && <WatchlistTab />}
      {tab === 'sources' && <SourcesTab sources={sources} />}
    </div>
  );
}

function WatchlistTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const load = useCallback(() => { apiFetch<{ data: Record<string, unknown>[] }>('/screening/watchlist').then((r) => setRows(r.data ?? [])).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SCOPE</th><th className="text-left">REASON</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className="border-t border-[#121212]">
            <td className="py-[2px]">{String(r.first_name ?? '')} {String(r.last_name ?? '')}</td>
            <td>{String(r.source_scope ?? 'all')}</td><td>{String(r.reason ?? '—')}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} className="text-[#888] py-2">No dedicated watch entries (intel-watchlist persons are also screened).</td></tr>}
      </tbody>
    </table>
  );
}

function SourcesTab({ sources }: { sources: SourceInfo[] }) {
  const [status, setStatus] = useState<{ state: Record<string, unknown>[]; pendingCount: number } | null>(null);
  useEffect(() => { apiFetch<{ state: Record<string, unknown>[]; pendingCount: number }>('/screening/status').then(setStatus).catch(() => {}); }, []);
  const byKey = new Map((status?.state ?? []).map((s) => [String(s.source_key), s]));
  return (
    <div className="space-y-2 text-[11px]">
      <div className="text-[#d4a017]">Pending review: {status?.pendingCount ?? 0}</div>
      <table className="w-full">
        <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">SOURCE</th><th className="text-left">ENABLED</th><th className="text-left">LAST RUN</th><th className="text-left">ITEMS</th></tr></thead>
        <tbody>
          {sources.map((s) => {
            const st = byKey.get(s.sourceKey);
            return (
              <tr key={s.sourceKey} className="border-t border-[#121212]">
                <td className="py-[2px]">{s.label}</td>
                <td>{st && Number(st.enabled) === 0 ? 'no' : 'yes'}</td>
                <td>{String(st?.last_run_at ?? '—')}</td><td>{String(st?.items_count ?? '—')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ScreeningPage.tsx
git commit -m "feat(screening): ScreeningPage (search/review/watchlist/sources tabs)"
```

### Task 13: Register route + nav + window

**Files:** Modify `client/src/App.tsx`, `client/src/components/Sidebar.tsx`, `client/src/utils/windowManager.ts`

- [ ] **Step 1: App.tsx** — add the lazy import near the other page imports:

```ts
const ScreeningPage = lazyRetry(() => import('./pages/ScreeningPage'));
```
and add the route near the `/warrants` route:
```tsx
<Route path="/screening" element={<RouteErrorBoundary><ScreeningPage /></RouteErrorBoundary>} />
```

- [ ] **Step 2: Sidebar.tsx** — add a nav entry near the `/warrants` entry (reuse an imported icon, e.g. `ShieldAlert`; if not already imported, add it to the lucide-react import):

```tsx
{ path: '/screening', icon: ShieldAlert, label: 'Screening' },
```

- [ ] **Step 3: windowManager.ts** — add a sizing entry near `/warrants`:

```ts
'/screening': { title: 'Person Screening', width: 1100, height: 820 },
```

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx client/src/utils/windowManager.ts
git commit -m "feat(screening): register /screening route, nav entry, window sizing"
```

### Task 14: Dossier timeline integration (TDD)

**Files:** Modify `src/utils/intelDossier.ts`; extend `tests/intelDossier.test.ts`

- [ ] **Step 1: Learn the shape** — `sed -n '1,80p' src/utils/intelDossier.ts` and read `tests/intelDossier.test.ts`. Identify the `TimelineEvent` interface and the function that assembles per-person timeline sources (e.g. `buildPersonDossier`/`mergeTimeline`).

- [ ] **Step 2: Add a failing test** to `tests/intelDossier.test.ts` asserting that a confirmed `screening_hits` row for the person produces a timeline event with `kind: 'screening_hit'` (use the file's existing fake-DB / fixture pattern). Match the existing test's setup style exactly.

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/intelDossier.test.ts` → FAIL.

- [ ] **Step 4: Implement** — add a source query in the dossier builder:

```ts
// Confirmed screening hits → timeline events
const screeningRows = await query<{ id: number; source_key: string; display_name: string; summary: string; reviewed_at: string }>(
  db, "SELECT id, source_key, display_name, summary, reviewed_at FROM screening_hits WHERE person_id = ? AND status='confirmed' AND is_active=1", personId).catch(() => []);
const screeningEvents = screeningRows.map((r) => ({
  kind: 'screening_hit', id: r.id, date: r.reviewed_at,
  title: `Screening match: ${r.source_key}`, subtitle: r.summary, status: 'confirmed',
}));
// include screeningEvents in the mergeTimeline([...]) call
```
(Adapt field names to the actual `TimelineEvent` interface from Step 1.)

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/intelDossier.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/intelDossier.ts tests/intelDossier.test.ts
git commit -m "feat(screening): surface confirmed hits on the person dossier timeline"
```

### Task 15: Admin integrations toggles + OFAC CSL key

**Files:** Modify `client/src/pages/admin/AdminIntegrationsTab.tsx`

- [ ] **Step 1: Edit `LAW_ENFORCEMENT_KEYS`** (line ~112) — repurpose the INTERPOL entry's description (no key needed) and add an OFAC CSL key entry:

```tsx
{ key: 'interpol_api_key', label: 'INTERPOL Notices', desc: 'Public API — no key needed; this enables the INTERPOL screening source' },
{ key: 'screening_ofac_csl_api_key', label: 'OFAC / CSL (optional)', desc: 'Free ITA developer key — enables live fuzzy sanctions search; bulk-ingest works without it' },
```

- [ ] **Step 2: Add the help-link** in the URL map (line ~215):

```tsx
screening_ofac_csl_api_key: 'https://developer.trade.gov/',
```

- [ ] **Step 3: Client typecheck & commit**

Run: `cd client && npx tsc --noEmit` → PASS
```bash
git add client/src/pages/admin/AdminIntegrationsTab.tsx
git commit -m "feat(screening): admin integrations — INTERPOL enable + OFAC CSL key"
```

### Task 16: Service-worker cache bump

**Files:** Modify `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`** from `'rmpg-flex-v921'` to `'rmpg-flex-v922'`.

- [ ] **Step 2: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache to v922 for screening subsystem"
```

---

## Phase 6 — Verify & ship

### Task 17: Full verification

- [ ] **Step 1: Worker typecheck** — `npm run typecheck` → PASS
- [ ] **Step 2: Worker tests** — `npm test` → all pass (incl. the 4 new screening tests)
- [ ] **Step 3: Client typecheck** — `cd client && npx tsc --noEmit` → PASS
- [ ] **Step 4: Client tests** — `cd client && npx vitest run` → PASS
- [ ] **Step 5: Client build** — `cd client && npx vite build` → succeeds
- [ ] **Step 6: Column-cap check** — confirm no `ALTER ... ADD COLUMN` against `calls_for_service`/`persons` in `migrations/0106_screening.sql` (there are none) so `column-cap-check.yml` stays green.

### Task 18: Open PR

- [ ] **Step 1: Push the feature branch** (already on `claude/infallible-lamport-b85641`, branched off main):

```bash
git push -u origin claude/infallible-lamport-b85641
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --title "feat(screening): person-screening framework (INTERPOL + OFAC + Utah SOR)" \
  --body "$(cat <<'EOF'
Multi-source person-screening subsystem behind one pluggable adapter framework.

## What
- Unified `screening_hits` review queue with a **pending → human confirm → alert** gate.
- Adapters: INTERPOL Notices (live proxy + watch, red/yellow/un), OFAC/CSL (daily bulk-ingest + local match + optional live fuzzy search), Utah SOR (wraps existing `utah_sex_offenders`).
- Throttled 4-hourly cron orchestrator over watch-listed persons (`intel_watchlist` ∪ `screening_watchlist`).
- New `/api/screening/*` router; `ScreeningPage` (search / review queue / watchlist / sources).
- Confirmed hits: INTERPOL Red → canonical `warrants` + alert; OFAC/UN → person caution-flag; surfaced on the dossier timeline.

## ⚠️ Post-merge ship-gates (see plan §Ship-gates)
1. Apply `migrations/0106_screening.sql` directly to live D1 `785de7ae` (deploy migration step is continue-on-error).
2. Verify `/api/screening` routing: if `rmpgutah.us/api/*` is dispatched by `proxy/index.ts`, add `/api/screening` to its `API_ROUTES` and verify live (else it 404s via legacy fall-through). Alternative: it may already resolve if served directly by the rewrite Worker — verify with `workers_get_worker_code`.
3. SW bumped to v922.
4. (Optional) OFAC live mode needs a free ITA key in `system_config.screening_ofac_csl_api_key`; bulk-ingest works without it.

Spec: docs/superpowers/specs/2026-06-13-person-screening-framework-design.md
Plan: docs/superpowers/plans/2026-06-13-person-screening-framework.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Ship-gates (post-merge, performed once the PR is merged)

1. **Migration to live D1**: apply `0106_screening.sql` to `rmpg-flex` (`785de7ae`) via the Cloudflare D1 API; verify with `pragma_table_info('screening_hits')` etc.
2. **Proxy routing**: confirm how `rmpgutah.us/api/*` is served. If via `proxy/index.ts`, add `/api/screening` to `API_ROUTES` and redeploy the proxy; verify `/api/screening/sources` returns the registry in a real browser (WAF blocks curl on non-health paths).
3. **Post-deploy smoke**: in a logged-in browser, open `/screening`, run a Search (e.g. a common surname), trigger `POST /api/screening/scan`, confirm a `pending` hit appears, confirm/dismiss it, and verify an INTERPOL-Red confirm creates a `warrants` row.

---

## Self-Review

**Spec coverage:**
- §4 architecture → Tasks 2–16. ✓
- §5 framework core (adapter iface, queue, watch union, orchestrator, confirm) → Tasks 2, 7, 8, 9. ✓
- §6 data model → Task 1. ✓
- §7 adapters (INTERPOL, OFAC both-modes, Utah SOR) → Tasks 4, 5, 6. ✓
- §8 matching/pending gate → Tasks 3, 8. ✓
- §9 cron/rate-limit → Task 8. ✓
- §10 routes → Tasks 10, 11. ✓
- §11 client → Tasks 12, 13. ✓ (dossier → Task 14)
- §12 config/admin → Task 15. ✓
- §13 security/roles → Task 10 (READ/SCAN gates). ✓
- §14 testing → Tasks 3, 4, 5, 9, 14, 17. ✓
- §15 deploy/ship-gates → Tasks 17, 18 + Ship-gates. ✓

**Placeholder scan:** Two intentional, flagged verify-points remain (not silent placeholders): (a) OFAC live CSL exact auth header — defaulted to `subscription-key`, marked VERIFY, behind a key check, bulk path unaffected; (b) Utah SOR exact column names — Task 6 Step 1 reads `0096` first. The dossier `TimelineEvent` field names are aligned in Task 14 Step 1 against the real interface. No "TBD/handle edge cases/similar to Task N".

**Type consistency:** `NormalizedCandidate`, `MatchResult`, `ScreeningHitRow`, `ScreeningAdapter`, `PersonRow`, `SearchParams` defined once in Task 2 and used verbatim in Tasks 4–10. `normalizeName`/`ageFromDob`/`scoreNameMatch`/`scoreSanctionMatch` (Task 3) called with matching signatures in Tasks 4–6. `getAdapters`/`getAdapter` (Task 7) used in Tasks 8–10. `runScreeningScans(env)` (Task 8) called in Tasks 10 (route) and `src/index.ts`. `confirmScreeningHit`/`dismissScreeningHit(env, id, userId)` (Task 9) called in Task 10. Consistent. ✓
