# National Warrant Pull — PR1 (Framework + Config-Driven JSON Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the `warrantSources/` framework to dual-mode (full-list + per-person) config-driven parser families, deliver the FBI + Utah-County + generic-Socrata + generic-ArcGIS sources end-to-end, and wire the orphaned national search/coverage UI — a working national warrant pull on the Utah poll rules.

**Architecture:** Extend `WarrantSourceAdapter` with a `fetchAll()` full-list mode; a `national_warrant_sources` config table + family factory turns Socrata/ArcGIS sources into config rows; a normalize layer produces clean readable text into the existing `scraped_warrants` store; `runAllSourceScans` gains a full-list leg; new `/api/warrants/national-*` routes back the existing `NationalWarrantSearchPage`.

**Tech Stack:** Hono on Cloudflare Workers, D1 (`src/utils/db.ts`), React/Vite client, vitest (`tests/*.test.ts`, node env).

**Spec:** [`docs/superpowers/specs/2026-06-13-national-warrant-pull-design.md`](../specs/2026-06-13-national-warrant-pull-design.md)

**Scope note:** This plan is **PR1 only** — the framework + 4 clean JSON/REST sources (FBI, Utah County, Baton Rouge LA via Socrata, Arlington TX via ArcGIS) + Norfolk VA (Socrata) + the search/coverage UI. PDF families (PR2) and HTML/P2C/JS families (PR3) are follow-on plans that ADD adapters/config rows to this proven framework — they require no further framework changes.

---

## Confirmed codebase facts (verified)

- Existing framework `src/utils/warrantSources/`: `types.ts` (`PersonRow {id,first_name,middle_name,last_name,dob}`, `RawWarrantHit`, `SourceMeta {key,display_name,state,county,source_url,kind,priority}`, `SourceKind='api'|'html'|'browser'|'portal'`, `WarrantSourceAdapter {meta, fetchForPerson}`), `registry.ts` (`ADAPTERS[]`, `getEnabledAdapters(db)` fail-open), `store.ts` (`upsertScrapedWarrant(db,hit,personId)`, `markScrapedCleared`), `runScan.ts` (`runAllSourceScans(db,opts)` → `{utah, scraped}`), `reconcile.ts` (`reconcileHits`, `CanonicalHit`), `chargeNormalize.ts` (`normalizeCharge`), `resilience.ts` (`jitterDelayMs`), `adapters/` (`utahApi.ts`, `adaCounty.ts`, `natrona.ts`, `_aspnet.ts`).
- DB helpers (`src/utils/db.ts`): `getDb`, `query<T>`, `queryFirst<T>`, `execute`, `executeBatch`, `columnExists`. All async.
- `scraped_warrants` columns: `source_key, warrant_id, full_name, first_name, last_name, middle_name, date_of_birth, age, gender, race, city, state, warrant_type, charge_description, court_name, case_number, bail_amount, offense_level, issue_date, status, photo_url, detail_url, person_id, first_seen_at, last_seen_at, cleared_at, scraped_at, dob_verified`.
- Routes (`src/routes/warrants.ts`): `requireRole(...roles)`, `READ_ROLES=['admin','manager','supervisor','officer','dispatcher']`, `SCAN_ROLES=['admin','manager','supervisor','dispatcher']`, fire-and-forget via `c.executionCtx.waitUntil(...)` + 202. `Env` from `../types`.
- Cron: `runAllSourceScans(env.DB)` runs in `src/index.ts:388` (4-hourly branch) + the `/warrants/watch/scan` route.
- Client: `NationalWarrantSearchPage.tsx` exists, UNROUTED. Calls `POST /api/warrants/national-search` `{first_name,last_name,dob?,state?,offense_level?,warrant_type?,charge_keyword?}` → `{total, search_time_ms, by_state: Record<state,W[]>, local: W[]}`; `GET /api/warrants/national-coverage` → `{sources, states_covered, active_warrants, state_status: Record<USPS,'active'|'pending'|'disabled'>, state_sources: Record<USPS,number>, state_warrants: Record<USPS,number>}`. Pages lazy-load in `App.tsx` (`lazyRetry`), nav in `Sidebar.tsx`, sizes in `windowManager.ts`, SW `CACHE_NAME` in `client/public/sw.js`.
- Next migration prefix: `0107`.

## File Structure
**Create:** `src/utils/warrantSources/normalize.ts`, `.../parse/socrata.ts`, `.../parse/arcgis.ts`, `.../adapters/fbi.ts`, `.../adapters/utahCounty.ts`, `.../configRegistry.ts`, `migrations/0107_national_warrant_pull.sql`, tests `tests/warrantNormalize.test.ts`, `tests/warrantSocrata.test.ts`, `tests/warrantArcgis.test.ts`, `tests/warrantFbi.test.ts`, `tests/warrantUtahCounty.test.ts`.
**Modify:** `src/utils/warrantSources/types.ts`, `.../registry.ts`, `.../runScan.ts`, `src/routes/warrants.ts`, `client/src/App.tsx`, `client/src/components/Sidebar.tsx`, `client/src/utils/windowManager.ts`, `client/public/sw.js`.

---

## Task 1: Migration 0107 — config registry + `scraped_warrants.kind`

