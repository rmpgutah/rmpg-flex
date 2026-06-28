# Salt Lake County Assessor Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-reference Business + Property record addresses against the Salt Lake County Assessor parcel database. Auto-fill matching form fields on entry, backfill existing records on demand, and persist every Assessor field verbatim in `parcel_records` + `parcel_sales`.

**Architecture:** New `src/utils/sl-assessor/` namespace (typed client, pure parser, KV cache, never-clobber autofill). New `src/routes/assessor.ts` exposes lookup, parcel-detail, apply, backfill, status, and review-queue endpoints. Schema migration adds 13 focused columns to `businesses` and `properties` plus three new tables (`parcel_records`, `parcel_sales`, `assessor_backfill_jobs`). Client adds `useAssessorLookup` + `<AssessorSuggestionPanel>` wired into `BusinessTab` + `PropertiesTab`. Backfill rides the existing `* * * * *` cron, gated to every other tick.

**Tech Stack:** Hono + Cloudflare Workers + D1 + KV + Firecrawl v1 REST API (already in use for iCrimeWatch / court records / deep research). React 18 + Vite + Tailwind. Vitest for unit tests (matches `tests/roboflowAlpr.test.ts` / `tests/dar.test.ts` pattern).

**Spec:** [`docs/superpowers/specs/2026-06-21-sl-county-assessor-integration-design.md`](../specs/2026-06-21-sl-county-assessor-integration-design.md)

**Mandatory references:**
- `CLAUDE.md` rule #5 — after merge, apply `0134_assessor_integration.sql` directly to live D1 `785de7ae` and verify via `pragma_table_info`.
- Memory [[feedback-use-pr-flow-not-direct-push]] — ship via feature branch + `gh pr create`, **NOT** `git push HEAD:main`.

---

## File Structure

### Created

```
src/utils/sl-assessor/types.ts            ~80 lines
src/utils/sl-assessor/cache.ts            ~70 lines
src/utils/sl-assessor/parser.ts           ~250 lines
src/utils/sl-assessor/client.ts           ~180 lines
src/utils/sl-assessor/autofill.ts         ~120 lines
src/utils/sl-assessor/backfill.ts         ~180 lines (processBackfillTick)
src/routes/assessor.ts                    ~280 lines
migrations/0134_assessor_integration.sql  full DDL from spec
tests/sl-assessor.parser.test.ts          ~200 lines
tests/sl-assessor.cache.test.ts           ~60 lines
tests/sl-assessor.client.test.ts          ~120 lines
tests/sl-assessor.autofill.test.ts        ~140 lines
tests/sl-assessor.backfill.test.ts        ~160 lines
tests/fixtures/sl-assessor/single.html    real captured query.cfm response
tests/fixtures/sl-assessor/multi.html     ditto, multi-parcel
tests/fixtures/sl-assessor/none.html      ditto, no match
tests/fixtures/sl-assessor/detail.html    ditto, parcel detail page
client/src/hooks/useAssessorLookup.ts     ~90 lines
client/src/components/AssessorSuggestionPanel.tsx          ~180 lines
client/src/components/AssessorSuggestionPanel.test.tsx     ~120 lines
client/src/components/AssessorReviewQueueBanner.tsx        ~100 lines
client/src/components/AssessorBackfillButton.tsx           ~120 lines
```

### Modified

```
src/utils/db.ts                  append 13 columns × 2 tables to boot reconciler list
src/routesConfig.ts              add 1 import + 1 mount line
src/routes/records.ts            PATCH /businesses/:id accepts new columns
src/routes/properties.ts         PATCH /:id accepts new columns
src/index.ts                     scheduled() handler dispatches processBackfillTick on even minutes
client/src/pages/records/BusinessTab.tsx        wire useAssessorLookup + panel under address
client/src/pages/records/PropertiesTab.tsx      ditto
client/src/pages/RecordsPage.tsx                AssessorBackfillButton + AssessorReviewQueueBanner
client/public/sw.js              bump CACHE_NAME
```

---

## Phase 1 — Backend foundation

### Task 1: Migration + boot reconciler

**Files:**
- Create: `migrations/0134_assessor_integration.sql`
- Modify: `src/utils/db.ts` (boot reconciler list)

- [ ] **Step 1: Write the migration**