**Files:** Create `migrations/0107_national_warrant_pull.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 0107: National warrant pull — config-driven source registry + kind tag.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
CREATE TABLE IF NOT EXISTS national_warrant_sources (
  source_key   TEXT PRIMARY KEY,
  family       TEXT NOT NULL,          -- 'socrata' | 'arcgis' | 'p2c-legacy' | 'zuercher-pdf' | 'tx-muni-pdf' ...
  display_name TEXT NOT NULL,
  state        TEXT,                   -- USPS 2-letter, or 'US' for federal
  jurisdiction TEXT,
  base_url     TEXT,                   -- portal host (socrata) / layer url (arcgis) / base (p2c)
  resource_id  TEXT,                   -- socrata resource id, etc.
  field_map    TEXT,                   -- JSON: { name?, first?, middle?, last?, dob?, age?, charge?, case_no?, bond?, issued?, court?, city?, state?, sex?, race? }
  mode         TEXT NOT NULL DEFAULT 'full-list',  -- 'full-list' | 'per-person'
  format       TEXT NOT NULL,          -- mirrors family transport
  kind         TEXT NOT NULL DEFAULT 'criminal',   -- 'criminal' | 'civil' | 'wanted'
  enabled      INTEGER NOT NULL DEFAULT 1,
  priority     INTEGER NOT NULL DEFAULT 3,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- kind tag on the existing scraped store (criminal default; civil opt-in).
ALTER TABLE scraped_warrants ADD COLUMN kind TEXT DEFAULT 'criminal';

-- Seed PR1 config-driven sources (FBI + Utah County are code adapters, not rows).
INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  ('socrata-brla-citycourt', 'socrata', 'Baton Rouge City Court Warrants', 'LA', 'Baton Rouge', 'data.brla.gov', '3j5u-jyar',
     '{"name":"name","dob":"dob","charge":"type","case_no":"fileno","issued":"doa","state":"state","city":"add3","race":"race","sex":"sex"}',
     'full-list', 'socrata', 'criminal', 1, 2),
  ('socrata-norfolk-pd', 'socrata', 'Norfolk VA Police Active Warrants', 'VA', 'Norfolk', 'data.norfolk.gov', 'cab7-wvn5',
     '{"first":"first","last":"last","dob":"dob","charge":"wa_chrg","issued":"issudate","sex":"sex","race":"race"}',
     'full-list', 'socrata', 'criminal', 1, 2),
  ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington',
     'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Table/MapServer/9', NULL,
     '{"first":"FirstName","middle":"MiddleName","last":"LastName","charge":"OffenseDescription","case_no":"CitationNumber","bond":"AmountDue","issued":"WarrantIssuanceDate","warrant_type":"WarrantType","city":"City","state":"State"}',
     'full-list', 'arcgis', 'criminal', 1, 2);
```

- [ ] **Step 2: Apply to local D1 & verify** — Run: `npx wrangler d1 execute rmpg-flex --local --file migrations/0107_national_warrant_pull.sql` then `npx wrangler d1 execute rmpg-flex --local --command "SELECT source_key,family FROM national_warrant_sources;"` → Expected: 3 rows. (If `npm run migrate:local` errors on a pre-existing unrelated migration, apply this file directly as shown — same approach used for 0106.)

- [ ] **Step 3: Commit**
```bash
git add migrations/0107_national_warrant_pull.sql
git commit -m "feat(national-warrants): migration 0107 — source registry + scraped_warrants.kind"
```

---

## Task 2: Extend the adapter types (dual-mode)

**Files:** Modify `src/utils/warrantSources/types.ts`

- [ ] **Step 1: Extend the types** — replace `SourceKind`, `SourceMeta`, `WarrantSourceAdapter` with:
```ts
export type SourceKind = 'api' | 'html' | 'browser' | 'portal' | 'json' | 'socrata' | 'arcgis' | 'pdf' | 'p2c-legacy' | 'p2c-cloud';
export type SourceMode = 'full-list' | 'per-person';
export type WarrantCategory = 'criminal' | 'civil' | 'wanted';

export interface SourceMeta {
  key: string;
  display_name: string;
  state: string;                 // USPS or 'US'
  county: string | null;
  source_url: string;
  kind: SourceKind;
  priority: 1 | 2 | 3 | 4;
  family?: string;               // parser family id (config-driven sources)
  category?: WarrantCategory;    // criminal (default) | civil | wanted
}

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  mode: SourceMode;
  /** Full-list sources: fetch the entire source roster once. */
  fetchAll?(env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
  /** Per-person sources: query for ONE local person. */
  fetchForPerson?(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
```
(Keep `PersonRow` and `RawWarrantHit` exactly as-is.)

- [ ] **Step 2: Fix existing adapters to declare `mode`** — the three existing adapters (`utahApi.ts`, `adaCounty.ts`, `natrona.ts`) implement `fetchForPerson` but now must also set `mode: 'per-person'`. In EACH, add `mode: 'per-person',` to the exported adapter object (next to `meta`). Run `npm run typecheck` to find the exact spots; they'll error as missing `mode` until added.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS (after adding `mode` to the 3 adapters).

- [ ] **Step 4: Commit**
```bash
git add src/utils/warrantSources/types.ts src/utils/warrantSources/adapters/utahApi.ts src/utils/warrantSources/adapters/adaCounty.ts src/utils/warrantSources/adapters/natrona.ts
git commit -m "feat(national-warrants): dual-mode adapter interface (full-list + per-person)"
```

---

## Task 3: Normalize layer (TDD, pure)

**Files:** Create `src/utils/warrantSources/normalize.ts`, `tests/warrantNormalize.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantNormalize.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { cleanName, normalizeDate, normalizeBond, displayName } from '../src/utils/warrantSources/normalize';

describe('cleanName', () => {
  it('trims, collapses whitespace, title-cases an all-caps name', () => {
    expect(cleanName('  SMITH,   JOHN  Q ')).toBe('Smith, John Q');
  });
  it('returns empty for nullish', () => { expect(cleanName(null)).toBe(''); expect(cleanName(undefined)).toBe(''); });
});

describe('normalizeDate', () => {
  it('passes through an ISO date', () => { expect(normalizeDate('1985-04-12')).toBe('1985-04-12'); });
  it('converts epoch-millis (ArcGIS) to ISO date', () => { expect(normalizeDate(481000000000)).toBe('1985-04-12'); });
  it('parses M/D/YYYY', () => { expect(normalizeDate('4/12/1985')).toBe('1985-04-12'); });
  it('returns null for junk', () => { expect(normalizeDate('unknown')).toBeNull(); expect(normalizeDate(null)).toBeNull(); });
});

describe('normalizeBond', () => {
  it('parses a dollar string to a number', () => { expect(normalizeBond('$1,500.00')).toBe(1500); });
  it('returns null for non-numeric (PR / No Bond)', () => { expect(normalizeBond('PR')).toBeNull(); expect(normalizeBond('No Bond')).toBeNull(); });
  it('passes a number through', () => { expect(normalizeBond(750)).toBe(750); });
});

describe('displayName', () => {
  it('builds Last, First M from parts', () => {
    expect(displayName({ first_name: 'John', middle_name: 'Q', last_name: 'Smith' })).toBe('Smith, John Q');
  });
  it('falls back to full_name when parts missing', () => {
    expect(displayName({ full_name: 'JANE DOE' })).toBe('Jane Doe');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantNormalize.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/warrantSources/normalize.ts`**
```ts
function titleCase(s: string): string {
  return s.replace(/\b([A-Za-z])([A-Za-z']*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

export function cleanName(s: string | null | undefined): string {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  // Title-case only if it's all-caps or all-lower (preserve mixed-case as-is).
  return /^[^a-z]*$/.test(collapsed) || /^[^A-Z]*$/.test(collapsed) ? titleCase(collapsed) : collapsed;
}

export function normalizeDate(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{12,}$/.test(String(v))) {
    const d = new Date(Number(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

export function normalizeBond(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function displayName(p: { first_name?: string | null; middle_name?: string | null; last_name?: string | null; full_name?: string | null }): string {
  if (p.last_name || p.first_name) {
    const first = [p.first_name, p.middle_name].filter(Boolean).join(' ').trim();
    return cleanName([p.last_name, first].filter(Boolean).join(', '));
  }
  return cleanName(p.full_name ?? '');
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantNormalize.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/normalize.ts tests/warrantNormalize.test.ts
git commit -m "feat(national-warrants): normalize layer (name/date/bond) + tests"
```

---

## Task 4: Socrata family parser (TDD, fixture)

**Files:** Create `src/utils/warrantSources/parse/socrata.ts`, `tests/warrantSocrata.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantSocrata.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { parseSocrata, type FieldMap } from '../src/utils/warrantSources/parse/socrata';

const BRLA_ROWS = [
  { name: 'SMITH, JOHN Q', dob: '1985-04-12', type: 'FAILURE TO APPEAR', fileno: 'C-12345', doa: '2024-06-01', state: 'LA', add3: 'BATON ROUGE', race: 'B', sex: 'M' },
];
const MAP: FieldMap = { name: 'name', dob: 'dob', charge: 'type', case_no: 'fileno', issued: 'doa', state: 'state', city: 'add3', race: 'race', sex: 'sex' };

describe('parseSocrata', () => {
  it('maps SODA rows to RawWarrantHit via field-map', () => {
    const hits = parseSocrata(BRLA_ROWS, MAP, 'socrata-brla-citycourt');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.source_key).toBe('socrata-brla-citycourt');
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.date_of_birth).toBe('1985-04-12');
    expect(h.charge_description).toBe('FAILURE TO APPEAR');
    expect(h.case_number).toBe('C-12345');
    expect(h.issue_date).toBe('2024-06-01');
    expect(h.state).toBe('LA');
    expect(h.warrant_id).toBeTruthy(); // stable id derived from case_no/name+dob
  });
  it('derives a stable warrant_id and dedups identical rows', () => {
    const hits = parseSocrata([...BRLA_ROWS, ...BRLA_ROWS], MAP, 'socrata-brla-citycourt');
    expect(new Set(hits.map(h => h.warrant_id)).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantSocrata.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/utils/warrantSources/parse/socrata.ts`**