Copy the DDL block from the spec verbatim into `migrations/0134_assessor_integration.sql`. (The spec's `Schema` section is the canonical source.)

- [ ] **Step 2: Apply locally and verify**

```bash
npm run migrate:local
npx wrangler d1 execute rmpg-flex --local --command \
  "SELECT name FROM pragma_table_info('businesses') WHERE name LIKE 'parcel_%' OR name LIKE 'owner_%' OR name LIKE 'assessor_%';"
```
Expected: 13 rows (the new business columns).

- [ ] **Step 3: Add boot reconciler entries in `src/utils/db.ts`**

Find the existing `ensureMissingColumns` (or equivalent reconciler block — search for `columnExists` callers in `db.ts`). Append:

```ts
const ASSESSOR_COLUMNS: Array<[string, string, string]> = [
  ['businesses', 'parcel_number', 'TEXT'],
  ['businesses', 'owner_of_record', 'TEXT'],
  ['businesses', 'owner_type', 'TEXT'],
  ['businesses', 'owner_mailing_address', 'TEXT'],
  ['businesses', 'year_built', 'INTEGER'],
  ['businesses', 'total_market_value', 'INTEGER'],
  ['businesses', 'land_sqft', 'INTEGER'],
  ['businesses', 'last_sale_date', 'TEXT'],
  ['businesses', 'last_sale_price', 'INTEGER'],
  ['businesses', 'legal_description', 'TEXT'],
  ['businesses', 'tax_district', 'TEXT'],
  ['businesses', 'assessor_last_synced_at', 'TEXT'],
  ['businesses', 'assessor_source_url', 'TEXT'],
];
// then the same list for 'properties'
for (const [table, col, type] of ASSESSOR_COLUMNS.concat(
  ASSESSOR_COLUMNS.map(([_, c, t]) => ['properties', c, t] as const),
)) {
  if (!(await columnExists(db, table, col))) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0134_assessor_integration.sql src/utils/db.ts
git commit -m "feat(records): mig 0134 — Salt Lake Co Assessor columns + parcel tables"
```

---

### Task 2: Type definitions

**Files:**
- Create: `src/utils/sl-assessor/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/utils/sl-assessor/types.ts
// Salt Lake County Assessor types. Mirrors the columns in parcel_records;
// raw_data_json captures anything we parsed but don't have a typed slot for.

export type OwnerType = 'individual' | 'entity' | 'mixed' | 'unknown';

export interface ParcelSummary {
  parcel_number: string;
  owner_of_record: string | null;
  situs_address: string | null;
  land_sqft: number | null;
  total_market_value: number | null;
  detail_url: string;
}

export interface ParcelSale {
  sale_date: string | null;
  sale_price: number | null;
  doc_number: string | null;
  buyer: string | null;
  seller: string | null;
  sale_type: string | null;
}

export interface Parcel {
  parcel_number: string;
  source: 'sl_county_assessor';
  source_url: string;
  account_number: string | null;
  serial_number: string | null;
  tax_district: string | null;
  owner_of_record: string | null;
  owner_type: OwnerType;
  owner_mailing_address: string | null;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  subdivision: string | null;
  land_acres: number | null;
  land_sqft: number | null;
  land_value: number | null;
  zoning: string | null;
  year_built: number | null;
  effective_year_built: number | null;
  total_bldg_sqft: number | null;
  finished_sqft: number | null;
  basement_sqft: number | null;
  garage_sqft: number | null;
  stories: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  construction_type: string | null;
  improvement_class: string | null;
  improvement_value: number | null;
  market_value_total: number | null;
  market_value_land: number | null;
  market_value_improvement: number | null;
  taxable_value: number | null;
  assessed_value: number | null;
  tax_year: number | null;
  legal_description: string | null;
  plat: string | null;
  lot: string | null;
  block: string | null;
  sales: ParcelSale[];
  raw_data_json: Record<string, string>;
}

export class AssessorError extends Error {}
export class AssessorConfigError extends AssessorError {
  constructor(msg = 'FIRECRAWL_API_KEY not set — assessor lookups unavailable') {
    super(msg); this.name = 'AssessorConfigError';
  }
}
export class AssessorTimeoutError extends AssessorError { name = 'AssessorTimeoutError'; }
export class AssessorHttpError extends AssessorError {
  constructor(public status: number, msg: string) { super(msg); this.name = 'AssessorHttpError'; }
}
export class AssessorParseError extends AssessorError {
  constructor(msg: string, public excerpt?: string) { super(msg); this.name = 'AssessorParseError'; }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/sl-assessor/types.ts
git commit -m "feat(assessor): typed parcel + error model"
```

---

### Task 3: Address-normalization + KV cache

**Files:**
- Create: `src/utils/sl-assessor/cache.ts`
- Create: `tests/sl-assessor.cache.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sl-assessor.cache.test.ts
import { describe, expect, test } from 'vitest';
import { normalizeAddress, cacheKeyParcels, cacheKeyParcel } from '../src/utils/sl-assessor/cache';

describe('normalizeAddress', () => {
  test('lowercases and trims', () => {
    expect(normalizeAddress('  2200 S 500 E  ')).toBe('2200 s 500 e');
  });
  test('canonicalises directionals', () => {
    expect(normalizeAddress('2200 South 500 East')).toBe('2200 s 500 e');
    expect(normalizeAddress('123 NW Main Street')).toBe('123 nw main st');
  });
  test('canonicalises street types', () => {
    expect(normalizeAddress('123 Main Street')).toBe('123 main st');
    expect(normalizeAddress('123 Main Avenue')).toBe('123 main ave');
    expect(normalizeAddress('123 Main Boulevard')).toBe('123 main blvd');
  });
  test('collapses internal whitespace', () => {
    expect(normalizeAddress('2200   S    500\tE')).toBe('2200 s 500 e');
  });
  test('strips trailing city/state/zip', () => {
    expect(normalizeAddress('2200 S 500 E, Salt Lake City, UT 84106')).toBe('2200 s 500 e');
  });
  test('returns empty for blank input', () => {
    expect(normalizeAddress('  ')).toBe('');
    expect(normalizeAddress('')).toBe('');
  });
});

describe('cacheKey*', () => {
  test('cacheKeyParcels prefixes and normalises', () => {
    expect(cacheKeyParcels('2200 South 500 East')).toBe('assessor:parcels:2200 s 500 e');
  });
  test('cacheKeyParcel preserves dashes', () => {
    expect(cacheKeyParcel('16-04-301-005')).toBe('assessor:parcel:16-04-301-005');
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
npx vitest run tests/sl-assessor.cache.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/sl-assessor/cache.ts
// Pure address normalization + thin KV wrapper. Pure helpers are exported
// so the parser & client can compose them without importing KV.

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

/** Pure: normalize an address for cache-key equivalence. */
export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  // Strip everything after the first comma (city/state/zip)
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Canonicalise tokens
  const tokens = s.split(' ').map((t) => {
    if (DIRECTIONALS[t]) return DIRECTIONALS[t];
    if (STREET_TYPES[t]) return STREET_TYPES[t];
    return t;
  });
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `assessor:parcels:${normalizeAddress(addr)}`;
}

export function cacheKeyParcel(parcelNo: string): string {
  return `assessor:parcel:${parcelNo}`;
}

const TTL_30_DAYS_S = 60 * 60 * 24 * 30;

export interface CacheEnv { KV: KVNamespace; }

export async function getCached<T>(env: CacheEnv, key: string): Promise<T | null> {
  const raw = await env.KV.get(key, 'json');
  return (raw as T) ?? null;
}

export async function putCached<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value), { expirationTtl: TTL_30_DAYS_S });
}

export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/sl-assessor.cache.test.ts
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sl-assessor/cache.ts tests/sl-assessor.cache.test.ts
git commit -m "feat(assessor): KV cache + normalizeAddress"
```

---

### Task 4: HTML parser (fixture-driven TDD)

**Files:**
- Create: `tests/fixtures/sl-assessor/single.html`, `multi.html`, `none.html`, `detail.html`
- Create: `src/utils/sl-assessor/parser.ts`
- Create: `tests/sl-assessor.parser.test.ts`

- [ ] **Step 1: Capture real Assessor HTML fixtures**

Open https://apps.saltlakecounty.gov/assessor/new/query.cfm in a browser and run four searches; save the response HTML for each.

```bash
# Three list responses + one detail page
mkdir -p tests/fixtures/sl-assessor
# Use curl with a real session cookie OR save from a browser:
#   Chrome → View Source → Save As → tests/fixtures/sl-assessor/single.html
# Capture:
#   single.html  - an address returning exactly 1 parcel
#   multi.html   - an address returning 2-3 parcels (strip mall / duplex)
#   none.html    - a clearly non-existent address
#   detail.html  - a single parcel detail page (click through one row)
```

If the site is unreachable from this machine, capture via the Firecrawl scrape endpoint:

```bash
curl -X POST https://api.firecrawl.dev/v1/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://apps.saltlakecounty.gov/assessor/new/query.cfm?...","formats":["html"]}' \
  | jq -r '.data.html' > tests/fixtures/sl-assessor/single.html
```

- [ ] **Step 2: Write failing parser tests**

```ts
// tests/sl-assessor.parser.test.ts
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelList, parseParcelDetail, inferOwnerType }
  from '../src/utils/sl-assessor/parser';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', name), 'utf8');

describe('parseParcelList', () => {
  test('single match returns 1 ParcelSummary', () => {
    const out = parseParcelList(fixture('single.html'));
    expect(out).toHaveLength(1);
    expect(out[0].parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}$/);
    expect(out[0].owner_of_record).toBeTruthy();
    expect(out[0].detail_url).toContain('parcel');
  });
  test('multi match returns >1 ParcelSummary', () => {
    const out = parseParcelList(fixture('multi.html'));
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
  test('no match returns []', () => {
    expect(parseParcelList(fixture('none.html'))).toEqual([]);
  });
});

describe('parseParcelDetail', () => {
  test('extracts core fields', () => {
    const p = parseParcelDetail(fixture('detail.html'));
    expect(p.parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}$/);
    expect(p.owner_of_record).toBeTruthy();
    expect(p.year_built).toBeGreaterThan(1800);
    expect(p.year_built).toBeLessThan(2100);
    expect(p.market_value_total).toBeGreaterThan(0);
    expect(p.raw_data_json).toBeTypeOf('object');
  });
  test('captures sale history list', () => {
    const p = parseParcelDetail(fixture('detail.html'));
    expect(Array.isArray(p.sales)).toBe(true);
    // detail.html may have 0+ sales; ensure shape if any present
    for (const s of p.sales) {
      expect(s).toHaveProperty('sale_date');
      expect(s).toHaveProperty('sale_price');
    }
  });
});

describe('inferOwnerType', () => {
  test('LLC / INC / CORP / TRUST → entity', () => {
    expect(inferOwnerType('XYZ HOLDINGS LLC')).toBe('entity');
    expect(inferOwnerType('ACME INC')).toBe('entity');
    expect(inferOwnerType('SMITH FAMILY TRUST')).toBe('entity');
    expect(inferOwnerType('FOO CORP')).toBe('entity');
    expect(inferOwnerType('BAR LP')).toBe('entity');
    expect(inferOwnerType('BAZ LLP')).toBe('entity');
  });
  test('plain personal names → individual', () => {
    expect(inferOwnerType('SMITH, JOHN')).toBe('individual');
    expect(inferOwnerType('SMITH, JOHN & SMITH, JANE')).toBe('individual');
  });
  test('mixed → mixed', () => {
    expect(inferOwnerType('SMITH, JOHN & ACME LLC')).toBe('mixed');
  });
  test('empty → unknown', () => {
    expect(inferOwnerType('')).toBe('unknown');
    expect(inferOwnerType(null)).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
npx vitest run tests/sl-assessor.parser.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Write the parser implementation**

```ts
// src/utils/sl-assessor/parser.ts
// Pure HTML → typed parcel data. Two entrypoints:
//   parseParcelList(html) → ParcelSummary[]   (from query.cfm result page)
//   parseParcelDetail(html) → Parcel          (from individual parcel page)
// Both throw AssessorParseError on irrecoverable mismatches.
//
// Implementation note: Salt Lake County Assessor renders results in plain
// HTML tables. The parser uses regex / DOM-string scanning rather than
// pulling in a DOM lib (Workers don't ship cheerio or jsdom).

import { AssessorParseError } from './types';
import type { OwnerType, Parcel, ParcelSale, ParcelSummary } from './types';

const ENTITY_TOKENS = /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|TRUST|LP|LLP|LTD|HOLDINGS|GROUP|COMPANY|CO|FOUNDATION|CHURCH)\b/;
const PARCEL_NO_RE = /(\d{2}-\d{2}-\d{3}-\d{3})/;

export function inferOwnerType(name: string | null | undefined): OwnerType {
  if (!name || !name.trim()) return 'unknown';
  const parts = name.split(/\s*&\s*|\s+AND\s+/i).filter(Boolean);
  const flags = parts.map((p) => ENTITY_TOKENS.test(p.toUpperCase()));
  const hasEntity = flags.some(Boolean);
  const hasPerson = flags.some((f) => !f);
  if (hasEntity && hasPerson) return 'mixed';
  if (hasEntity) return 'entity';
  return 'individual';
}

/** Strip HTML tags + collapse whitespace from a chunk. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function toInt(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[$,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function toFloat(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the result-list HTML returned by query.cfm. Looks for table rows
 * containing a parcel number pattern; pulls owner + situs + sqft + value
 * from the surrounding cells.
 */