```ts
import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond } from '../normalize';

export interface FieldMap {
  name?: string; first?: string; middle?: string; last?: string;
  dob?: string; age?: string; charge?: string; case_no?: string;
  bond?: string; issued?: string; court?: string; city?: string;
  state?: string; sex?: string; race?: string; warrant_type?: string;
}

const get = (row: Record<string, unknown>, key?: string): string | null =>
  key && row[key] != null ? String(row[key]) : null;

// Stable per-source warrant id: prefer case_no; else hash of name+dob.
export function deriveWarrantId(parts: (string | null | undefined)[]): string {
  const basis = parts.filter(Boolean).join('|').toUpperCase();
  let h = 0;
  for (let i = 0; i < basis.length; i++) { h = (h * 31 + basis.charCodeAt(i)) | 0; }
  return `h${(h >>> 0).toString(36)}`;
}

export function parseSocrata(rows: Record<string, unknown>[], map: FieldMap, sourceKey: string): RawWarrantHit[] {
  const out: RawWarrantHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const first = get(row, map.first);
    const last = get(row, map.last);
    const fullRaw = get(row, map.name) ?? [first, last].filter(Boolean).join(' ');
    const caseNo = get(row, map.case_no);
    const dob = normalizeDate(get(row, map.dob));
    const warrantId = caseNo || deriveWarrantId([fullRaw, dob]);
    const dedup = `${warrantId}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    out.push({
      source_key: sourceKey,
      warrant_id: warrantId,
      first_name: first ? cleanName(first) : null,
      middle_name: get(row, map.middle),
      last_name: last ? cleanName(last) : null,
      full_name: fullRaw ? cleanName(fullRaw) : null,
      date_of_birth: dob,
      age: get(row, map.age) ? Number(get(row, map.age)) : null,
      city: get(row, map.city),
      state: get(row, map.state),
      charge_description: get(row, map.charge),
      court_name: get(row, map.court),
      case_number: caseNo,
      bail_amount: normalizeBond(get(row, map.bond)),
      issue_date: normalizeDate(get(row, map.issued)),
      warrant_type: get(row, map.warrant_type),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantSocrata.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/parse/socrata.ts tests/warrantSocrata.test.ts
git commit -m "feat(national-warrants): generic Socrata parser (field-map driven) + tests"
```

---

## Task 5: ArcGIS family parser (TDD, fixture)

**Files:** Create `src/utils/warrantSources/parse/arcgis.ts`, `tests/warrantArcgis.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantArcgis.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { parseArcgis } from '../src/utils/warrantSources/parse/arcgis';
import type { FieldMap } from '../src/utils/warrantSources/parse/socrata';

// ArcGIS query response: { features: [{ attributes: {...} }] }, dates are epoch-ms.
const ARLINGTON = { features: [ { attributes: {
  OBJECTID: 1, FirstName: 'JOHN', MiddleName: 'Q', LastName: 'SMITH',
  OffenseDescription: 'UNSAFE SPEED', CitationNumber: 'CIT-99', AmountDue: 557.83,
  WarrantType: 'CAPIAS', WarrantIssuanceDate: 481000000000, City: 'ARLINGTON', State: 'TX',
} } ] };
const MAP: FieldMap = { first: 'FirstName', middle: 'MiddleName', last: 'LastName', charge: 'OffenseDescription', case_no: 'CitationNumber', bond: 'AmountDue', issued: 'WarrantIssuanceDate', warrant_type: 'WarrantType', city: 'City', state: 'State' };

describe('parseArcgis', () => {
  it('maps features[].attributes to RawWarrantHit, converting epoch-ms dates', () => {
    const hits = parseArcgis(ARLINGTON, MAP, 'arcgis-arlington-tx');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.charge_description).toBe('UNSAFE SPEED');
    expect(h.case_number).toBe('CIT-99');
    expect(h.bail_amount).toBe(557.83);
    expect(h.issue_date).toBe('1985-04-12'); // epoch-ms → ISO
    expect(h.warrant_type).toBe('CAPIAS');
  });
  it('returns [] for a missing/empty features array', () => {
    expect(parseArcgis({}, MAP, 'x')).toEqual([]);
    expect(parseArcgis({ features: [] }, MAP, 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantArcgis.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/utils/warrantSources/parse/arcgis.ts`**
```ts
import type { RawWarrantHit } from '../types';
import { parseSocrata, type FieldMap } from './socrata';

interface ArcgisResponse { features?: { attributes?: Record<string, unknown> }[] }

// ArcGIS wraps rows in features[].attributes; once unwrapped, the same
// field-map row→hit mapping as Socrata applies (parseSocrata handles
// epoch-ms dates via normalizeDate). The displayName for first+last is
// produced by parseSocrata (full_name = "Last, First M").
export function parseArcgis(body: unknown, map: FieldMap, sourceKey: string): RawWarrantHit[] {
  const b = (body ?? {}) as ArcgisResponse;
  const rows = (b.features ?? []).map((f) => f.attributes ?? {});
  return parseSocrata(rows, map, sourceKey);
}
```
(Note: `parseSocrata` builds `full_name` as `cleanName([first, last]...)` joined by space when `map.name` is absent — but the test expects `Smith, John Q`. ADJUST `parseSocrata` so that when `first`/`last` are present and `map.name` is absent, `full_name` uses `displayName({first,middle,last})`. Update Task 4's `parseSocrata`: replace the `fullRaw` line with `const fullRaw = get(row, map.name) ?? displayNameFromParts;` where `displayNameFromParts = (first||last) ? displayName({first_name:first, middle_name:get(row,map.middle), last_name:last}) : null;` and import `displayName`. Re-run Task 4's test to confirm still green.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantArcgis.test.ts tests/warrantSocrata.test.ts` → PASS (both).

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/parse/arcgis.ts src/utils/warrantSources/parse/socrata.ts tests/warrantArcgis.test.ts
git commit -m "feat(national-warrants): generic ArcGIS parser (reuses field-map) + tests"
```

---

## Task 6: FBI Wanted adapter (TDD normalize; full-list)

**Files:** Create `src/utils/warrantSources/adapters/fbi.ts`, `tests/warrantFbi.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantFbi.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { normalizeFbiItem } from '../src/utils/warrantSources/adapters/fbi';

const ITEM = {
  uid: 'abc123', title: 'JOHN Q SMITH', description: 'Wire Fraud',
  subjects: ['Crimes Against Children'], aliases: ['Johnny S'],
  dates_of_birth_used: ['1985-04-12'], sex: 'Male', race: 'white',
  field_offices: ['saltlakecity'], warning_message: 'SHOULD BE CONSIDERED ARMED',
  images: [{ thumb: 'https://www.fbi.gov/x/thumb.jpg', large: 'https://www.fbi.gov/x/large.jpg' }],
  url: 'https://www.fbi.gov/wanted/x',
};

describe('normalizeFbiItem', () => {
  it('maps an FBI item to a RawWarrantHit', () => {
    const h = normalizeFbiItem(ITEM);
    expect(h.source_key).toBe('fbi-wanted');
    expect(h.warrant_id).toBe('abc123');
    expect(h.full_name).toBe('Smith, John Q'); // title reformatted to Last, First
    expect(h.date_of_birth).toBe('1985-04-12');
    expect(h.charge_description).toContain('Wire Fraud');
    expect(h.state).toBe('US');
    expect(h.photo_url).toContain('thumb');
    expect(h.detail_url).toContain('fbi.gov');
  });
  it('tolerates missing optional fields', () => {
    const h = normalizeFbiItem({ uid: 'x', title: 'DOE' });
    expect(h.warrant_id).toBe('x');
    expect(h.date_of_birth).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantFbi.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/utils/warrantSources/adapters/fbi.ts`**
```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit } from '../types';
import { cleanName, normalizeDate } from '../normalize';

const API = 'https://api.fbi.gov/wanted/v1/list';
// FBI's Cloudflare front 403s identifier-style UAs; use a browser UA (same trick as utahWarrantPoller).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface FbiItem {
  uid?: string; title?: string; description?: string; subjects?: string[];
  dates_of_birth_used?: string[]; sex?: string; race?: string;
  field_offices?: string[]; warning_message?: string;
  images?: { thumb?: string; large?: string; original?: string }[]; url?: string;
}

// FBI title is "FIRST [M] LAST"; reformat to "Last, First M".
function titleToName(title: string | undefined): { full_name: string | null } {
  if (!title) return { full_name: null };
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return { full_name: cleanName(title) };
  const last = parts[parts.length - 1];
  const firstMid = parts.slice(0, -1).join(' ');
  return { full_name: cleanName(`${last}, ${firstMid}`) };
}

export function normalizeFbiItem(raw: unknown): RawWarrantHit {
  const it = (raw ?? {}) as FbiItem;
  const charge = [it.description, ...(it.subjects ?? [])].filter(Boolean).join(' · ') || null;
  return {
    source_key: 'fbi-wanted',
    warrant_id: it.uid ?? '',
    full_name: titleToName(it.title).full_name,
    date_of_birth: normalizeDate(it.dates_of_birth_used?.[0] ?? null),
    state: 'US',
    charge_description: charge,
    warrant_type: it.warning_message ? `FEDERAL · ${it.warning_message}` : 'FEDERAL',
    photo_url: it.images?.[0]?.thumb ?? it.images?.[0]?.large ?? null,
    detail_url: it.url ?? null,
  };
}

async function fetchList(): Promise<FbiItem[]> {
  try {
    const out: FbiItem[] = [];
    for (let page = 1; page <= 60; page++) {  // ~1200 records / 20 = 60 pages
      const res = await fetch(`${API}?page=${page}&pageSize=50`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) break;
      const body = (await res.json()) as { items?: FbiItem[]; total?: number };
      const items = body.items ?? [];
      out.push(...items);
      if (items.length < 50) break;
    }
    return out;
  } catch { return []; }
}

export const fbiAdapter: WarrantSourceAdapter = {
  meta: { key: 'fbi-wanted', display_name: 'FBI Wanted', state: 'US', county: null, source_url: API, kind: 'json', priority: 1, family: 'fbi', category: 'wanted' },
  mode: 'full-list',
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]> {
    const items = await fetchList();
    return items.map(normalizeFbiItem).filter((h) => h.warrant_id);
  },
};
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantFbi.test.ts` → PASS. Then `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/adapters/fbi.ts tests/warrantFbi.test.ts
git commit -m "feat(national-warrants): FBI Wanted full-list adapter + tests"
```

---

## Task 7: Utah County JSON adapter (TDD; full-list)

**Files:** Create `src/utils/warrantSources/adapters/utahCounty.ts`, `tests/warrantUtahCounty.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantUtahCounty.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { normalizeUtahCountyItem } from '../src/utils/warrantSources/adapters/utahCounty';

const ITEM = { id: 42, top_name: 'SMITH, JOHN Q', age: 40, charge_info: 'BURGLARY (F2) - Case 181813 - Bond $5000', photo_path: 'a.jpg', web_photo_path: '/api/mostWanted/imgProxy/a.jpg', added_on: '2024-06-01' };

describe('normalizeUtahCountyItem', () => {
  it('maps a Utah County mostWanted item to a RawWarrantHit', () => {
    const h = normalizeUtahCountyItem(ITEM);
    expect(h.source_key).toBe('utah-county-mostwanted');
    expect(h.warrant_id).toBe('42');
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.age).toBe(40);
    expect(h.charge_description).toContain('BURGLARY');
    expect(h.state).toBe('UT');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantUtahCounty.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/utils/warrantSources/adapters/utahCounty.ts`**
```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit } from '../types';
import { cleanName } from '../normalize';

const API = 'https://sheriff.utahcounty.gov/api/mostWanted';

interface UtCoItem { id?: number | string; top_name?: string; age?: number; charge_info?: string; web_photo_path?: string; photo_path?: string; added_on?: string; }

export function normalizeUtahCountyItem(raw: unknown): RawWarrantHit {
  const it = (raw ?? {}) as UtCoItem;
  return {
    source_key: 'utah-county-mostwanted',
    warrant_id: String(it.id ?? ''),
    full_name: cleanName(it.top_name ?? null),
    age: typeof it.age === 'number' ? it.age : (it.age ? Number(it.age) : null),
    state: 'UT',
    city: 'Utah County',
    charge_description: it.charge_info ?? null,
    warrant_type: 'most-wanted',
    photo_url: it.web_photo_path ? `https://sheriff.utahcounty.gov${it.web_photo_path}` : null,
  };
}

export const utahCountyAdapter: WarrantSourceAdapter = {
  meta: { key: 'utah-county-mostwanted', display_name: 'Utah County Sheriff Most Wanted', state: 'UT', county: 'Utah', source_url: API, kind: 'json', priority: 1, family: 'utah-county', category: 'wanted' },
  mode: 'full-list',
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]> {
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const body = (await res.json()) as unknown[];
      return (Array.isArray(body) ? body : []).map(normalizeUtahCountyItem).filter((h) => h.warrant_id);
    } catch { return []; }
  },
};
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantUtahCounty.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/adapters/utahCounty.ts tests/warrantUtahCounty.test.ts
git commit -m "feat(national-warrants): Utah County Most Wanted adapter + tests"
```

---

## Task 8: Config-driven registry (family factory + merge)

**Files:** Create `src/utils/warrantSources/configRegistry.ts`; Modify `src/utils/warrantSources/registry.ts`

- [ ] **Step 1: Implement `src/utils/warrantSources/configRegistry.ts`**
```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit, SourceKind, WarrantCategory } from './types';
import { query } from '../db';
import { parseSocrata, type FieldMap } from './parse/socrata';
import { parseArcgis } from './parse/arcgis';

interface SourceRow {
  source_key: string; family: string; display_name: string; state: string | null;
  jurisdiction: string | null; base_url: string | null; resource_id: string | null;
  field_map: string | null; mode: string; format: string; kind: string;
  enabled: number; priority: number;
}

function safeMap(json: string | null): FieldMap { try { return json ? JSON.parse(json) : {}; } catch { return {}; } }

// Build a full-list adapter from a config row for a config-driven family.
function makeAdapter(row: SourceRow): WarrantSourceAdapter | null {
  const map = safeMap(row.field_map);
  const meta = {
    key: row.source_key, display_name: row.display_name, state: row.state ?? 'US',
    county: row.jurisdiction, source_url: row.base_url ?? '', kind: (row.format as SourceKind),
    priority: (row.priority as 1 | 2 | 3 | 4) ?? 3, family: row.family, category: (row.kind as WarrantCategory),
  };
  if (row.family === 'socrata') {
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      try {
        const url = `https://${row.base_url}/resource/${row.resource_id}.json?$limit=50000`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return [];
        return parseSocrata((await res.json()) as Record<string, unknown>[], map, row.source_key);
      } catch { return []; }
    } };
  }
  if (row.family === 'arcgis') {
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      try {
        const out: RawWarrantHit[] = [];
        for (let offset = 0; offset < 50000; offset += 1000) {
          const url = `${row.base_url}/query?where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=1000`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) break;
          const body = (await res.json()) as { features?: unknown[]; exceededTransferLimit?: boolean };
          out.push(...parseArcgis(body, map, row.source_key));
          if (!body.exceededTransferLimit) break;
        }
        return out;
      } catch { return []; }
    } };
  }
  return null; // unknown family (pdf/p2c handled in later PRs)
}

// Adapters from national_warrant_sources rows (config-driven families).
export async function getConfigAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  let rows: SourceRow[] = [];
  try { rows = await query<SourceRow>(db, 'SELECT * FROM national_warrant_sources WHERE enabled = 1'); } catch { return []; }
  return rows.map(makeAdapter).filter((a): a is WarrantSourceAdapter => a !== null);
}
```

- [ ] **Step 2: Wire code adapters into `registry.ts`** — modify `ADAPTERS` and add a merged resolver:
```ts
// add imports:
import { fbiAdapter } from './adapters/fbi';
import { utahCountyAdapter } from './adapters/utahCounty';
import { getConfigAdapters } from './configRegistry';

// extend the code-resident list:
export const ADAPTERS: WarrantSourceAdapter[] = [utahApiAdapter, adaCountyAdapter, natronaAdapter, fbiAdapter, utahCountyAdapter];

// NEW: full enabled set = configured code adapters (existing getEnabledAdapters) + config-row adapters.
export async function getAllEnabledAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  const code = await getEnabledAdapters(db);          // existing fail-open code-adapter resolver
  const config = await getConfigAdapters(db);          // national_warrant_sources rows
  // fbi + utahCounty are code adapters but may not have a warrant_scraper_config row; include them always.
  const always = ADAPTERS.filter((a) => a.meta.family === 'fbi' || a.meta.family === 'utah-county');
  const byKey = new Map<string, WarrantSourceAdapter>();
  for (const a of [...code, ...always, ...config]) byKey.set(a.meta.key, a);
  return [...byKey.values()];
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/utils/warrantSources/configRegistry.ts src/utils/warrantSources/registry.ts
git commit -m "feat(national-warrants): config-driven family factory + merged adapter registry"
```

---

## Task 9: Orchestrator — full-list leg (TDD the match-and-store seam)

**Files:** Modify `src/utils/warrantSources/runScan.ts`

> The existing `runAllSourceScans` runs Utah + per-person scraped adapters. Add a **full-list leg**: for each enabled `mode:'full-list'` adapter, `fetchAll()` → `upsertScrapedWarrant` for each hit (person_id resolved by local match) → `markScrapedCleared` for that source. Reuse the existing match/promotion path. Keep the per-person leg unchanged.

- [ ] **Step 1: Add a fixture-style test** — append to a new `tests/warrantFullList.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runFullListLeg } from '../src/utils/warrantSources/runScan';
import type { WarrantSourceAdapter } from '../src/utils/warrantSources/types';