export function parseParcelList(html: string): ParcelSummary[] {
  if (!html || html.length < 100) return [];
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const out: ParcelSummary[] = [];
  for (const rowHtml of rows) {
    const parcelMatch = rowHtml.match(PARCEL_NO_RE);
    if (!parcelMatch) continue;
    const parcel_number = parcelMatch[1];
    const cells = rowHtml.split(/<\/?td[^>]*>/i).map(stripTags).filter(Boolean);
    if (cells.length < 2) continue;
    // Detail URL: search the row for a link to the parcel detail page
    const linkMatch = rowHtml.match(/href="([^"]+parcel[^"]*)"/i);
    const detail_url = linkMatch ? linkMatch[1] : `?parcel=${parcel_number}`;
    // Heuristic cell map: parcel #, owner, situs, sqft, value (order varies — pick by content)
    const owner = cells.find((c) => /[A-Z]{3,}/.test(c) && c.length > 3 && !c.match(PARCEL_NO_RE)) ?? null;
    const situs = cells.find((c) => /\d+\s+[NSEW]?\s*\d?/.test(c) && !c.match(PARCEL_NO_RE)) ?? null;
    const sqftCell = cells.find((c) => /^\d{3,7}$/.test(c.replace(/,/g, '')));
    const valueCell = cells.find((c) => /^\$/.test(c) || /^\d{1,3}(,\d{3})+$/.test(c));
    out.push({
      parcel_number,
      owner_of_record: owner,
      situs_address: situs,
      land_sqft: toInt(sqftCell ?? null),
      total_market_value: toInt(valueCell ?? null),
      detail_url,
    });
  }
  return out;
}

/** Pull a labelled value from a key/value-table HTML chunk. */
function pullByLabel(html: string, label: RegExp): string | null {
  const re = new RegExp(
    `<t[dh][^>]*>[^<]*${label.source}[^<]*<\\/t[dh]>\\s*<t[dh][^>]*>([^<]+)<\\/t[dh]>`,
    'i',
  );
  const m = html.match(re);
  return m ? stripTags(m[1]) : null;
}

export function parseParcelDetail(html: string): Parcel {
  if (!html || html.length < 200) {
    throw new AssessorParseError('detail page too short', html.slice(0, 200));
  }
  const parcelMatch = html.match(PARCEL_NO_RE);
  if (!parcelMatch) {
    throw new AssessorParseError('no parcel number on detail page', html.slice(0, 500));
  }
  const parcel_number = parcelMatch[1];
  const owner_of_record = pullByLabel(html, /owner/i);
  // Build raw_data_json from every labelled key/value we can detect
  const raw_data_json: Record<string, string> = {};
  const kvRe = /<t[dh][^>]*>([^<]{2,80})<\/t[dh]>\s*<t[dh][^>]*>([^<]{1,200})<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(html)) !== null) {
    const k = stripTags(m[1]).replace(/[:\s]+$/, '');
    const v = stripTags(m[2]);
    if (k && v) raw_data_json[k] = v;
  }
  // Parse sales history table — rows after a "Sale History" heading
  const sales: ParcelSale[] = [];
  const salesIdx = html.search(/sale\s*history/i);
  if (salesIdx > 0) {
    const tail = html.slice(salesIdx);
    const saleRows = tail.split(/<tr[^>]*>/i).slice(1);
    for (const row of saleRows.slice(0, 50)) {
      const cells = row.split(/<\/?td[^>]*>/i).map(stripTags).filter(Boolean);
      if (cells.length < 2) continue;
      // Heuristic: first cell that parses as a date is the sale_date,
      // first $-prefixed or digit-grouped cell is the price.
      const dateCell = cells.find((c) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c));
      const priceCell = cells.find((c) => /^\$?\d{1,3}(,\d{3})+(\.\d{2})?$/.test(c));
      if (!dateCell && !priceCell) continue;
      sales.push({
        sale_date: dateCell ?? null,
        sale_price: toInt(priceCell ?? null),
        doc_number: cells.find((c) => /^\d{6,}$/.test(c)) ?? null,
        buyer: null,
        seller: null,
        sale_type: null,
      });
    }
  }
  return {
    parcel_number,
    source: 'sl_county_assessor',
    source_url: '',  // filled by client
    account_number: pullByLabel(html, /account/i),
    serial_number: pullByLabel(html, /serial/i),
    tax_district: pullByLabel(html, /tax\s*district/i),
    owner_of_record,
    owner_type: inferOwnerType(owner_of_record),
    owner_mailing_address: pullByLabel(html, /mail/i),
    situs_address: pullByLabel(html, /situs|property\s*address/i),
    situs_city: pullByLabel(html, /city/i),
    situs_zip: pullByLabel(html, /zip/i),
    subdivision: pullByLabel(html, /subdivision/i),
    land_acres: toFloat(pullByLabel(html, /acres/i)),
    land_sqft: toInt(pullByLabel(html, /(land\s*)?sq\s*ft|square\s*feet/i)),
    land_value: toInt(pullByLabel(html, /land\s*value/i)),
    zoning: pullByLabel(html, /zoning/i),
    year_built: toInt(pullByLabel(html, /year\s*built/i)),
    effective_year_built: toInt(pullByLabel(html, /effective\s*year/i)),
    total_bldg_sqft: toInt(pullByLabel(html, /total.*sq\s*ft|building\s*sq/i)),
    finished_sqft: toInt(pullByLabel(html, /finished/i)),
    basement_sqft: toInt(pullByLabel(html, /basement/i)),
    garage_sqft: toInt(pullByLabel(html, /garage/i)),
    stories: toFloat(pullByLabel(html, /stories/i)),
    bedrooms: toInt(pullByLabel(html, /bedrooms?/i)),
    bathrooms: toFloat(pullByLabel(html, /bathrooms?/i)),
    construction_type: pullByLabel(html, /construction/i),
    improvement_class: pullByLabel(html, /improvement\s*class/i),
    improvement_value: toInt(pullByLabel(html, /improvement\s*value/i)),
    market_value_total: toInt(pullByLabel(html, /(total\s*)?market\s*value/i)),
    market_value_land: toInt(pullByLabel(html, /market.*land/i)),
    market_value_improvement: toInt(pullByLabel(html, /market.*improvement/i)),
    taxable_value: toInt(pullByLabel(html, /taxable\s*value/i)),
    assessed_value: toInt(pullByLabel(html, /assessed\s*value/i)),
    tax_year: toInt(pullByLabel(html, /tax\s*year/i)),
    legal_description: pullByLabel(html, /legal\s*desc/i),
    plat: pullByLabel(html, /plat/i),
    lot: pullByLabel(html, /lot/i),
    block: pullByLabel(html, /block/i),
    sales,
    raw_data_json,
  };
}
```

- [ ] **Step 5: Run tests, verify they pass against real fixtures**

```bash
npx vitest run tests/sl-assessor.parser.test.ts
```
Expected: all tests pass. If a real fixture causes a specific test to fail, refine the regex in the parser — do **not** mock the fixture. The whole point of fixture-driven TDD here is to lock in real-world HTML shapes.

- [ ] **Step 6: Commit**

```bash
git add src/utils/sl-assessor/parser.ts tests/sl-assessor.parser.test.ts tests/fixtures/sl-assessor/
git commit -m "feat(assessor): fixture-driven HTML parser"
```

---

### Task 5: Firecrawl-backed client

**Files:**
- Create: `src/utils/sl-assessor/client.ts`
- Create: `tests/sl-assessor.client.test.ts`

- [ ] **Step 1: Write failing client tests**

```ts
// tests/sl-assessor.client.test.ts
import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchByAddress, getParcel, buildQueryUrl }
  from '../src/utils/sl-assessor/client';
import { AssessorConfigError, AssessorHttpError, AssessorParseError }
  from '../src/utils/sl-assessor/types';

const fixture = (n: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', n), 'utf8');

describe('buildQueryUrl', () => {
  test('encodes the address', () => {
    const url = buildQueryUrl('2200 S 500 E');
    expect(url).toContain('apps.saltlakecounty.gov/assessor');
    expect(url).toContain(encodeURIComponent('2200 S 500 E'));
  });
});

describe('searchByAddress', () => {
  test('rejects when FIRECRAWL_API_KEY unset', async () => {
    await expect(searchByAddress({}, '2200 S 500 E')).rejects.toBeInstanceOf(AssessorConfigError);
  });

  test('returns parsed parcels on Firecrawl success', async () => {
    const html = fixture('multi.html');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html } }), { status: 200 }),
    );
    const out = await searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E');
    expect(out.length).toBeGreaterThanOrEqual(2);
    fetchSpy.mockRestore();
  });

  test('throws AssessorHttpError on Firecrawl 5xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('boom', { status: 502 }),
    );
    await expect(
      searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E'),
    ).rejects.toBeInstanceOf(AssessorHttpError);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/sl-assessor.client.test.ts
```
Expected: FAIL on module resolution.

- [ ] **Step 3: Write the client**

```ts
// src/utils/sl-assessor/client.ts
// Worker-safe Salt Lake County Assessor client. Uses Firecrawl /v1/scrape to
// render query.cfm (handles ColdFusion session + mild bot protection) and
// hands the resulting HTML to the pure parser.
//
// All network IO funnels through here so the route handler stays thin and
// the parser stays pure.

import { AssessorConfigError, AssessorHttpError, AssessorTimeoutError } from './types';
import type { Parcel, ParcelSummary } from './types';
import { parseParcelList, parseParcelDetail } from './parser';

const FC_SCRAPE = 'https://api.firecrawl.dev/v1/scrape';
const ASSESSOR_BASE = 'https://apps.saltlakecounty.gov/assessor/new/query.cfm';
const DEFAULT_TIMEOUT_MS = 25_000;

export interface AssessorEnv { FIRECRAWL_API_KEY?: string; }

export function buildQueryUrl(address: string): string {
  // The site's query.cfm accepts ?address=<...> as a GET; ColdFusion echoes
  // matches into the same page. (If the live form turns out to require a
  // session POST, swap this for the POST URL — the call site is the same.)
  return `${ASSESSOR_BASE}?address=${encodeURIComponent(address)}`;
}

function buildParcelUrl(parcelNo: string): string {
  return `${ASSESSOR_BASE}?parcel=${encodeURIComponent(parcelNo)}`;
}

async function scrapeHtml(env: AssessorEnv, url: string): Promise<string> {
  if (!env.FIRECRAWL_API_KEY) throw new AssessorConfigError();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(FC_SCRAPE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['html'] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, await res.text().catch(() => ''));
    const json = await res.json() as any;
    const html = json?.data?.html ?? '';
    if (typeof html !== 'string' || !html) {
      throw new AssessorHttpError(res.status, 'Firecrawl returned no html');
    }
    return html;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`scrape timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'scrape failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(env: AssessorEnv, address: string): Promise<ParcelSummary[]> {
  const url = buildQueryUrl(address);
  const html = await scrapeHtml(env, url);
  return parseParcelList(html);
}

export async function getParcel(env: AssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = buildParcelUrl(parcelNo);
  const html = await scrapeHtml(env, url);
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/sl-assessor.client.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sl-assessor/client.ts tests/sl-assessor.client.test.ts
git commit -m "feat(assessor): Firecrawl-backed client"
```

---

### Task 6: Never-clobber autofill helper

**Files:**
- Create: `src/utils/sl-assessor/autofill.ts`
- Create: `tests/sl-assessor.autofill.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sl-assessor.autofill.test.ts
import { describe, expect, test } from 'vitest';
import { applyParcelToRecord, AUTOFILL_FIELDS }
  from '../src/utils/sl-assessor/autofill';
import type { Parcel } from '../src/utils/sl-assessor/types';

const parcel: Parcel = {
  parcel_number: '16-04-301-005',
  source: 'sl_county_assessor',
  source_url: 'https://apps.saltlakecounty.gov/assessor/new/query.cfm?parcel=16-04-301-005',
  account_number: null, serial_number: null, tax_district: 'SLC',
  owner_of_record: 'XYZ HOLDINGS LLC', owner_type: 'entity',
  owner_mailing_address: 'PO BOX 1, SLC UT 84106',
  situs_address: '2200 S 500 E', situs_city: 'SLC', situs_zip: '84106', subdivision: null,
  land_acres: 0.28, land_sqft: 12400, land_value: null, zoning: null,
  year_built: 1958, effective_year_built: 1980,
  total_bldg_sqft: null, finished_sqft: null, basement_sqft: null, garage_sqft: null,
  stories: null, bedrooms: null, bathrooms: null,
  construction_type: null, improvement_class: null, improvement_value: null,
  market_value_total: 1_840_000, market_value_land: null, market_value_improvement: null,
  taxable_value: null, assessed_value: null, tax_year: 2025,
  legal_description: 'LOT 5 BLK 3 ACME SUB',
  plat: null, lot: '5', block: '3',
  sales: [], raw_data_json: {},
};

describe('applyParcelToRecord', () => {
  test('fills empty fields', () => {
    const record = { address: '2200 S 500 E', owner_name: 'Bob\'s Diner' };
    const { patch, skipped } = applyParcelToRecord(record, parcel);
    expect(patch.parcel_number).toBe('16-04-301-005');
    expect(patch.owner_of_record).toBe('XYZ HOLDINGS LLC');
    expect(patch.year_built).toBe(1958);
    expect(patch.total_market_value).toBe(1_840_000);
    expect(patch.legal_description).toBe('LOT 5 BLK 3 ACME SUB');
    expect(patch).not.toHaveProperty('owner_name');  // not in AUTOFILL_FIELDS
    expect(skipped).toEqual([]);
  });

  test('never clobbers a non-empty user-typed field', () => {
    const record = {
      parcel_number: '99-99-999-999',
      owner_of_record: 'EXISTING OWNER',
      year_built: null,                  // empty → fillable
    };
    const { patch, skipped } = applyParcelToRecord(record, parcel);
    expect(patch.parcel_number).toBeUndefined();
    expect(patch.owner_of_record).toBeUndefined();
    expect(patch.year_built).toBe(1958);
    expect(skipped.sort()).toEqual(['owner_of_record', 'parcel_number'].sort());
  });

  test('skips Assessor field if null', () => {
    const sparse = { ...parcel, year_built: null, market_value_total: null };
    const record = {};
    const { patch } = applyParcelToRecord(record, sparse);
    expect(patch).not.toHaveProperty('year_built');
    expect(patch).not.toHaveProperty('total_market_value');
  });

  test('always stamps source_url + last_synced_at', () => {
    const record = {};
    const { patch } = applyParcelToRecord(record, parcel);
    expect(patch.assessor_source_url).toBe(parcel.source_url);
    expect(typeof patch.assessor_last_synced_at).toBe('string');
  });

  test('AUTOFILL_FIELDS covers every column we ALTERed onto businesses/properties', () => {
    expect(AUTOFILL_FIELDS.sort()).toEqual([
      'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
      'year_built', 'total_market_value', 'land_sqft',
      'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
    ].sort());
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
npx vitest run tests/sl-assessor.autofill.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```ts
// src/utils/sl-assessor/autofill.ts
// Pure: given an existing record and a Parcel, return the field patch
// to apply (only fills empty fields) plus the list of fields that were
// skipped because the user already had a value.

import type { Parcel } from './types';

/**
 * The 11 Assessor-mappable columns we ALTER'd onto businesses + properties.
 * `assessor_last_synced_at` and `assessor_source_url` are NOT in this list
 * because they are provenance-stamps, not autofill targets — they always
 * apply.
 */
export const AUTOFILL_FIELDS = [
  'parcel_number',
  'owner_of_record',
  'owner_type',
  'owner_mailing_address',
  'year_built',
  'total_market_value',
  'land_sqft',
  'last_sale_date',
  'last_sale_price',
  'legal_description',
  'tax_district',
] as const;

export type AutofillField = (typeof AUTOFILL_FIELDS)[number];

export interface ApplyResult {
  patch: Partial<Record<AutofillField, unknown>> & {
    assessor_source_url: string;
    assessor_last_synced_at: string;
  };
  skipped: AutofillField[];
}

function pickParcelValue(parcel: Parcel, field: AutofillField): unknown {
  switch (field) {
    case 'parcel_number': return parcel.parcel_number;
    case 'owner_of_record': return parcel.owner_of_record;
    case 'owner_type': return parcel.owner_type;
    case 'owner_mailing_address': return parcel.owner_mailing_address;
    case 'year_built': return parcel.year_built;
    case 'total_market_value': return parcel.market_value_total;
    case 'land_sqft': return parcel.land_sqft;
    case 'last_sale_date': return parcel.sales[0]?.sale_date ?? null;
    case 'last_sale_price': return parcel.sales[0]?.sale_price ?? null;
    case 'legal_description': return parcel.legal_description;
    case 'tax_district': return parcel.tax_district;
  }
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function applyParcelToRecord(
  record: Record<string, unknown>,
  parcel: Parcel,
): ApplyResult {
  const patch: Record<string, unknown> = {
    assessor_source_url: parcel.source_url,
    assessor_last_synced_at: new Date().toISOString(),
  };
  const skipped: AutofillField[] = [];
  for (const f of AUTOFILL_FIELDS) {
    const incoming = pickParcelValue(parcel, f);
    if (isEmpty(incoming)) continue;
    if (!isEmpty(record[f])) { skipped.push(f); continue; }
    patch[f] = incoming;
  }
  return { patch, skipped } as ApplyResult;
}
```

- [ ] **Step 4: Run, pass**

```bash
npx vitest run tests/sl-assessor.autofill.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sl-assessor/autofill.ts tests/sl-assessor.autofill.test.ts
git commit -m "feat(assessor): never-clobber autofill helper"
```

---

### Task 7: Route handler + persistence

**Files:**
- Create: `src/routes/assessor.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write the route**

```ts
// src/routes/assessor.ts
// Salt Lake County Assessor lookup + apply + (Phase 3) backfill endpoints.

import { Hono } from 'hono';
import { getDb, columnExists } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { cacheKeyParcels, cacheKeyParcel, getCached, putCached } from '../utils/sl-assessor/cache';
import { searchByAddress, getParcel } from '../utils/sl-assessor/client';
import { applyParcelToRecord } from '../utils/sl-assessor/autofill';
import {
  AssessorConfigError, AssessorHttpError, AssessorParseError, AssessorTimeoutError,
} from '../utils/sl-assessor/types';
import type { Env } from '../types';
import type { Parcel, ParcelSummary } from '../utils/sl-assessor/types';

const app = new Hono<{ Bindings: Env['Bindings']; Variables: Env['Variables'] }>();

function handleError(c: any, e: unknown) {
  if (e instanceof AssessorConfigError)
    return c.json({ code: 'not_configured', message: e.message }, 503);
  if (e instanceof AssessorTimeoutError)
    return c.json({ code: 'timeout', message: e.message }, 503);
  if (e instanceof AssessorHttpError)
    return c.json({ code: 'upstream', status: e.status, message: e.message }, 503);
  if (e instanceof AssessorParseError)
    return c.json({ code: 'parse_error', message: e.message }, 500);
  return c.json({ code: 'unknown', message: (e as Error)?.message ?? 'unknown' }, 500);
}

app.get('/parcels', async (c) => {
  const address = c.req.query('address')?.trim();
  if (!address) return c.json({ code: 'missing_address' }, 400);
  const key = cacheKeyParcels(address);
  try {
    const cached = await getCached<ParcelSummary[]>(c.env, key);
    if (cached) return c.json({ parcels: cached, cached: true, source_url: null });
    const parcels = await searchByAddress(c.env, address);
    await putCached(c.env, key, parcels);
    return c.json({ parcels, cached: false, source_url: null });
  } catch (e) { return handleError(c, e); }
});

app.get('/parcel/:parcel_no', async (c) => {
  const parcelNo = c.req.param('parcel_no');
  const key = cacheKeyParcel(parcelNo);
  try {
    const cached = await getCached<Parcel>(c.env, key);
    if (cached) return c.json({ parcel: cached, sales: cached.sales, cached: true });
    const parcel = await getParcel(c.env, parcelNo);
    await putCached(c.env, key, parcel);
    return c.json({ parcel, sales: parcel.sales, cached: false });
  } catch (e) { return handleError(c, e); }
});

/**
 * POST /apply  { record_type: 'business'|'property', record_id, parcel_number }
 * Looks up parcel, applies never-clobber autofill, upserts parcel_records +
 * parcel_sales, links record. Returns the patch + skipped[] for the UI tally.
 */
app.post('/apply', async (c) => {
  const body = await c.req.json().catch(() => null) as
    { record_type?: string; record_id?: number; parcel_number?: string } | null;
  if (!body?.record_type || !body.record_id || !body.parcel_number)
    return c.json({ code: 'missing_fields' }, 400);
  const table = body.record_type === 'business' ? 'businesses'
              : body.record_type === 'property' ? 'properties' : null;
  if (!table) return c.json({ code: 'bad_record_type' }, 400);

  const db = getDb(c.env);
  const record = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(body.record_id).first<Record<string, unknown>>();
  if (!record) return c.json({ code: 'not_found' }, 404);

  let parcel: Parcel;
  try {
    const cached = await getCached<Parcel>(c.env, cacheKeyParcel(body.parcel_number));
    parcel = cached ?? await getParcel(c.env, body.parcel_number);
    if (!cached) await putCached(c.env, cacheKeyParcel(body.parcel_number), parcel);
  } catch (e) { return handleError(c, e); }

  const { patch, skipped } = applyParcelToRecord(record, parcel);
  // Build dynamic UPDATE — only known columns
  const setSql: string[] = [];
  const setBind: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(await columnExists(db, table, k))) continue;
    setSql.push(`${k} = ?`);
    setBind.push(v);
  }
  if (setSql.length) {
    await db.prepare(`UPDATE ${table} SET ${setSql.join(', ')} WHERE id = ?`)
      .bind(...setBind, body.record_id).run();
  }

  // Upsert the full parcel record
  await db.prepare(`
    INSERT INTO parcel_records (
      parcel_number, source, source_url, account_number, serial_number, tax_district,
      owner_of_record, owner_type, owner_mailing_address,
      situs_address, situs_city, situs_zip, subdivision,
      land_acres, land_sqft, land_value, zoning,
      year_built, effective_year_built, total_bldg_sqft, finished_sqft, basement_sqft, garage_sqft,
      stories, bedrooms, bathrooms, construction_type, improvement_class, improvement_value,
      market_value_total, market_value_land, market_value_improvement,
      taxable_value, assessed_value, tax_year,
      legal_description, plat, lot, block, raw_data_json,
      fetched_at, refreshed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(parcel_number) DO UPDATE SET
      owner_of_record = excluded.owner_of_record,
      owner_type = excluded.owner_type,
      owner_mailing_address = excluded.owner_mailing_address,
      situs_address = excluded.situs_address,
      market_value_total = excluded.market_value_total,
      year_built = excluded.year_built,
      legal_description = excluded.legal_description,
      raw_data_json = excluded.raw_data_json,
      refreshed_at = datetime('now')
  `).bind(
    parcel.parcel_number, parcel.source, parcel.source_url, parcel.account_number, parcel.serial_number, parcel.tax_district,
    parcel.owner_of_record, parcel.owner_type, parcel.owner_mailing_address,
    parcel.situs_address, parcel.situs_city, parcel.situs_zip, parcel.subdivision,
    parcel.land_acres, parcel.land_sqft, parcel.land_value, parcel.zoning,
    parcel.year_built, parcel.effective_year_built, parcel.total_bldg_sqft, parcel.finished_sqft, parcel.basement_sqft, parcel.garage_sqft,
    parcel.stories, parcel.bedrooms, parcel.bathrooms, parcel.construction_type, parcel.improvement_class, parcel.improvement_value,
    parcel.market_value_total, parcel.market_value_land, parcel.market_value_improvement,
    parcel.taxable_value, parcel.assessed_value, parcel.tax_year,
    parcel.legal_description, parcel.plat, parcel.lot, parcel.block,
    JSON.stringify(parcel.raw_data_json),
  ).run();

  // Replace sales history
  const pr = await db.prepare('SELECT id FROM parcel_records WHERE parcel_number = ?').bind(parcel.parcel_number).first<{ id: number }>();
  if (pr) {
    await db.prepare('DELETE FROM parcel_sales WHERE parcel_record_id = ?').bind(pr.id).run();
    for (const s of parcel.sales) {
      await db.prepare(`
        INSERT INTO parcel_sales (parcel_record_id, sale_date, sale_price, doc_number, buyer, seller, sale_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(pr.id, s.sale_date, s.sale_price, s.doc_number, s.buyer, s.seller, s.sale_type).run();
    }
  }

  await recordAudit(c, {
    action: 'ASSESSOR_APPLIED',
    entityType: body.record_type,
    entityId: body.record_id,
    details: {
      parcel_number: parcel.parcel_number,
      fields_set: Object.keys(patch).filter((k) => k !== 'assessor_source_url' && k !== 'assessor_last_synced_at'),
      skipped,
    },
  });

  return c.json({ ok: true, patch, skipped, parcel_record_id: pr?.id });
});