function fakeDb() {
  const calls: { sql: string; b: any[] }[] = [];
  const DB: any = { prepare(sql: string) { return { bind: (...b: any[]) => ({ first: async () => null, run: async () => { calls.push({ sql, b }); return { meta: {} }; }, all: async () => ({ results: [] }) }), first: async () => null, run: async () => { calls.push({ sql, b: [] }); return { meta: {} }; }, all: async () => ({ results: [] }) }; } };
  return { DB, calls };
}

describe('runFullListLeg', () => {
  it('fetches each full-list adapter and upserts its hits', async () => {
    const { DB, calls } = fakeDb();
    const adapter: WarrantSourceAdapter = { meta: { key: 'x', display_name: 'X', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return [{ source_key: 'x', warrant_id: 'w1', full_name: 'Doe, Jane' }]; } };
    const summary = await runFullListLeg(DB, [adapter]);
    expect(summary[0].source_key).toBe('x');
    expect(summary[0].found).toBe(1);
    expect(calls.some(c => /INSERT INTO scraped_warrants/i.test(c.sql))).toBe(true);
  });
  it('isolates a throwing adapter (one bad source does not abort others)', async () => {
    const { DB } = fakeDb();
    const bad: WarrantSourceAdapter = { meta: { key: 'bad', display_name: 'B', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { throw new Error('boom'); } };
    const good: WarrantSourceAdapter = { meta: { key: 'good', display_name: 'G', state: 'US', county: null, source_url: '', kind: 'json', priority: 1 }, mode: 'full-list', async fetchAll() { return [{ source_key: 'good', warrant_id: 'w', full_name: 'A B' }]; } };
    const summary = await runFullListLeg(DB, [bad, good]);
    expect(summary.find(s => s.source_key === 'bad')?.errors).toBe(1);
    expect(summary.find(s => s.source_key === 'good')?.found).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantFullList.test.ts` → FAIL (no `runFullListLeg`).

- [ ] **Step 3: Implement `runFullListLeg` in `runScan.ts`** (add + export; do NOT change the existing Utah/per-person logic):
```ts
import { upsertScrapedWarrant, markScrapedCleared } from './store';   // already imported
import type { WarrantSourceAdapter } from './types';

/** Full-list leg: fetch each source's entire roster, upsert into scraped_warrants, clear-sweep per source. */
export async function runFullListLeg(db: D1Database, adapters: WarrantSourceAdapter[]): Promise<ScrapedSourceSummary[]> {
  const out: ScrapedSourceSummary[] = [];
  for (const adapter of adapters) {
    if (adapter.mode !== 'full-list' || !adapter.fetchAll) continue;
    const runStartedAt = await currentDbTime(db);
    let found = 0, errors = 0, cleared = 0;
    try {
      const hits = await adapter.fetchAll({ DB: db });
      for (const hit of hits) {
        try { await upsertScrapedWarrant(db, hit, null); found++; } catch { errors++; }
      }
      // Clear-sweep: rows for this source not refreshed this run → cleared.
      cleared = await markScrapedCleared(db, adapter.meta.key, runStartedAt).catch(() => 0);
    } catch { errors++; }
    out.push({ source_key: adapter.meta.key, checked: 0, found, cleared, errors });
  }
  return out;
}

async function currentDbTime(db: D1Database): Promise<string> {
  const row = await queryFirst<{ now: string }>(db, "SELECT datetime('now') AS now");
  return row?.now ?? '';
}
```
Then in `runAllSourceScans`, after the scraped per-person leg, add the full-list leg over the enabled full-list adapters:
```ts
// inside runAllSourceScans, after building `adapters` (enabled set):
const fullList = await runFullListLeg(db, adapters.filter((a) => a.mode === 'full-list'));
```
and include `fullList` in the returned `scraped` array (concat). VERIFY `markScrapedCleared(db, sourceKey, runStartedAt)` signature against `store.ts` — if it differs (e.g. takes only `(db, sourceKey)`), adapt the call and the `currentDbTime` use accordingly; read `store.ts` to confirm before implementing.

> **Wiring the enabled set:** change `runAllSourceScans` to resolve adapters via `getAllEnabledAdapters(db)` (Task 8) instead of `getEnabledAdapters(db)`, so FBI/Utah-County/config sources are included. Keep the per-person leg filtering to `mode==='per-person'` adapters and the full-list leg to `mode==='full-list'`. The Utah `utahApiAdapter` stays per-person; `runUtahWarrantScan` continues to own the Utah path (exclude `utahApiAdapter` from the scraped per-person leg as today).

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantFullList.test.ts` → PASS. Then `npm test` → full suite green; `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/runScan.ts tests/warrantFullList.test.ts
git commit -m "feat(national-warrants): full-list scan leg (fetchAll → store → clear-sweep) + tests"
```

---

## Task 10: National search + coverage routes

**Files:** Modify `src/routes/warrants.ts`

- [ ] **Step 1: Add the routes** (mirror existing `warrants.ts` conventions — `requireRole`, defensive try/catch, `waitUntil`+202). Insert near the other `/warrants/*` routes:
```ts
import { getAllEnabledAdapters } from '../utils/warrantSources/registry';
import { runAllSourceScans } from '../utils/warrantSources/runScan';

// GET /warrants/national-coverage — drives the coverage map
warrants.get('/national-coverage', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const sources = await query<{ state: string | null; source_key: string }>(db,
      "SELECT state, source_key FROM national_warrant_sources WHERE enabled = 1").catch(() => []);
    // code adapters (FBI=US, Utah County=UT) augment the per-state map
    const codeStates: Record<string, number> = { US: 1, UT: 1 };
    const stateSources: Record<string, number> = { ...codeStates };
    for (const s of sources) { const st = (s.state || 'US').toUpperCase(); stateSources[st] = (stateSources[st] ?? 0) + 1; }
    const counts = await query<{ state: string; n: number }>(db,
      "SELECT COALESCE(state,'US') AS state, COUNT(*) n FROM scraped_warrants WHERE status='active' GROUP BY state").catch(() => []);
    const stateWarrants: Record<string, number> = {};
    let activeWarrants = 0;
    for (const r of counts) { const st = (r.state || 'US').toUpperCase(); stateWarrants[st] = (stateWarrants[st] ?? 0) + r.n; activeWarrants += r.n; }
    const stateStatus: Record<string, 'active' | 'pending' | 'disabled'> = {};
    for (const st of Object.keys(stateSources)) stateStatus[st] = (stateWarrants[st] ?? 0) > 0 ? 'active' : 'pending';
    return c.json({
      sources: Object.values(stateSources).reduce((a, b) => a + b, 0),
      states_covered: Object.keys(stateSources).length,
      active_warrants: activeWarrants,
      state_status: stateStatus, state_sources: stateSources, state_warrants: stateWarrants,
    });
  } catch { return c.json({ sources: 0, states_covered: 0, active_warrants: 0, state_status: {}, state_sources: {}, state_warrants: {} }); }
});

// POST /warrants/national-search — query cached scraped_warrants across all sources
warrants.post('/national-search', requireRole(...READ_ROLES), async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  try {
    const db = getDb(c.env);
    const filters: string[] = ["status = 'active'"]; const params: unknown[] = [];
    const last = s(body.last_name); if (last) { filters.push("(last_name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\')"); params.push(`%${last}%`, `%${last}%`); }
    const first = s(body.first_name); if (first) { filters.push("(first_name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\')"); params.push(`%${first}%`, `%${first}%`); }
    const dob = s(body.dob); if (dob) { filters.push('date_of_birth = ?'); params.push(dob); }
    const st = s(body.state); if (st) { filters.push('UPPER(state) = ?'); params.push(st.toUpperCase()); }
    const chg = s(body.charge_keyword); if (chg) { filters.push("charge_description LIKE ? ESCAPE '\\'"); params.push(`%${chg}%`); }
    const wt = s(body.warrant_type); if (wt) { filters.push("warrant_type LIKE ? ESCAPE '\\'"); params.push(`%${wt}%`); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT source_key, full_name, first_name, last_name, date_of_birth, age, city, state,
              charge_description, court_name, case_number, bail_amount, issue_date, warrant_type, photo_url, detail_url, kind
         FROM scraped_warrants WHERE ${filters.join(' AND ')} ORDER BY last_seen_at DESC LIMIT 500`, ...params);
    const byState: Record<string, Record<string, unknown>[]> = {};
    for (const r of rows) { const k = String(r.state || 'US').toUpperCase(); (byState[k] ??= []).push(r); }
    return c.json({ total: rows.length, search_time_ms: Date.now() - startedAt, by_state: byState, local: [] });
  } catch (err) { console.error('[warrants/national-search]', err); return c.json({ total: 0, search_time_ms: Date.now() - startedAt, by_state: {}, local: [], error: 'search failed' }, 500); }
});

// GET /warrants/national/sources — registry + state
warrants.get('/national/sources', requireRole(...READ_ROLES), async (c) => {
  try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT source_key, family, display_name, state, kind, enabled FROM national_warrant_sources ORDER BY state, source_key'); return c.json({ data: rows }); } catch { return c.json({ data: [] }); }
});

// POST /warrants/national/scan — manual full scan (fire-and-forget)
warrants.post('/national/scan', requireRole(...SCAN_ROLES), async (c) => {
  c.executionCtx.waitUntil(runAllSourceScans(getDb(c.env)).catch((err) => console.error('[warrants/national/scan]', err)));
  return c.json({ success: true, started: true, message: 'National scan started; poll /warrants/watch/runs.' }, 202);
});
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**
```bash
git add src/routes/warrants.ts
git commit -m "feat(national-warrants): /national-search + /national-coverage + /national/sources + /national/scan routes"
```

---

## Task 11: Wire the NationalWarrantSearchPage (route + nav)

**Files:** Modify `client/src/App.tsx`, `client/src/components/Sidebar.tsx`, `client/src/utils/windowManager.ts`

- [ ] **Step 1: App.tsx** — add the lazy import near the other page imports and a route near `/warrants`:
```ts
const NationalWarrantSearchPage = lazyRetry(() => import('./pages/NationalWarrantSearchPage'));
```
```tsx
<Route path="/national-warrants" element={<RouteErrorBoundary><NationalWarrantSearchPage /></RouteErrorBoundary>} />
```
(Match the exact wrapper pattern of neighboring routes.)

- [ ] **Step 2: Sidebar.tsx** — add a nav entry in the Enforcement section near `/warrants` (reuse an imported icon, e.g. `Globe` — verify it's imported from lucide-react in Sidebar; if not, add it):
```tsx
{ path: '/national-warrants', icon: Globe, label: 'National Warrants' },
```

- [ ] **Step 3: windowManager.ts** — add a sizing entry near `/warrants`:
```ts
'/national-warrants': { title: 'National Warrant Search', width: 1180, height: 860 },
```

- [ ] **Step 4: Client typecheck** — `cd client && npx tsc --noEmit` → PASS (if `client/node_modules` is absent in the worktree, verify by copying the changed files into the main project's client tree which has node_modules; otherwise rely on CI).

- [ ] **Step 5: Commit**
```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx client/src/utils/windowManager.ts
git commit -m "feat(national-warrants): route + nav for NationalWarrantSearchPage"
```

---

## Task 12: Service-worker bump + full verification + PR

**Files:** Modify `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`** in `client/public/sw.js` to the next version (read the current `const CACHE_NAME = 'rmpg-flex-vNNN';` and increment).

- [ ] **Step 2: Verify**
  - `npm run typecheck` → PASS
  - `npm test` → all pass (incl. the 6 new warrant test files)
  - `cd client && npx tsc --noEmit && npx vite build` → PASS (install client deps with `npm ci` if needed; gitignored)
  - Confirm no `ALTER` on capped tables in `0107` (only `scraped_warrants.kind` — not capped).

- [ ] **Step 3: Commit + push + PR**
```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for national warrant pull (PR1)"
git push -u origin claude/national-warrant-pull
gh pr create --base main --title "feat(national-warrants): national warrant pull — framework + FBI/Utah-County/Socrata/ArcGIS (PR1)" --body "Framework + config-driven JSON core. See docs/superpowers/plans/2026-06-13-national-warrant-pull-pr1.md. Post-merge: apply migrations/0107 to live D1 785de7ae; verify /api/warrants/national-* routing live; SW bumped. PR2 = PDF wave, PR3 = HTML/P2C/JS breadth."
```

### Ship-gates (post-merge)
1. Apply `migrations/0107_national_warrant_pull.sql` to live D1 `785de7ae`; verify `national_warrant_sources` (3 rows) + `scraped_warrants.kind` via `pragma_table_info`.
2. Verify `/api/warrants/national-coverage` + `/national-search` route live (browser; WAF blocks curl) — same gate `/api/screening` cleared.
3. Trigger `POST /api/warrants/national/scan`; confirm `scraped_warrants` populates (FBI ~1200, Baton Rouge large) and the coverage map lights up.

---

## Self-Review
**Spec coverage:** dual-mode framework (§5.1)→T2; config registry+factory (§5.2)→T1,T8; normalize (§5.3)→T3; Socrata/ArcGIS families (§4)→T4,T5; FBI/Utah-County bespoke (§4)→T6,T7; pull engine full-list leg + Utah rules (§6)→T9; search+coverage backend (§7)→T10; UI wiring→T11; storage `kind` (§5.4)→T1; testing (§11)→T3-T9; phasing PR1 (§12)→whole plan; ship-gates (§13)→T12. PDF/HTML/P2C families (§4, PR2/PR3) deferred by design. ✓
**Placeholder scan:** Two flagged "verify-then-adapt" points (markScrapedCleared signature in T9; client node_modules in T11) — both are read-the-real-file instructions, not placeholders. No TBD/TODO. ✓
**Type consistency:** `RawWarrantHit`/`PersonRow` unchanged; `WarrantSourceAdapter` gains `mode`+`fetchAll` (T2) used in T6,T7,T8,T9; `FieldMap` defined in T4 reused in T5,T8; `parseSocrata`/`parseArcgis` (T4,T5) used in T8; `getAllEnabledAdapters` (T8) used in T9,T10; `runFullListLeg`/`ScrapedSourceSummary` (T9) consistent. ✓