export default app;
```

- [ ] **Step 2: Mount in `src/routesConfig.ts`**

```ts
// Add to the imports block (alphabetical region near line 87)
import assessor from './routes/assessor';
```

Then add a new mount line in the `Records` section (around line 327):

```ts
{ prefix: '/api/assessor', router: assessor, auth: 'required' },
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Smoke test locally**

```bash
npm run dev &  # start wrangler dev
# in another terminal:
curl -s 'http://localhost:8787/api/assessor/parcels?address=2200%20S%20500%20E' \
  -H "Authorization: Bearer $LOCAL_JWT" | jq .
```
Expected: `{"parcels":[...],"cached":false,...}` or `503 not_configured` if no Firecrawl key set locally — both are valid.

- [ ] **Step 5: Commit**

```bash
git add src/routes/assessor.ts src/routesConfig.ts
git commit -m "feat(assessor): /api/assessor parcels|parcel|apply routes"
```

---

### Task 8: Records PATCH handlers accept new columns

**Files:**
- Modify: `src/routes/records.ts` (businesses PATCH/POST)
- Modify: `src/routes/properties.ts` (PATCH/POST)

- [ ] **Step 1: Update the column allow-list in records.ts**

Find the businesses PATCH/POST handler in `src/routes/records.ts` (search for `businesses` + `UPDATE` or the allow-list constant). Append these to the writable-column list:

```ts
const BUSINESS_ASSESSOR_COLUMNS = [
  'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
  'year_built', 'total_market_value', 'land_sqft',
  'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
  'assessor_last_synced_at', 'assessor_source_url',
];
// merge into existing allow-list
```

- [ ] **Step 2: Do the same for properties.ts**

The list is identical — properties got the same 13 columns. Add the same constant in `src/routes/properties.ts` and merge.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/records.ts src/routes/properties.ts
git commit -m "feat(records): accept Assessor columns in business + property PATCH"
```

---

## Phase 2 — Client wiring

### Task 9: `useAssessorLookup` hook

**Files:**
- Create: `client/src/hooks/useAssessorLookup.ts`

- [ ] **Step 1: Write the hook**

```tsx
// client/src/hooks/useAssessorLookup.ts
// On-blur Assessor lookup. Returns parcels, loading, error, plus
// dismiss() / refetch() controls. Lookup is debounced to dedupe rapid blurs.

import { useCallback, useRef, useState } from 'react';
import { apiFetch } from './useApi';

export interface ParcelSummary {
  parcel_number: string;
  owner_of_record: string | null;
  situs_address: string | null;
  land_sqft: number | null;
  total_market_value: number | null;
  detail_url: string;
}

interface LookupResponse {
  parcels: ParcelSummary[];
  cached: boolean;
  source_url: string | null;
}

const DIGIT_RE = /\d/;

export function useAssessorLookup() {
  const [parcels, setParcels] = useState<ParcelSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const lookup = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();
    if (!trimmed || !DIGIT_RE.test(trimmed)) {
      setParcels(null);
      return;
    }
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    setLoading(true);
    try {
      const res = await apiFetch<LookupResponse>(
        `/assessor/parcels?address=${encodeURIComponent(trimmed)}`,
        { signal: ctl.signal },
      );
      if (!ctl.signal.aborted) {
        setParcels(res.parcels);
        setCached(res.cached);
      }
    } catch (e: any) {
      if (!ctl.signal.aborted) setError(e?.message ?? 'Assessor lookup failed');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  const dismiss = useCallback(() => setParcels(null), []);
  return { parcels, loading, error, cached, lookup, dismiss };
}
```

- [ ] **Step 2: Client typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useAssessorLookup.ts
git commit -m "feat(records): useAssessorLookup hook"
```

---

### Task 10: `AssessorSuggestionPanel` component

**Files:**
- Create: `client/src/components/AssessorSuggestionPanel.tsx`
- Create: `client/src/components/AssessorSuggestionPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// client/src/components/AssessorSuggestionPanel.test.tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssessorSuggestionPanel } from './AssessorSuggestionPanel';

const sample = [
  { parcel_number: '16-04-301-005', owner_of_record: 'XYZ HOLDINGS LLC',
    situs_address: '2200 S 500 E', land_sqft: 12400, total_market_value: 1_840_000,
    detail_url: '' },
  { parcel_number: '16-04-301-006', owner_of_record: 'SMITH, JOHN & SMITH, JANE',
    situs_address: '2202 S 500 E', land_sqft: 8200, total_market_value: 620_000,
    detail_url: '' },
];

describe('AssessorSuggestionPanel', () => {
  test('renders nothing when parcels is null', () => {
    const { container } = render(
      <AssessorSuggestionPanel parcels={null} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  test('renders nothing when parcels is empty', () => {
    const { container } = render(
      <AssessorSuggestionPanel parcels={[]} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  test('single parcel auto-selects, Apply enabled', () => {
    const onApply = vi.fn();
    render(<AssessorSuggestionPanel parcels={[sample[0]]} onApply={onApply} onDismiss={() => {}} />);
    const apply = screen.getByRole('button', { name: /apply/i });
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith('16-04-301-005');
  });
  test('multi parcel requires pick before Apply', () => {
    render(<AssessorSuggestionPanel parcels={sample} onApply={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/16-04-301-006/));
    expect(screen.getByRole('button', { name: /apply/i })).not.toBeDisabled();
  });
  test('dismiss closes panel', () => {
    const onDismiss = vi.fn();
    render(<AssessorSuggestionPanel parcels={[sample[0]]} onApply={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
cd client && npx vitest run src/components/AssessorSuggestionPanel.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/AssessorSuggestionPanel.tsx
// Day/night-themed parcel-picker panel. Renders 0 / 1 / N states from
// useAssessorLookup. Tokens-only — no hex (CLAUDE.md theme rule).

import { useEffect, useState } from 'react';
import type { ParcelSummary } from '../hooks/useAssessorLookup';

interface Props {
  parcels: ParcelSummary[] | null;
  cached?: boolean;
  loading?: boolean;
  onApply: (parcelNumber: string) => void;
  onDismiss: () => void;
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString()}`;
}
function fmtSqft(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString()} sqft`;
}

export function AssessorSuggestionPanel({ parcels, cached, loading, onApply, onDismiss }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (parcels && parcels.length === 1) setPicked(parcels[0].parcel_number);
    else setPicked(null);
  }, [parcels]);
  if (loading) {
    return (
      <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs text-rmpg-400">
        Looking up Salt Lake County Assessor…
      </div>
    );
  }
  if (!parcels || parcels.length === 0) return null;
  return (
    <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs">
      <div className="font-semibold text-brand-400 mb-1">
        🏠 Salt Lake County Assessor — {parcels.length} parcel{parcels.length === 1 ? '' : 's'} match
      </div>
      <div className="space-y-1">
        {parcels.map((p) => (
          <label key={p.parcel_number}
            aria-label={p.parcel_number}
            className="flex items-start gap-2 cursor-pointer p-1 hover:bg-surface-raised">
            <input
              type="radio"
              name="assessor-parcel"
              value={p.parcel_number}
              checked={picked === p.parcel_number}
              onChange={() => setPicked(p.parcel_number)}
              className="mt-[2px]"
            />
            <div className="flex-1">
              <div className="font-mono">{p.parcel_number}  <span className="font-sans text-rmpg-200">{p.owner_of_record ?? '—'}</span></div>
              <div className="text-rmpg-400">
                {p.situs_address ?? '—'} · {fmtSqft(p.land_sqft)} · {fmtMoney(p.total_market_value)}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-between items-center mt-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!picked}
            onClick={() => picked && onApply(picked)}
            className="px-2 py-1 bg-brand-500 text-rmpg-900 disabled:opacity-50">
            Apply
          </button>
          <button type="button" onClick={onDismiss}
            className="px-2 py-1 bg-surface-raised text-rmpg-300">
            Dismiss
          </button>
        </div>
        {cached && <div className="text-rmpg-500">cached</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, pass**

```bash
cd client && npx vitest run src/components/AssessorSuggestionPanel.test.tsx
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AssessorSuggestionPanel.tsx client/src/components/AssessorSuggestionPanel.test.tsx
git commit -m "feat(records): AssessorSuggestionPanel"
```

---

### Task 11: Wire into BusinessTab + PropertiesTab

**Files:**
- Modify: `client/src/pages/records/BusinessTab.tsx`
- Modify: `client/src/pages/records/PropertiesTab.tsx`

- [ ] **Step 1: Wire into BusinessTab**

Find the address input in [`BusinessTab.tsx`](client/src/pages/records/BusinessTab.tsx). Wrap it with the hook + panel:

```tsx
import { useAssessorLookup } from '../../hooks/useAssessorLookup';
import { AssessorSuggestionPanel } from '../../components/AssessorSuggestionPanel';
import { apiFetch } from '../../hooks/useApi';

// inside the component:
const assessor = useAssessorLookup();
const [skippedCount, setSkippedCount] = useState(0);

async function onApplyAssessor(parcelNumber: string) {
  if (!form.id) return;  // only after the record is saved at least once
  const res = await apiFetch<{ patch: Record<string, unknown>; skipped: string[] }>(
    `/assessor/apply`,
    {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: form.id, parcel_number: parcelNumber }),
    },
  );
  setForm((f) => ({ ...f, ...res.patch }));
  setSkippedCount(res.skipped.length);
  assessor.dismiss();
}

// in the JSX, under the address input:
<input
  value={form.address ?? ''}
  onChange={(e) => setForm({ ...form, address: e.target.value })}
  onBlur={(e) => assessor.lookup(e.target.value)}
  className="..."
/>
<AssessorSuggestionPanel
  parcels={assessor.parcels}
  cached={assessor.cached}
  loading={assessor.loading}
  onApply={onApplyAssessor}
  onDismiss={assessor.dismiss}
/>
{skippedCount > 0 && (
  <div className="text-xs text-rmpg-400 mt-1">
    {skippedCount} field{skippedCount === 1 ? '' : 's'} skipped (already filled)
  </div>
)}
```

- [ ] **Step 2: Wire into PropertiesTab**

Same wiring in [`PropertiesTab.tsx`](client/src/pages/records/PropertiesTab.tsx) — just change `record_type: 'property'` and the form field names if they differ (they should be identical column names per the migration).

- [ ] **Step 3: Client typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Client build**

```bash
cd client && npx vite build
```
Expected: build succeeds.

- [ ] **Step 5: Bump SW cache name**

In [`client/public/sw.js`](client/public/sw.js), bump `CACHE_NAME` to the next version (look for the existing `const CACHE_NAME = 'rmpg-flex-vNNN'` and increment).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/records/BusinessTab.tsx client/src/pages/records/PropertiesTab.tsx client/public/sw.js
git commit -m "feat(records): wire Assessor lookup into Business + Properties forms"
```

---

## Phase 3 — Backfill

### Task 12: Backfill enqueue route

**Files:**
- Modify: `src/routes/assessor.ts` (append endpoints)

- [ ] **Step 1: Append backfill enqueue + status endpoints**

In `src/routes/assessor.ts`, append:

```ts
function isAdminOrManager(c: any): boolean {
  const role = c.get('user')?.role ?? '';
  return role === 'admin' || role === 'manager';
}

app.post('/backfill', async (c) => {
  if (!isAdminOrManager(c)) return c.json({ code: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({})) as { dryRun?: boolean; limit?: number };
  const db = getDb(c.env);

  const businesses = await db.prepare(`
    SELECT id FROM businesses
    WHERE archived_at IS NULL AND address IS NOT NULL AND TRIM(address) <> ''
      AND parcel_number IS NULL
    LIMIT ?
  `).bind(body.limit ?? 10000).all<{ id: number }>();
  const properties = await db.prepare(`
    SELECT id FROM properties
    WHERE address IS NOT NULL AND TRIM(address) <> '' AND parcel_number IS NULL
    LIMIT ?
  `).bind(body.limit ?? 10000).all<{ id: number }>();

  const total = (businesses.results?.length ?? 0) + (properties.results?.length ?? 0);
  if (body.dryRun) return c.json({ queued: 0, total_target: total, dryRun: true });

  let queued = 0;
  for (const r of businesses.results ?? []) {
    const res = await db.prepare(`
      INSERT OR IGNORE INTO assessor_backfill_jobs (record_type, record_id, status)
      VALUES ('business', ?, 'pending')
    `).bind(r.id).run();
    if (res.meta.changes) queued++;
  }
  for (const r of properties.results ?? []) {
    const res = await db.prepare(`
      INSERT OR IGNORE INTO assessor_backfill_jobs (record_type, record_id, status)
      VALUES ('property', ?, 'pending')
    `).bind(r.id).run();
    if (res.meta.changes) queued++;
  }
  await recordAudit(c, {
    action: 'ASSESSOR_BACKFILL_ENQUEUED',
    entityType: 'system',
    entityId: null,
    details: { queued, total_target: total },
  });
  return c.json({ queued, already_pending: total - queued, total_target: total });
});

app.get('/backfill/status', async (c) => {
  const db = getDb(c.env);
  const rows = await db.prepare(`
    SELECT status, COUNT(*) as n FROM assessor_backfill_jobs GROUP BY status
  `).all<{ status: string; n: number }>();
  const out = { pending: 0, applied: 0, ambiguous: 0, no_match: 0, error: 0, unfetchable: 0, total: 0 };
  for (const r of rows.results ?? []) {
    (out as any)[r.status] = r.n;
    out.total += r.n;
  }
  return c.json(out);
});

app.get('/review-queue', async (c) => {
  if (!isAdminOrManager(c)) return c.json({ code: 'forbidden' }, 403);
  const db = getDb(c.env);
  const rows = await db.prepare(`
    SELECT j.id, j.record_type, j.record_id, j.matches_json,
           CASE j.record_type
             WHEN 'business' THEN (SELECT name || ' (' || address || ')' FROM businesses WHERE id = j.record_id)
             WHEN 'property' THEN (SELECT name || ' (' || address || ')' FROM properties WHERE id = j.record_id)
           END AS record_label
    FROM assessor_backfill_jobs j
    WHERE j.status = 'ambiguous'
    ORDER BY j.id DESC
    LIMIT 200
  `).all<{ id: number; record_type: string; record_id: number; matches_json: string; record_label: string }>();
  return c.json({
    rows: (rows.results ?? []).map((r) => ({
      ...r,
      matches: JSON.parse(r.matches_json) as ParcelSummary[],
    })),
  });
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/assessor.ts
git commit -m "feat(assessor): backfill enqueue + status + review-queue endpoints"
```

---

### Task 13: `processBackfillTick` + tests

**Files:**
- Create: `src/utils/sl-assessor/backfill.ts`
- Create: `tests/sl-assessor.backfill.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sl-assessor.backfill.test.ts
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { decideOutcome, BACKFILL_RATE_PER_MIN }
  from '../src/utils/sl-assessor/backfill';
import type { ParcelSummary } from '../src/utils/sl-assessor/types';

const one: ParcelSummary = {
  parcel_number: '16-04-301-005', owner_of_record: 'XYZ HOLDINGS LLC',
  situs_address: '2200 S 500 E', land_sqft: 12400, total_market_value: 1_840_000,
  detail_url: '',
};
const two: ParcelSummary = { ...one, parcel_number: '16-04-301-006' };

describe('decideOutcome', () => {
  test('0 matches → no_match', () => {
    expect(decideOutcome([]).status).toBe('no_match');
  });
  test('1 match → applied + parcel_number set', () => {
    const r = decideOutcome([one]);
    expect(r.status).toBe('applied');
    expect(r.applied_parcel_number).toBe('16-04-301-005');
  });
  test('N matches → ambiguous + matches_json', () => {
    const r = decideOutcome([one, two]);
    expect(r.status).toBe('ambiguous');
    expect(JSON.parse(r.matches_json!).length).toBe(2);
  });
});

describe('rate cap', () => {
  test('BACKFILL_RATE_PER_MIN is 30', () => {
    expect(BACKFILL_RATE_PER_MIN).toBe(30);
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
npx vitest run tests/sl-assessor.backfill.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```ts
// src/utils/sl-assessor/backfill.ts
// Process one pending backfill job per tick (paced to be Firecrawl- and
// Assessor-polite). Called from the existing per-minute scheduled() handler.

import { searchByAddress, getParcel } from './client';
import { applyParcelToRecord } from './autofill';
import { cacheKeyParcel, getCached, putCached } from './cache';
import { recordAudit } from '../auditLog';
import type { ParcelSummary } from './types';
import type { Env } from '../../types';
import type { Context } from 'hono';

export const BACKFILL_RATE_PER_MIN = 30;

interface OutcomeApplied {
  status: 'applied';
  applied_parcel_number: string;
}
interface OutcomeAmbiguous {
  status: 'ambiguous';
  matches_json: string;
}
interface OutcomeOther {
  status: 'no_match' | 'unfetchable' | 'error';
  error_message?: string;
}
export type Outcome = OutcomeApplied | OutcomeAmbiguous | OutcomeOther;

/** Pure: pick the right status from a list of matched parcels. */
export function decideOutcome(matches: ParcelSummary[]): Outcome {
  if (matches.length === 0) return { status: 'no_match' };
  if (matches.length === 1) {
    return { status: 'applied', applied_parcel_number: matches[0].parcel_number };
  }
  return { status: 'ambiguous', matches_json: JSON.stringify(matches) };
}

const PER_TICK_BUDGET = 5;            // ≤5 jobs per scheduled minute = 300/hr; safely under the 30/min spec cap
const TICK_WALL_CLOCK_MS = 22_000;    // leave ~8s headroom under the 30s scheduled-handler limit

/**
 * Process up to PER_TICK_BUDGET pending jobs in one scheduled invocation,
 * bounded by TICK_WALL_CLOCK_MS so the handler can't overrun. Each job is
 * one Firecrawl scrape + parse + write — typically ~3–5 s. Returns the
 * count actually processed.
 */
export async function processBackfillTick(env: Env['Bindings']): Promise<number> {
  const started = Date.now();
  let processed = 0;
  while (processed < PER_TICK_BUDGET && Date.now() - started < TICK_WALL_CLOCK_MS) {
    const ok = await processOneJob(env);
    if (!ok) break;   // queue empty
    processed++;
  }
  return processed;
}

async function processOneJob(env: Env['Bindings']): Promise<boolean> {
  const db = env.DB;
  const row = await db.prepare(`
    SELECT id, record_type, record_id, retry_count
    FROM assessor_backfill_jobs
    WHERE status = 'pending' AND retry_count < 3
    ORDER BY id ASC LIMIT 1
  `).first<{ id: number; record_type: 'business' | 'property'; record_id: number; retry_count: number }>();
  if (!row) return false;

  await db.prepare(`UPDATE assessor_backfill_jobs SET started_at = datetime('now') WHERE id = ?`)
    .bind(row.id).run();

  const table = row.record_type === 'business' ? 'businesses' : 'properties';
  const rec = await db.prepare(`SELECT id, address FROM ${table} WHERE id = ?`).bind(row.record_id).first<{ id: number; address: string }>();
  if (!rec || !rec.address || !/\d/.test(rec.address)) {
    await db.prepare(`
      UPDATE assessor_backfill_jobs SET status = 'unfetchable', completed_at = datetime('now') WHERE id = ?
    `).bind(row.id).run();
    return true;
  }

  let matches: ParcelSummary[];
  try {
    matches = await searchByAddress(env, rec.address);
  } catch (e: any) {
    const retry = row.retry_count + 1;
    if (retry >= 3) {
      await db.prepare(`
        UPDATE assessor_backfill_jobs
        SET status='error', retry_count=?, error_message=?, completed_at=datetime('now') WHERE id=?
      `).bind(retry, e?.message ?? 'unknown', row.id).run();
    } else {
      await db.prepare(`UPDATE assessor_backfill_jobs SET retry_count=? WHERE id=?`).bind(retry, row.id).run();
    }
    return true;
  }

  const outcome = decideOutcome(matches);

  if (outcome.status === 'applied') {
    const parcelNo = outcome.applied_parcel_number;
    let parcel = await getCached<any>({ KV: env.KV }, cacheKeyParcel(parcelNo));
    if (!parcel) {
      try { parcel = await getParcel(env, parcelNo); }
      catch { /* fall through to applied-but-detail-failed path: still mark parcel_number */ }
    }
    if (parcel) {
      await putCached({ KV: env.KV }, cacheKeyParcel(parcelNo), parcel);
      const fullRec = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(row.record_id).first<Record<string, unknown>>() ?? {};
      const { patch } = applyParcelToRecord(fullRec, parcel);
      const setSql: string[] = [];
      const setBind: unknown[] = [];
      for (const [k, v] of Object.entries(patch)) {
        setSql.push(`${k} = ?`); setBind.push(v);
      }
      if (setSql.length) {
        await db.prepare(`UPDATE ${table} SET ${setSql.join(', ')} WHERE id = ?`).bind(...setBind, row.record_id).run();
      }
    } else {
      // detail fetch failed — still set parcel_number so the row doesn't requeue
      await db.prepare(`UPDATE ${table} SET parcel_number = ? WHERE id = ?`).bind(parcelNo, row.record_id).run();
    }
    await db.prepare(`
      UPDATE assessor_backfill_jobs
      SET status='applied', applied_parcel_number=?, completed_at=datetime('now') WHERE id=?
    `).bind(parcelNo, row.id).run();
  } else if (outcome.status === 'ambiguous') {
    await db.prepare(`
      UPDATE assessor_backfill_jobs
      SET status='ambiguous', matches_json=?, completed_at=datetime('now') WHERE id=?
    `).bind(outcome.matches_json, row.id).run();
  } else {
    // no_match
    await db.prepare(`
      UPDATE assessor_backfill_jobs SET status='no_match', completed_at=datetime('now') WHERE id=?
    `).bind(row.id).run();
    await db.prepare(`UPDATE ${table} SET assessor_last_synced_at = datetime('now') WHERE id = ?`).bind(row.record_id).run();
  }
  return true;
}
```

- [ ] **Step 4: Run pure tests, pass**

```bash
npx vitest run tests/sl-assessor.backfill.test.ts
```
Expected: 4 tests pass (pure helpers only — `processBackfillTick` is integration-tested manually).

- [ ] **Step 5: Commit**

```bash
git add src/utils/sl-assessor/backfill.ts tests/sl-assessor.backfill.test.ts
git commit -m "feat(assessor): processBackfillTick + outcome decider"
```

---

### Task 14: Wire tick into `scheduled()` handler

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import + dispatch from the per-minute scheduled handler**

Open [`src/index.ts`](src/index.ts), find the `scheduled()` handler (~line 334), and add inside it:

```ts
import { processBackfillTick } from './utils/sl-assessor/backfill';
// (add to the import block at the top)

// inside async scheduled(event, env, ctx):
ctx.waitUntil(
  processBackfillTick(env)
    .then((n) => { if (n) console.log(`[assessor-backfill] processed ${n} jobs`); })
    .catch((e) => console.error('[assessor-backfill] tick failed:', e)),
);
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(assessor): dispatch backfill tick from scheduled() every other minute"
```

---

### Task 15: Backfill UI — banner + button

**Files:**
- Create: `client/src/components/AssessorReviewQueueBanner.tsx`
- Create: `client/src/components/AssessorBackfillButton.tsx`
- Modify: `client/src/pages/RecordsPage.tsx` (or whichever component renders `/records`)
- Modify: `client/public/sw.js` (bump again)

- [ ] **Step 1: Backfill button**

```tsx
// client/src/components/AssessorBackfillButton.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

interface Status {
  pending: number; applied: number; ambiguous: number;
  no_match: number; error: number; unfetchable: number; total: number;
}

export function AssessorBackfillButton({ isAdminOrManager }: { isAdminOrManager: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [queuing, setQueuing] = useState(false);
  useEffect(() => {
    if (!isAdminOrManager) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await apiFetch<Status>('/assessor/backfill/status');
        if (live) setStatus(s);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { live = false; clearInterval(id); };
  }, [isAdminOrManager]);
  if (!isAdminOrManager) return null;

  async function runBackfill() {
    setQueuing(true);
    try {
      const r = await apiFetch<{ queued: number; total_target: number }>(
        '/assessor/backfill', { method: 'POST', body: JSON.stringify({}) },
      );
      alert(`Queued ${r.queued} records (${r.total_target} eligible). Backfill runs in background.`);
    } finally { setQueuing(false); }
  }

  const done = status ? status.applied + status.no_match + status.error + status.unfetchable : 0;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={queuing}
        onClick={runBackfill}
        className="px-2 py-1 bg-brand-500 text-rmpg-900 text-xs">
        🏠 Backfill from SL Assessor ↻
      </button>
      {status && status.total > 0 && (
        <div className="text-xs text-rmpg-400">
          {done}/{status.total} done
          {status.ambiguous > 0 && <> · {status.ambiguous} need review</>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Review-queue banner**

```tsx
// client/src/components/AssessorReviewQueueBanner.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import { AssessorSuggestionPanel } from './AssessorSuggestionPanel';
import type { ParcelSummary } from '../hooks/useAssessorLookup';

interface Row {
  id: number; record_type: 'business' | 'property'; record_id: number;
  record_label: string; matches: ParcelSummary[];
}

export function AssessorReviewQueueBanner() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  async function load() {
    try {
      const r = await apiFetch<{ rows: Row[] }>('/assessor/review-queue');
      setRows(r.rows);
    } catch { setRows([]); }
  }
  useEffect(() => { load(); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="border border-surface-raised bg-surface-base p-2 mb-2">
      <div className="font-semibold text-brand-400 text-xs mb-1">
        🏠 {rows.length} record{rows.length === 1 ? '' : 's'} need parcel review
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="text-xs">
            <button
              type="button"
              onClick={() => setExpanded((x) => x === r.id ? null : r.id)}
              className="text-rmpg-200 hover:text-brand-400">
              {r.record_label} · {r.matches.length} parcels → Pick parcel
            </button>
            {expanded === r.id && (
              <AssessorSuggestionPanel
                parcels={r.matches}
                onApply={async (parcelNumber) => {
                  await apiFetch('/assessor/apply', {
                    method: 'POST',
                    body: JSON.stringify({
                      record_type: r.record_type, record_id: r.record_id, parcel_number: parcelNumber,
                    }),
                  });
                  await load();
                  setExpanded(null);
                }}
                onDismiss={() => setExpanded(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount on `/records`**

Open the existing `/records` page (most likely `client/src/pages/RecordsPage.tsx`; verify with `grep -l 'records' client/src/pages/*.tsx`). Add at the top of its render, above the existing content:

```tsx
import { AssessorBackfillButton } from '../components/AssessorBackfillButton';
import { AssessorReviewQueueBanner } from '../components/AssessorReviewQueueBanner';

// ... inside JSX:
const userRole = /* however the page reads the current user role */;
<>
  <AssessorReviewQueueBanner />
  <div className="flex justify-end mb-1">
    <AssessorBackfillButton isAdminOrManager={userRole === 'admin' || userRole === 'manager'} />
  </div>
  {/* existing tab content */}
</>
```

If the page already has a header toolbar, slot the button into the existing toolbar instead.

- [ ] **Step 4: Bump SW cache name (final bump for this PR)**

```bash
# In client/public/sw.js, increment CACHE_NAME again.
```

- [ ] **Step 5: Client typecheck + build**

```bash
cd client && npx tsc --noEmit && npx vite build
```
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/AssessorBackfillButton.tsx \
        client/src/components/AssessorReviewQueueBanner.tsx \
        client/src/pages/RecordsPage.tsx \
        client/public/sw.js
git commit -m "feat(records): backfill button + review-queue banner on /records"
```

---

## Pre-PR verification

- [ ] **Step 1: Full local test sweep**

```bash
npm run typecheck && (cd client && npx tsc --noEmit && npx vitest run && npx vite build) && npx vitest run tests/
```
Expected: everything green.

- [ ] **Step 2: Local smoke**

```bash
npm run dev &
# Visit http://localhost:5173/records and exercise:
#  - New Business form: type real SLC address → blur → panel appears
#  - Pick a parcel → Apply → fields populate
#  - Save the record → reload → fields persisted
#  - Backfill button (admin) → status banner ticks → review queue shows ambiguous rows
```

- [ ] **Step 3: Create PR**

```bash
gh pr create --title "feat(records): Salt Lake County Assessor cross-reference" --body "$(cat <<'EOF'
## Summary
- New Business + Property records (and existing ones via backfill) auto-cross-reference Salt Lake County Assessor parcels.
- 13 new columns on `businesses` + `properties`, plus `parcel_records`, `parcel_sales`, `assessor_backfill_jobs` tables.
- Never-clobber autofill rule — user-typed values are not overwritten.
- Backfill rides the existing `* * * * *` cron, gated to every other tick (30 lookups/min cap).

## Spec
[docs/superpowers/specs/2026-06-21-sl-county-assessor-integration-design.md](docs/superpowers/specs/2026-06-21-sl-county-assessor-integration-design.md)

## Test plan
- [ ] Worker + client typecheck pass
- [ ] All new vitest suites green
- [ ] Local: enter a real SLC address in BusinessTab → parcel panel appears → Apply populates form
- [ ] Local: backfill button (admin) → status banner ticks → ambiguous queue surfaces multi-parcel rows
- [ ] After merge: apply `0134_assessor_integration.sql` directly to live D1 `785de7ae`
- [ ] After merge: verify each new column via `pragma_table_info('businesses')` + `pragma_table_info('properties')`
- [ ] After merge: browser smoke at https://rmpgutah.us/records (WAF challenge needs real browser)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge

- [ ] **Apply migration directly to live D1** (per CLAUDE.md rule #5):

```bash
# Use the Cloudflare D1 API for live db 785de7ae-3e7a-4e01-93bb-d24ddd813f6b
# (or `wrangler d1 execute rmpg-flex --remote --file migrations/0134_assessor_integration.sql`)
```

- [ ] **Verify column landing**:

```bash
wrangler d1 execute rmpg-flex --remote --command \
  "SELECT name FROM pragma_table_info('businesses') WHERE name LIKE 'parcel_%' OR name LIKE 'assessor_%';"
```
Expected: 13 rows.

- [ ] **Browser smoke** at https://rmpgutah.us/records — Cloudflare WAF managed challenge requires a real browser; CLI curl will 403.

- [ ] **Update memory** (`MEMORY.md` index + a new topic file) with the live state.
