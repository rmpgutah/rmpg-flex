# Multi-County Assessor Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the live Salt Lake County Assessor auto-fill system to Utah County, Summit County (full field set), and Tooele County (narrower recorder-only field set), routed automatically by the county implied by a record's address.

**Architecture:** Extract the shared `Parcel`/`ParcelSummary`/`ParcelSale`/error types out of `sl-assessor/` into a county-agnostic `parcel-lookup/` module. Add three new self-contained county packages (`utah-assessor/`, `summit-assessor/`, `tooele-assessor/`) that each implement the same `searchByAddress`/`getParcel` interface as the existing `sl-assessor/client.ts`. A new `resolveCountyFromAddress()` router picks which package to call. `src/routes/assessor.ts` and the backfill cron dispatch through the router instead of calling SL Co directly.

**Tech Stack:** Hono route (`src/routes/assessor.ts`), Cloudflare D1 (`parcel_records`/`parcel_sales`/`assessor_backfill_jobs`), Cloudflare KV (30-day cache), regex-based HTML parsing (no DOM library — Workers-safe), Vitest for unit tests.

---

## Reference: existing SL Co code being mirrored

Every new county package must match this shape (already live in `src/utils/sl-assessor/`):
- `types.ts` — re-exports from the new shared module (Task 1).
- `cache.ts` — `normalizeAddress`, `cacheKeyParcels`, `cacheKeyParcel`, `durableKeyParcels`, `durableKeyParcel`, `getCached`, `putCached`, `putCachedDurable`, `invalidate`. Identical logic, just a separate file per county (matches existing precedent of no cross-county sharing).
- `client.ts` — exports `searchByAddress(env, address): Promise<ParcelSummary[]>` and `getParcel(env, parcelNo): Promise<Parcel>`.
- `parser.ts` — exports `parseParcelList(html): ParcelSummary[]` and `parseParcelDetail(html): Parcel`.

## Task 1: Extract shared parcel-lookup types

**Files:**
- Create: `src/utils/parcel-lookup/types.ts`
- Modify: `src/utils/sl-assessor/types.ts`
- Test: `tests/parcelLookupTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/parcelLookupTypes.test.ts
import { describe, it, expect } from 'vitest';
import { AssessorError, AssessorConfigError, AssessorHttpError, AssessorParseError, AssessorTimeoutError } from '../src/utils/parcel-lookup/types';
import { AssessorError as SlAssessorError } from '../src/utils/sl-assessor/types';

describe('parcel-lookup shared types', () => {
  it('re-exports the same error classes sl-assessor uses', () => {
    expect(AssessorError).toBe(SlAssessorError);
  });

  it('AssessorHttpError carries status + message', () => {
    const e = new AssessorHttpError(404, 'not found');
    expect(e.status).toBe(404);
    expect(e.message).toBe('not found');
    expect(e).toBeInstanceOf(AssessorError);
  });

  it('AssessorParseError carries an optional excerpt', () => {
    const e = new AssessorParseError('bad html', '<div>...</div>');
    expect(e.excerpt).toBe('<div>...</div>');
  });

  it('AssessorConfigError has a default message', () => {
    const e = new AssessorConfigError();
    expect(e.message).toMatch(/FIRECRAWL_API_KEY/);
  });

  it('AssessorTimeoutError is a distinct subclass', () => {
    const e = new AssessorTimeoutError('timed out');
    expect(e.name).toBe('AssessorTimeoutError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parcelLookupTypes.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/parcel-lookup/types'`

- [ ] **Step 3: Create the shared types module**

```ts
// src/utils/parcel-lookup/types.ts
// County-agnostic parcel types shared by every county's assessor/recorder
// package (sl-assessor, utah-assessor, summit-assessor, tooele-assessor).
// Each county package's own types.ts re-exports from here so the ~40
// existing sl-assessor call sites don't need to change their import paths.

export type OwnerType = 'individual' | 'entity' | 'mixed' | 'unknown';

export type ParcelSource =
  | 'sl_county_assessor'
  | 'utah_county_assessor'
  | 'summit_county_assessor'
  | 'tooele_county_recorder';

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
  source: ParcelSource;
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
  /** Recorder-only counties (Tooele) populate this; assessor counties leave it null. */
  recorded_document_url: string | null;
  recorded_document_type: string | null;
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

- [ ] **Step 4: Point sl-assessor/types.ts at the shared module**

Replace the entire contents of `src/utils/sl-assessor/types.ts` with:

```ts
// src/utils/sl-assessor/types.ts
// Salt Lake County re-exports the shared parcel-lookup types so existing
// call sites (40+ files) don't need import-path churn. New code should
// import directly from '../parcel-lookup/types'.
export type {
  OwnerType,
  ParcelSource,
  ParcelSummary,
  ParcelSale,
  Parcel,
} from '../parcel-lookup/types';
export {
  AssessorError,
  AssessorConfigError,
  AssessorTimeoutError,
  AssessorHttpError,
  AssessorParseError,
} from '../parcel-lookup/types';
```

- [ ] **Step 5: Update sl-assessor/parser.ts's literal `source` assignment and add the two new Parcel fields**

`src/utils/sl-assessor/parser.ts` currently has (around the `parseParcelDetail` return object):
```ts
    source: 'sl_county_assessor',
```
This is unchanged — `'sl_county_assessor'` is still a valid `ParcelSource` value. But the object literal must also set the two new fields so it satisfies the `Parcel` interface. Find the return object in `parseParcelDetail` (it ends with `raw_data_json: ...,\n  };`) and add immediately before `raw_data_json`:

```ts
    recorded_document_url: null,
    recorded_document_type: null,
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors — `sl-assessor/parser.ts` now satisfies the extended `Parcel` shape)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/parcelLookupTypes.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 8: Run the full existing sl-assessor test suite to confirm no regression**

Run: `npx vitest run tests/slAssessor*.test.ts tests/assessorAutofill*.test.ts 2>/dev/null || npx vitest run tests/ -t "assessor"`
Expected: all previously-passing SL Co assessor tests still PASS

- [ ] **Step 9: Commit**

```bash
git add src/utils/parcel-lookup/types.ts src/utils/sl-assessor/types.ts src/utils/sl-assessor/parser.ts tests/parcelLookupTypes.test.ts
git commit -m "refactor: extract shared parcel-lookup types from sl-assessor"
```

---

## Task 2: Schema migration for multi-county fields

**Files:**
- Create: `migrations/0157_multi_county_parcel_fields.sql`
- Modify: `src/utils/db.ts` (`ensureAssessorColumns`)
- Test: `tests/dbEnsureAssessorColumns.test.ts`

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/0157_multi_county_parcel_fields.sql
-- Adds recorder-document link-out fields used by counties that only expose
-- a document index (Tooele) rather than full assessed-value data. NULL for
-- every other county's parcel_records rows.
ALTER TABLE parcel_records ADD COLUMN recorded_document_url TEXT;
ALTER TABLE parcel_records ADD COLUMN recorded_document_type TEXT;
```

- [ ] **Step 2: Apply locally and confirm columns land**

Run: `npm run migrate:local`
Run: `wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(parcel_records)"`
Expected: output includes rows for `recorded_document_url` and `recorded_document_type`

- [ ] **Step 3: Write the failing reconciler test**

```ts
// tests/dbEnsureAssessorColumns.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureAssessorColumns, columnExists } from '../src/utils/db';

describe('ensureAssessorColumns — multi-county fields', () => {
  it('adds recorded_document_url and recorded_document_type to parcel_records', async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parcel_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parcel_number TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'sl_county_assessor'
    )`).run();
    await ensureAssessorColumns(env.DB);
    expect(await columnExists(env.DB, 'parcel_records', 'recorded_document_url')).toBe(true);
    expect(await columnExists(env.DB, 'parcel_records', 'recorded_document_type')).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts tests/dbEnsureAssessorColumns.test.ts`
Expected: FAIL — columns don't exist yet

- [ ] **Step 5: Update the reconciler**

In `src/utils/db.ts`, find the `CREATE TABLE IF NOT EXISTS parcel_records (...)` block inside `ensureAssessorColumns` (around line 99-143) and add the two new columns to the inline DDL, right before `raw_data_json TEXT,`:

```sql
      recorded_document_url TEXT,
      recorded_document_type TEXT,
      raw_data_json TEXT,
```

Then, immediately after the `parcel_records`/`parcel_sales`/`assessor_backfill_jobs` `CREATE TABLE IF NOT EXISTS` try/catch blocks (right before the `// ── Columns on existing tables ──` comment for `ASSESSOR_COLUMNS`), add a second reconciliation loop for `parcel_records`-only columns (these can't go in `ASSESSOR_COLUMNS` because that array is typed for `businesses`/`properties` only in existing call sites — but the same loop shape works for any table):

```ts
  // ── parcel_records-only columns (multi-county additions, mig 0157) ──
  const PARCEL_RECORD_COLUMNS: Array<[string, string]> = [
    ['recorded_document_url', 'TEXT'],
    ['recorded_document_type', 'TEXT'],
  ];
  for (const [col, type] of PARCEL_RECORD_COLUMNS) {
    try {
      if (!(await columnExists(db, 'parcel_records', col))) {
        await db.prepare(`ALTER TABLE parcel_records ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts tests/dbEnsureAssessorColumns.test.ts`
Expected: PASS

- [ ] **Step 7: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add migrations/0157_multi_county_parcel_fields.sql src/utils/db.ts tests/dbEnsureAssessorColumns.test.ts
git commit -m "feat(assessor): add recorded_document_url/type columns for recorder-only counties"
```

---

## Task 3: County resolution router

**Files:**
- Create: `src/utils/parcel-lookup/router.ts`
- Test: `tests/parcelLookupRouter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/parcelLookupRouter.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCountyFromAddress } from '../src/utils/parcel-lookup/router';

describe('resolveCountyFromAddress', () => {
  it('resolves Salt Lake County cities', () => {
    expect(resolveCountyFromAddress('123 Main St, Salt Lake City, UT 84101')).toBe('salt_lake');
    expect(resolveCountyFromAddress('456 State St, Sandy, UT 84070')).toBe('salt_lake');
    expect(resolveCountyFromAddress('789 900 E, West Jordan, UT')).toBe('salt_lake');
  });

  it('resolves Utah County cities', () => {
    expect(resolveCountyFromAddress('100 E Center St, American Fork, UT 84003')).toBe('utah');
    expect(resolveCountyFromAddress('200 N University Ave, Provo, UT 84601')).toBe('utah');
    expect(resolveCountyFromAddress('300 State St, Orem, UT')).toBe('utah');
  });

  it('resolves Summit County cities', () => {
    expect(resolveCountyFromAddress('50 Main St, Park City, UT 84060')).toBe('summit');
    expect(resolveCountyFromAddress('10 Rasmussen Rd, Coalville, UT')).toBe('summit');
  });

  it('resolves Tooele County cities', () => {
    expect(resolveCountyFromAddress('47 S Main St, Tooele, UT 84074')).toBe('tooele');
    expect(resolveCountyFromAddress('1 Center St, Grantsville, UT')).toBe('tooele');
  });

  it('falls back to ZIP prefix when no known city token matches', () => {
    expect(resolveCountyFromAddress('123 Some Rd, 84101')).toBe('salt_lake');
    expect(resolveCountyFromAddress('123 Some Rd, 84003')).toBe('utah');
    expect(resolveCountyFromAddress('123 Some Rd, 84060')).toBe('summit');
    expect(resolveCountyFromAddress('123 Some Rd, 84074')).toBe('tooele');
  });

  it('returns unsupported for Davis County and out-of-area addresses', () => {
    expect(resolveCountyFromAddress('1 Main St, Layton, UT 84041')).toBe('unsupported');
    expect(resolveCountyFromAddress('1 Main St, Bountiful, UT')).toBe('unsupported');
    expect(resolveCountyFromAddress('1 Main St, Anywhere, TX 75001')).toBe('unsupported');
  });

  it('returns unsupported for empty or garbage input', () => {
    expect(resolveCountyFromAddress('')).toBe('unsupported');
    expect(resolveCountyFromAddress('   ')).toBe('unsupported');
  });

  it('is case-insensitive on city names', () => {
    expect(resolveCountyFromAddress('1 Main St, PROVO, ut')).toBe('utah');
    expect(resolveCountyFromAddress('1 Main St, provo, UT')).toBe('utah');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parcelLookupRouter.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/parcel-lookup/router'`

- [ ] **Step 3: Implement the router**

```ts
// src/utils/parcel-lookup/router.ts
// Resolves which county's assessor/recorder package should handle a given
// address. Closed, hardcoded city lists per county (each county's own
// address-search form enumerates its incorporated cities/districts, so
// this is a small, stable set — not a general geocoder). ZIP-prefix is a
// fallback for addresses that don't carry a recognizable city token.
//
// Returns 'unsupported' (never guesses) for anything outside the four
// covered counties — this includes Davis County, which is deliberately
// NOT covered pending a separate spike (see docs/superpowers/specs/
// 2026-07-14-multi-county-assessor-design.md).

export type County = 'salt_lake' | 'utah' | 'summit' | 'tooele' | 'unsupported';

const SALT_LAKE_CITIES = [
  'salt lake city', 'west valley city', 'west jordan', 'sandy', 'south jordan',
  'taylorsville', 'murray', 'draper', 'riverton', 'midvale', 'cottonwood heights',
  'holladay', 'south salt lake', 'herriman', 'bluffdale', 'millcreek',
  'magna', 'kearns', 'copperton', 'alta', 'brighton', 'emigration canyon',
];

const UTAH_COUNTY_CITIES = [
  'alpine', 'american fork', 'benjamin', 'birdseye', 'cedar fort', 'cedar hills',
  'cedar valley', 'colton', 'covered bridge', 'diamond fork canyon', 'draper',
  'eagle mountain', 'elberta', 'elk ridge', 'eureka', 'fairfield', 'fairview',
  'genola', 'goshen', 'highland', 'lake shore', 'lehi', 'leland', 'lindon',
  'mapleton', 'orem', 'palmyra', 'payson', 'pleasant grove', 'provo',
  'salem', 'santaquin', 'saratoga springs', 'spanish fork', 'spring lake',
  'springville', 'sundance', 'thistle', 'vineyard', 'west mountain', 'woodland hills',
];

const SUMMIT_COUNTY_CITIES = [
  'park city', 'coalville', 'kamas', 'oakley', 'francis', 'henefer', 'echo',
  'snyderville', 'kimball junction', 'hideout',
];

const TOOELE_COUNTY_CITIES = [
  'tooele', 'grantsville', 'stansbury park', 'erda', 'lake point',
  'stockton', 'rush valley', 'ophir', 'vernon', 'wendover',
];

// ZIP prefixes are a fallback only — checked after city-name matching fails.
// Not exhaustive; covers the primary ZIP3 ranges for each county's cities above.
const ZIP_PREFIX_TO_COUNTY: Record<string, County> = {
  '841': 'salt_lake', // covers most of SLCo + parts of Utah/Davis/Tooele — resolved further below
  '840': 'utah',
};

const ZIP5_TO_COUNTY: Record<string, County> = {
  '84003': 'utah', '84601': 'utah', '84604': 'utah', '84058': 'utah', '84097': 'utah',
  '84042': 'utah', '84043': 'utah', '84045': 'utah', '84062': 'utah', '84651': 'utah',
  '84060': 'summit', '84098': 'summit', '84036': 'summit', '84017': 'summit', '84033': 'summit',
  '84074': 'tooele', '84029': 'tooele', '84044': 'tooele', '84083': 'tooele',
  '84101': 'salt_lake', '84070': 'salt_lake', '84088': 'salt_lake', '84081': 'salt_lake',
  '84084': 'salt_lake', '84020': 'salt_lake', '84065': 'salt_lake', '84092': 'salt_lake',
  '84093': 'salt_lake', '84094': 'salt_lake', '84095': 'salt_lake', '84096': 'salt_lake',
  '84118': 'salt_lake', '84119': 'salt_lake', '84120': 'salt_lake', '84121': 'salt_lake',
  '84123': 'salt_lake', '84128': 'salt_lake',
};

function containsCity(haystack: string, cities: string[]): boolean {
  return cities.some((c) => haystack.includes(c));
}

export function resolveCountyFromAddress(address: string): County {
  const normalized = (address ?? '').toLowerCase().trim();
  if (!normalized) return 'unsupported';

  if (containsCity(normalized, SALT_LAKE_CITIES)) return 'salt_lake';
  if (containsCity(normalized, UTAH_COUNTY_CITIES)) return 'utah';
  if (containsCity(normalized, SUMMIT_COUNTY_CITIES)) return 'summit';
  if (containsCity(normalized, TOOELE_COUNTY_CITIES)) return 'tooele';

  const zipMatch = normalized.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip5 = zipMatch[1];
    if (ZIP5_TO_COUNTY[zip5]) return ZIP5_TO_COUNTY[zip5];
    const zip3 = zip5.slice(0, 3);
    if (ZIP_PREFIX_TO_COUNTY[zip3]) return ZIP_PREFIX_TO_COUNTY[zip3];
  }

  return 'unsupported';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parcelLookupRouter.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/parcel-lookup/router.ts tests/parcelLookupRouter.test.ts
git commit -m "feat(assessor): add county resolution router for multi-county lookup"
```

---

## Task 4: Utah County assessor package

**Files:**
- Create: `src/utils/utah-assessor/cache.ts`
- Create: `src/utils/utah-assessor/parser.ts`
- Create: `src/utils/utah-assessor/client.ts`
- Create: `tests/fixtures/utah-assessor/README.md`
- Create: `tests/fixtures/utah-assessor/detail-single.html`
- Test: `tests/utahAssessorParser.test.ts`

- [ ] **Step 1: Copy cache.ts verbatim with renamed cache-key prefix**

```ts
// src/utils/utah-assessor/cache.ts
// Identical normalization/cache strategy to sl-assessor/cache.ts, namespaced
// under 'utah_assessor:' keys so the two counties' KV entries never collide.

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const tokens = s.split(' ').map((t) => {
    if (DIRECTIONALS[t]) return DIRECTIONALS[t];
    if (STREET_TYPES[t]) return STREET_TYPES[t];
    return t;
  });
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `utah_assessor:parcels:${normalizeAddress(addr)}`;
}
export function cacheKeyParcel(parcelNo: string): string {
  return `utah_assessor:parcel:${parcelNo}`;
}
export function durableKeyParcels(addr: string): string {
  return `utah_assessor:parcels:durable:${normalizeAddress(addr)}`;
}
export function durableKeyParcel(parcelNo: string): string {
  return `utah_assessor:parcel:durable:${parcelNo}`;
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
export async function putCachedDurable<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}
export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
```

- [ ] **Step 2: Write the fixture README + synthetic detail fixture**

```markdown
<!-- tests/fixtures/utah-assessor/README.md -->
# Utah County Assessor fixtures

These HTML files are **synthetic** — hand-authored to match the label/value
table structure of Utah County's ASP-based Land Records detail page
(`PropertyForm.asp?serial_no=<n>`), NOT real captures. The live site needs a
browser session Vitest's environment can't replicate headlessly.

The parser (`src/utils/utah-assessor/parser.ts`) is deliberately tolerant —
label-driven `pullByLabel(html, regex)` extraction plus a raw key/value
catch-all into `raw_data_json` — so swapping these for real captures later
should not require parser rewrites, only fixture replacement.

To capture a real one: open a serial number's detail page in a browser,
View Source, save as `detail-single.html`, and diff against this synthetic
version to see what regexes need adjusting.
```

```html
<!-- tests/fixtures/utah-assessor/detail-single.html -->
<html><body>
<table>
  <tr><td>Serial Number:</td><td>12:345:0067</td></tr>
  <tr><td>Owner Name:</td><td>SMITH JOHN A</td></tr>
  <tr><td>Mailing Address:</td><td>100 E CENTER ST AMERICAN FORK UT 84003</td></tr>
  <tr><td>Property Address:</td><td>100 E CENTER ST</td></tr>
  <tr><td>City:</td><td>AMERICAN FORK</td></tr>
  <tr><td>Zip:</td><td>84003</td></tr>
  <tr><td>Tax District:</td><td>AF01</td></tr>
  <tr><td>Acreage:</td><td>0.25</td></tr>
  <tr><td>Total Value:</td><td>$412,300</td></tr>
  <tr><td>Land Value:</td><td>$120,000</td></tr>
  <tr><td>Year Built:</td><td>1998</td></tr>
  <tr><td>Legal Description:</td><td>LOT 4 PLAT B AMERICAN FORK</td></tr>
  <tr><td>Last Sale Date:</td><td>03/14/2021</td></tr>
  <tr><td>Last Sale Price:</td><td>$389,000</td></tr>
</table>
</body></html>
```

- [ ] **Step 3: Write the failing parser test**

```ts
// tests/utahAssessorParser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/utah-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/utah-assessor/detail-single.html'), 'utf-8',
);

describe('utah-assessor parser', () => {
  it('parses the detail page into a Parcel', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('12:345:0067');
    expect(parcel.source).toBe('utah_county_assessor');
    expect(parcel.owner_of_record).toBe('SMITH JOHN A');
    expect(parcel.owner_type).toBe('individual');
    expect(parcel.situs_address).toBe('100 E CENTER ST');
    expect(parcel.situs_city).toBe('AMERICAN FORK');
    expect(parcel.situs_zip).toBe('84003');
    expect(parcel.tax_district).toBe('AF01');
    expect(parcel.land_acres).toBe(0.25);
    expect(parcel.market_value_total).toBe(412300);
    expect(parcel.market_value_land).toBe(120000);
    expect(parcel.year_built).toBe(1998);
    expect(parcel.legal_description).toBe('LOT 4 PLAT B AMERICAN FORK');
    expect(parcel.sales).toHaveLength(1);
    expect(parcel.sales[0].sale_date).toBe('2021-03-14');
    expect(parcel.sales[0].sale_price).toBe(389000);
  });

  it('infers entity owner type from LLC/INC/TRUST suffixes', () => {
    const html = detailHtml.replace('SMITH JOHN A', 'MOUNTAIN VIEW HOLDINGS LLC');
    const parcel = parseParcelDetail(html);
    expect(parcel.owner_type).toBe('entity');
  });

  it('captures every label/value pair into raw_data_json', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.raw_data_json['Serial Number']).toBe('12:345:0067');
    expect(parcel.raw_data_json['Tax District']).toBe('AF01');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/utahAssessorParser.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/utah-assessor/parser'`

- [ ] **Step 5: Implement the parser**

```ts
// src/utils/utah-assessor/parser.ts
// Tolerant label-driven parser for Utah County's ASP Land Records detail
// page. No DOM library (Workers don't ship cheerio/jsdom) — every field is
// pulled via a label→value regex, and every row is also captured into
// raw_data_json for forward-compat with fields we haven't typed yet.

import type { Parcel, ParcelSummary, OwnerType } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

const ENTITY_MARKERS = /\b(LLC|INC|CORP|TRUST|LP|LLP|LTD|CO)\b/i;

function inferOwnerType(name: string | null): OwnerType {
  if (!name) return 'unknown';
  return ENTITY_MARKERS.test(name) ? 'entity' : 'individual';
}

/** Pull every `<td>Label:</td><td>Value</td>` row into a flat map. */
function extractRows(html: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const re = /<td>\s*([^<:]+):\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label) rows[label] = value;
  }
  return rows;
}

function toNumber(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateIso(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export function parseParcelDetail(html: string): Parcel {
  const rows = extractRows(html);
  const parcelNumber = rows['Serial Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Serial Number found in Utah County detail page', html.slice(0, 500));
  }

  const owner = rows['Owner Name'] ?? null;
  const saleDate = toDateIso(rows['Last Sale Date']);
  const salePrice = toNumber(rows['Last Sale Price']);

  return {
    parcel_number: parcelNumber,
    source: 'utah_county_assessor',
    source_url: '',
    account_number: null,
    serial_number: parcelNumber,
    tax_district: rows['Tax District'] ?? null,
    owner_of_record: owner,
    owner_type: inferOwnerType(owner),
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: rows['Property Address'] ?? null,
    situs_city: rows['City'] ?? null,
    situs_zip: rows['Zip'] ?? null,
    subdivision: null,
    land_acres: toNumber(rows['Acreage']),
    land_sqft: null,
    land_value: toNumber(rows['Land Value']),
    zoning: null,
    year_built: toNumber(rows['Year Built']),
    effective_year_built: null,
    total_bldg_sqft: null,
    finished_sqft: null,
    basement_sqft: null,
    garage_sqft: null,
    stories: null,
    bedrooms: null,
    bathrooms: null,
    construction_type: null,
    improvement_class: null,
    improvement_value: null,
    market_value_total: toNumber(rows['Total Value']),
    market_value_land: toNumber(rows['Land Value']),
    market_value_improvement: null,
    taxable_value: null,
    assessed_value: null,
    tax_year: null,
    legal_description: rows['Legal Description'] ?? null,
    plat: null,
    lot: null,
    block: null,
    recorded_document_url: null,
    recorded_document_type: null,
    sales: saleDate || salePrice ? [{
      sale_date: saleDate,
      sale_price: salePrice,
      doc_number: null,
      buyer: owner,
      seller: null,
      sale_type: null,
    }] : [],
    raw_data_json: rows,
  };
}

/** Multi-result list page — same row-table shape, one row per parcel. */
export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([\d:]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: m[3].trim() || null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://www.utahcounty.gov/LandRecords/PropertyForm.asp?serial_no=${m[1].trim()}`,
    });
  }
  return results;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/utahAssessorParser.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Implement the client**

```ts
// src/utils/utah-assessor/client.ts
// Worker-safe Utah County Land Records client. Classic ASP form at
// AddressSearchForm.asp POSTs to itself and either shows a results table
// (multi-match) or redirects straight to PropertyForm.asp (single match).
// Detail-by-serial-number: GET PropertyForm.asp?serial_no=<n> directly,
// no session required — same shape as SL Co's valuationInfoExpanded.cfm.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://www.utahcounty.gov/LandRecords';
const SEARCH_URL = `${BASE}/AddressSearchForm.asp`;
const DETAIL_BASE = `${BASE}/PropertyForm.asp`;
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface UtahAssessorEnv { FIRECRAWL_API_KEY?: string; }

interface AddressParts { number: string; direction: string; street: string; type: string; }

/** Split "100 E Center St" into the form's Number/Direction/Street/Type fields. */
export function parseUtahAddressParts(address: string): AddressParts {
  const tokens = address.toUpperCase().replace(/,.*$/, '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const number = /^\d+$/.test(tokens[i] ?? '') ? tokens[i++] : '';
  const DIRS = new Set(['N', 'S', 'E', 'W']);
  let direction = '';
  if (DIRS.has(tokens[i] ?? '')) direction = tokens[i++];
  const rest = tokens.slice(i);
  const last = rest[rest.length - 1] ?? '';
  const TYPES = new Set(['ST', 'RD', 'DR', 'CR', 'WY', 'LN', 'AV', 'BL', 'CT', 'PK', 'PL', 'TR']);
  let type = '';
  let street = rest.join(' ');
  if (TYPES.has(last)) {
    type = last;
    street = rest.slice(0, -1).join(' ');
  }
  return { number, direction, street, type };
}

export function buildQueryUrl(address: string): string {
  return `${SEARCH_URL}?address=${encodeURIComponent(address)}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, `Utah County request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Utah County request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Utah County request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: UtahAssessorEnv, address: string): Promise<ParcelSummary[]> {
  const parts = parseUtahAddressParts(address);
  const body = new URLSearchParams({
    txtNum: parts.number, cmbDir: parts.direction || '%',
    txtName: parts.street, cmbType: parts.type || '%', cmbCity: '%',
  });
  const res = await fetchWithTimeout(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const html = await res.text();
  if (res.url.includes('PropertyForm.asp')) {
    const parcel = parseParcelDetail(html);
    parcel.source_url = res.url;
    return [{
      parcel_number: parcel.parcel_number,
      owner_of_record: parcel.owner_of_record,
      situs_address: parcel.situs_address,
      land_sqft: parcel.land_sqft,
      total_market_value: parcel.market_value_total,
      detail_url: res.url,
    }];
  }
  return parseParcelList(html);
}

export async function getParcel(_env: UtahAssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = `${DETAIL_BASE}?serial_no=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
```

- [ ] **Step 8: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/utils/utah-assessor/ tests/fixtures/utah-assessor/ tests/utahAssessorParser.test.ts
git commit -m "feat(assessor): add Utah County assessor client and parser"
```

---

## Task 5: Summit County assessor package

**Files:**
- Create: `src/utils/summit-assessor/cache.ts`
- Create: `src/utils/summit-assessor/parser.ts`
- Create: `src/utils/summit-assessor/client.ts`
- Create: `tests/fixtures/summit-assessor/README.md`
- Create: `tests/fixtures/summit-assessor/detail-single.html`
- Test: `tests/summitAssessorParser.test.ts`

- [ ] **Step 1: Copy cache.ts with the `summit_assessor:` prefix**

```ts
// src/utils/summit-assessor/cache.ts
// Same normalization/cache strategy as sl-assessor/cache.ts, namespaced
// under 'summit_assessor:' keys.

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const tokens = s.split(' ').map((t) => DIRECTIONALS[t] ?? STREET_TYPES[t] ?? t);
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `summit_assessor:parcels:${normalizeAddress(addr)}`;
}
export function cacheKeyParcel(parcelNo: string): string {
  return `summit_assessor:parcel:${parcelNo}`;
}
export function durableKeyParcels(addr: string): string {
  return `summit_assessor:parcels:durable:${normalizeAddress(addr)}`;
}
export function durableKeyParcel(parcelNo: string): string {
  return `summit_assessor:parcel:durable:${parcelNo}`;
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
export async function putCachedDurable<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}
export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
```

- [ ] **Step 2: Write the fixture README + synthetic detail fixture**

```markdown
<!-- tests/fixtures/summit-assessor/README.md -->
# Summit County Assessor fixtures

Synthetic fixtures matching the label/value structure of Summit County's
Eagle Software TaxWeb detail page
(`property.summitcounty.org/eaglesoftware/taxweb/search.jsp`). Same
tolerant-parser caveat as `tests/fixtures/utah-assessor/README.md` and the
original SL Co fixtures — see that README for the real-capture procedure.
```

```html
<!-- tests/fixtures/summit-assessor/detail-single.html -->
<html><body>
<table>
  <tr><td>Account Number:</td><td>SC-00417-A</td></tr>
  <tr><td>Owner:</td><td>PARK CITY MOUNTAIN TRUST</td></tr>
  <tr><td>Mailing Address:</td><td>PO BOX 100 PARK CITY UT 84060</td></tr>
  <tr><td>Situs Address:</td><td>50 MAIN ST</td></tr>
  <tr><td>Situs City:</td><td>PARK CITY</td></tr>
  <tr><td>Situs Zip:</td><td>84060</td></tr>
  <tr><td>Tax Area:</td><td>PC-01</td></tr>
  <tr><td>Total Market Value:</td><td>$1,250,000</td></tr>
  <tr><td>Land Value:</td><td>$600,000</td></tr>
  <tr><td>Year Built:</td><td>2005</td></tr>
  <tr><td>Legal Description:</td><td>LOT 12 PARK CITY MEADOWS</td></tr>
  <tr><td>Last Sale Date:</td><td>07/02/2019</td></tr>
  <tr><td>Last Sale Price:</td><td>$1,100,000</td></tr>
</table>
</body></html>
```

- [ ] **Step 3: Write the failing parser test**

```ts
// tests/summitAssessorParser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/summit-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/summit-assessor/detail-single.html'), 'utf-8',
);

describe('summit-assessor parser', () => {
  it('parses the detail page into a Parcel', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('SC-00417-A');
    expect(parcel.source).toBe('summit_county_assessor');
    expect(parcel.owner_of_record).toBe('PARK CITY MOUNTAIN TRUST');
    expect(parcel.owner_type).toBe('entity');
    expect(parcel.situs_address).toBe('50 MAIN ST');
    expect(parcel.situs_city).toBe('PARK CITY');
    expect(parcel.situs_zip).toBe('84060');
    expect(parcel.tax_district).toBe('PC-01');
    expect(parcel.market_value_total).toBe(1250000);
    expect(parcel.market_value_land).toBe(600000);
    expect(parcel.year_built).toBe(2005);
    expect(parcel.legal_description).toBe('LOT 12 PARK CITY MEADOWS');
    expect(parcel.sales).toHaveLength(1);
    expect(parcel.sales[0].sale_date).toBe('2019-07-02');
    expect(parcel.sales[0].sale_price).toBe(1100000);
  });

  it('infers individual owner type when no entity marker is present', () => {
    const html = detailHtml.replace('PARK CITY MOUNTAIN TRUST', 'JONES MARY B');
    const parcel = parseParcelDetail(html);
    expect(parcel.owner_type).toBe('individual');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/summitAssessorParser.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/summit-assessor/parser'`

- [ ] **Step 5: Implement the parser**

```ts
// src/utils/summit-assessor/parser.ts
// Tolerant label-driven parser for Summit County's Eagle Software TaxWeb
// detail page. Same approach as utah-assessor/parser.ts — no DOM library,
// raw key/value catch-all into raw_data_json.

import type { Parcel, ParcelSummary, OwnerType } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

const ENTITY_MARKERS = /\b(LLC|INC|CORP|TRUST|LP|LLP|LTD|CO)\b/i;

function inferOwnerType(name: string | null): OwnerType {
  if (!name) return 'unknown';
  return ENTITY_MARKERS.test(name) ? 'entity' : 'individual';
}

function extractRows(html: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const re = /<td>\s*([^<:]+):\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label) rows[label] = value;
  }
  return rows;
}

function toNumber(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateIso(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export function parseParcelDetail(html: string): Parcel {
  const rows = extractRows(html);
  const parcelNumber = rows['Account Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Account Number found in Summit County detail page', html.slice(0, 500));
  }

  const owner = rows['Owner'] ?? null;
  const saleDate = toDateIso(rows['Last Sale Date']);
  const salePrice = toNumber(rows['Last Sale Price']);

  return {
    parcel_number: parcelNumber,
    source: 'summit_county_assessor',
    source_url: '',
    account_number: parcelNumber,
    serial_number: null,
    tax_district: rows['Tax Area'] ?? null,
    owner_of_record: owner,
    owner_type: inferOwnerType(owner),
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: rows['Situs Address'] ?? null,
    situs_city: rows['Situs City'] ?? null,
    situs_zip: rows['Situs Zip'] ?? null,
    subdivision: null,
    land_acres: null,
    land_sqft: null,
    land_value: toNumber(rows['Land Value']),
    zoning: null,
    year_built: toNumber(rows['Year Built']),
    effective_year_built: null,
    total_bldg_sqft: null,
    finished_sqft: null,
    basement_sqft: null,
    garage_sqft: null,
    stories: null,
    bedrooms: null,
    bathrooms: null,
    construction_type: null,
    improvement_class: null,
    improvement_value: null,
    market_value_total: toNumber(rows['Total Market Value']),
    market_value_land: toNumber(rows['Land Value']),
    market_value_improvement: null,
    taxable_value: null,
    assessed_value: null,
    tax_year: null,
    legal_description: rows['Legal Description'] ?? null,
    plat: null,
    lot: null,
    block: null,
    recorded_document_url: null,
    recorded_document_type: null,
    sales: saleDate || salePrice ? [{
      sale_date: saleDate,
      sale_price: salePrice,
      doc_number: null,
      buyer: owner,
      seller: null,
      sale_type: null,
    }] : [],
    raw_data_json: rows,
  };
}

export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([A-Za-z0-9-]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: m[3].trim() || null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://property.summitcounty.org/eaglesoftware/taxweb/search.jsp?account=${m[1].trim()}`,
    });
  }
  return results;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/summitAssessorParser.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Implement the client**

```ts
// src/utils/summit-assessor/client.ts
// Worker-safe Summit County Eagle Software TaxWeb client.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://property.summitcounty.org/eaglesoftware/taxweb';
const SEARCH_URL = `${BASE}/search.jsp`;
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface SummitAssessorEnv { FIRECRAWL_API_KEY?: string; }

export function buildQueryUrl(address: string): string {
  return `${SEARCH_URL}?address=${encodeURIComponent(address)}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, `Summit County request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Summit County request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Summit County request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: SummitAssessorEnv, address: string): Promise<ParcelSummary[]> {
  const url = `${SEARCH_URL}?type=address&q=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  if (html.includes('Account Number:')) {
    const parcel = parseParcelDetail(html);
    parcel.source_url = res.url;
    return [{
      parcel_number: parcel.parcel_number,
      owner_of_record: parcel.owner_of_record,
      situs_address: parcel.situs_address,
      land_sqft: parcel.land_sqft,
      total_market_value: parcel.market_value_total,
      detail_url: res.url,
    }];
  }
  return parseParcelList(html);
}

export async function getParcel(_env: SummitAssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = `${SEARCH_URL}?account=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
```

- [ ] **Step 8: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/utils/summit-assessor/ tests/fixtures/summit-assessor/ tests/summitAssessorParser.test.ts
git commit -m "feat(assessor): add Summit County assessor client and parser"
```

---

## Task 6: Tooele County recorder package (narrow field set)

**Files:**
- Create: `src/utils/tooele-assessor/cache.ts`
- Create: `src/utils/tooele-assessor/parser.ts`
- Create: `src/utils/tooele-assessor/client.ts`
- Create: `tests/fixtures/tooele-assessor/README.md`
- Create: `tests/fixtures/tooele-assessor/detail-single.html`
- Test: `tests/tooeleAssessorParser.test.ts`

- [ ] **Step 1: Copy cache.ts with the `tooele_recorder:` prefix**

```ts
// src/utils/tooele-assessor/cache.ts
// Same normalization/cache strategy as sl-assessor/cache.ts, namespaced
// under 'tooele_recorder:' keys (Tooele has no assessor valuation source —
// this package wraps the county Recorder's document index instead).

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const tokens = s.split(' ').map((t) => DIRECTIONALS[t] ?? STREET_TYPES[t] ?? t);
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `tooele_recorder:parcels:${normalizeAddress(addr)}`;
}
export function cacheKeyParcel(parcelNo: string): string {
  return `tooele_recorder:parcel:${parcelNo}`;
}
export function durableKeyParcels(addr: string): string {
  return `tooele_recorder:parcels:durable:${normalizeAddress(addr)}`;
}
export function durableKeyParcel(parcelNo: string): string {
  return `tooele_recorder:parcel:durable:${parcelNo}`;
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
export async function putCachedDurable<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}
export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
```

- [ ] **Step 2: Write the fixture README + synthetic detail fixture**

```markdown
<!-- tests/fixtures/tooele-assessor/README.md -->
# Tooele County Recorder fixtures

Tooele County's given URL (`property_records_search.php`) only links out to
a Tyler/Eagle Software e-recording document index — there is no separate
assessor valuation site. These synthetic fixtures match that document-index
page's structure: owner/grantee name, parcel/document cross-reference,
and a link to the recorded document image. No assessed value, year built,
or land square footage fields exist at this source — `parser.ts`
deliberately leaves those fields null rather than guessing.
```

```html
<!-- tests/fixtures/tooele-assessor/detail-single.html -->
<html><body>
<table>
  <tr><td>Parcel Number:</td><td>05-123-0-0045</td></tr>
  <tr><td>Grantee:</td><td>DOE JANE</td></tr>
  <tr><td>Mailing Address:</td><td>47 S MAIN ST TOOELE UT 84074</td></tr>
  <tr><td>Legal Description:</td><td>LOT 3 BLOCK 2 TOOELE TOWNSITE</td></tr>
  <tr><td>Document Type:</td><td>WARRANTY DEED</td></tr>
  <tr><td>Document Link:</td><td>https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521</td></tr>
</table>
</body></html>
```

- [ ] **Step 3: Write the failing parser test**

```ts
// tests/tooeleAssessorParser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/tooele-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/tooele-assessor/detail-single.html'), 'utf-8',
);

describe('tooele-assessor (recorder-only) parser', () => {
  it('parses the narrow field set from the document index page', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('05-123-0-0045');
    expect(parcel.source).toBe('tooele_county_recorder');
    expect(parcel.owner_of_record).toBe('DOE JANE');
    expect(parcel.owner_mailing_address).toBe('47 S MAIN ST TOOELE UT 84074');
    expect(parcel.legal_description).toBe('LOT 3 BLOCK 2 TOOELE TOWNSITE');
    expect(parcel.recorded_document_type).toBe('WARRANTY DEED');
    expect(parcel.recorded_document_url).toBe(
      'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    );
  });

  it('leaves assessed-value fields null — no such data source exists', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.market_value_total).toBeNull();
    expect(parcel.year_built).toBeNull();
    expect(parcel.land_sqft).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/tooeleAssessorParser.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/tooele-assessor/parser'`

- [ ] **Step 5: Implement the parser**

```ts
// src/utils/tooele-assessor/parser.ts
// Tooele County has no assessor valuation site at the given URL — only a
// Recorder document index (grantor/grantee, legal description, recorded
// document link). AUTOFILL_FIELDS in autofill.ts is deliberately a subset
// for this source; every value field this parser doesn't set stays null
// rather than being guessed.

import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

function extractRows(html: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const re = /<td>\s*([^<:]+):\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label) rows[label] = value;
  }
  return rows;
}

export function parseParcelDetail(html: string): Parcel {
  const rows = extractRows(html);
  const parcelNumber = rows['Parcel Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Parcel Number found in Tooele County recorder page', html.slice(0, 500));
  }

  return {
    parcel_number: parcelNumber,
    source: 'tooele_county_recorder',
    source_url: '',
    account_number: null,
    serial_number: null,
    tax_district: null,
    owner_of_record: rows['Grantee'] ?? null,
    owner_type: 'unknown',
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: null,
    situs_city: null,
    situs_zip: null,
    subdivision: null,
    land_acres: null,
    land_sqft: null,
    land_value: null,
    zoning: null,
    year_built: null,
    effective_year_built: null,
    total_bldg_sqft: null,
    finished_sqft: null,
    basement_sqft: null,
    garage_sqft: null,
    stories: null,
    bedrooms: null,
    bathrooms: null,
    construction_type: null,
    improvement_class: null,
    improvement_value: null,
    market_value_total: null,
    market_value_land: null,
    market_value_improvement: null,
    taxable_value: null,
    assessed_value: null,
    tax_year: null,
    legal_description: rows['Legal Description'] ?? null,
    plat: null,
    lot: null,
    block: null,
    recorded_document_url: rows['Document Link'] ?? null,
    recorded_document_type: rows['Document Type'] ?? null,
    sales: [],
    raw_data_json: rows,
  };
}

export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([\d-]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://erecording.tooeleco.gov/eaglesoftware/web/?parcel=${m[1].trim()}`,
    });
  }
  return results;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/tooeleAssessorParser.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Implement the client**

```ts
// src/utils/tooele-assessor/client.ts
// Worker-safe Tooele County Recorder e-recording client.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://erecording.tooeleco.gov/eaglesoftware/web';
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface TooeleRecorderEnv { FIRECRAWL_API_KEY?: string; }

export function buildQueryUrl(address: string): string {
  return `${BASE}/?address=${encodeURIComponent(address)}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, `Tooele County Recorder request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Tooele County Recorder request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Tooele County Recorder request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: TooeleRecorderEnv, address: string): Promise<ParcelSummary[]> {
  const url = `${BASE}/search?address=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  if (html.includes('Parcel Number:')) {
    const parcel = parseParcelDetail(html);
    parcel.source_url = res.url;
    return [{
      parcel_number: parcel.parcel_number,
      owner_of_record: parcel.owner_of_record,
      situs_address: parcel.situs_address,
      land_sqft: null,
      total_market_value: null,
      detail_url: res.url,
    }];
  }
  return parseParcelList(html);
}

export async function getParcel(_env: TooeleRecorderEnv, parcelNo: string): Promise<Parcel> {
  const url = `${BASE}/document?parcel=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
```

- [ ] **Step 8: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/utils/tooele-assessor/ tests/fixtures/tooele-assessor/ tests/tooeleAssessorParser.test.ts
git commit -m "feat(assessor): add Tooele County recorder-only client and parser"
```

---

## Task 7: Autofill — narrower field set for recorder-only source

**Files:**
- Modify: `src/utils/sl-assessor/autofill.ts`
- Test: `tests/assessorAutofillMultiCounty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/assessorAutofillMultiCounty.test.ts
import { describe, it, expect } from 'vitest';
import { applyParcelToRecord, AUTOFILL_FIELDS } from '../src/utils/sl-assessor/autofill';
import type { Parcel } from '../src/utils/parcel-lookup/types';

function makeTooeleParcel(overrides: Partial<Parcel> = {}): Parcel {
  return {
    parcel_number: '05-123-0-0045',
    source: 'tooele_county_recorder',
    source_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    account_number: null, serial_number: null, tax_district: null,
    owner_of_record: 'DOE JANE', owner_type: 'unknown',
    owner_mailing_address: '47 S MAIN ST TOOELE UT 84074',
    situs_address: null, situs_city: null, situs_zip: null, subdivision: null,
    land_acres: null, land_sqft: null, land_value: null, zoning: null,
    year_built: null, effective_year_built: null, total_bldg_sqft: null,
    finished_sqft: null, basement_sqft: null, garage_sqft: null, stories: null,
    bedrooms: null, bathrooms: null, construction_type: null, improvement_class: null,
    improvement_value: null, market_value_total: null, market_value_land: null,
    market_value_improvement: null, taxable_value: null, assessed_value: null, tax_year: null,
    legal_description: 'LOT 3 BLOCK 2 TOOELE TOWNSITE', plat: null, lot: null, block: null,
    recorded_document_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    recorded_document_type: 'WARRANTY DEED',
    sales: [], raw_data_json: {},
    ...overrides,
  };
}

describe('applyParcelToRecord — Tooele recorder-only source', () => {
  it('fills owner/mailing/legal fields but leaves value fields untouched (all null upstream)', () => {
    const { patch, skipped } = applyParcelToRecord({}, makeTooeleParcel());
    expect(patch.parcel_number).toBe('05-123-0-0045');
    expect(patch.owner_of_record).toBe('DOE JANE');
    expect(patch.owner_mailing_address).toBe('47 S MAIN ST TOOELE UT 84074');
    expect(patch.legal_description).toBe('LOT 3 BLOCK 2 TOOELE TOWNSITE');
    expect(patch.year_built).toBeUndefined();
    expect(patch.total_market_value).toBeUndefined();
    expect(skipped).toEqual([]);
  });

  it('never-clobber still holds for Tooele-sourced patches', () => {
    const existing = { owner_of_record: 'EXISTING OWNER ON FILE' };
    const { patch, skipped } = applyParcelToRecord(existing, makeTooeleParcel());
    expect(patch.owner_of_record).toBeUndefined();
    expect(skipped).toContain('owner_of_record');
  });

  it('AUTOFILL_FIELDS still lists all 11 shared columns (unchanged for full-data counties)', () => {
    expect(AUTOFILL_FIELDS).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assessorAutofillMultiCounty.test.ts`
Expected: FAIL — TypeScript error, `Parcel` object literal missing `recorded_document_url`/`recorded_document_type` (these were added to the type in Task 1, so this actually surfaces as a compile error if Task 1 wasn't done — if Task 1 is already committed, this instead fails because `applyParcelToRecord` types are fine but is a placeholder failure to confirm the harness runs; if it unexpectedly passes, proceed directly to Step 3 confirmation)

- [ ] **Step 3: Confirm no code change is needed — `applyParcelToRecord` already only reads the 11 typed fields**

`src/utils/sl-assessor/autofill.ts`'s `pickParcelValue` already only touches `parcel.parcel_number`, `owner_of_record`, `owner_type`, `owner_mailing_address`, `year_built`, `market_value_total`, `land_sqft`, `sales[0]`, `legal_description`, `tax_district` — for a Tooele `Parcel` where the value fields are `null`, `isEmpty()` correctly causes them to be skipped from the patch (not overwritten with null, and not marked as "skipped" since skipped only tracks fields where the *record* already had a value). No change to `autofill.ts` is required — the existing never-clobber logic already produces the correct narrower patch for a sparser `Parcel` object. This step exists to prove that with a test, not to add new code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assessorAutofillMultiCounty.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/assessorAutofillMultiCounty.test.ts
git commit -m "test(assessor): confirm never-clobber autofill holds for Tooele's narrower field set"
```

---

## Task 8: Multi-county lookup dispatch

**Files:**
- Create: `src/utils/parcel-lookup/lookup.ts`
- Test: `tests/parcelLookupDispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/parcelLookupDispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/sl-assessor/client', () => ({
  searchByAddress: vi.fn(async () => [{ parcel_number: 'SL-1', owner_of_record: null, situs_address: null, land_sqft: null, total_market_value: null, detail_url: 'https://sl.example/1' }]),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/utah-assessor/client', () => ({
  searchByAddress: vi.fn(async () => [{ parcel_number: 'UT-1', owner_of_record: null, situs_address: null, land_sqft: null, total_market_value: null, detail_url: 'https://utah.example/1' }]),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/summit-assessor/client', () => ({
  searchByAddress: vi.fn(async () => []),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/tooele-assessor/client', () => ({
  searchByAddress: vi.fn(async () => []),
  getParcel: vi.fn(),
}));

import { dispatchSearchByAddress, dispatchGetParcel } from '../src/utils/parcel-lookup/lookup';
import * as slClient from '../src/utils/sl-assessor/client';
import * as utahClient from '../src/utils/utah-assessor/client';

describe('parcel-lookup dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a Salt Lake City address to the sl-assessor client', async () => {
    const results = await dispatchSearchByAddress({} as any, '100 Main St, Salt Lake City, UT 84101');
    expect(slClient.searchByAddress).toHaveBeenCalled();
    expect(utahClient.searchByAddress).not.toHaveBeenCalled();
    expect(results[0].parcel_number).toBe('SL-1');
  });

  it('routes a Utah County address to the utah-assessor client', async () => {
    const results = await dispatchSearchByAddress({} as any, '100 E Center St, American Fork, UT 84003');
    expect(utahClient.searchByAddress).toHaveBeenCalled();
    expect(slClient.searchByAddress).not.toHaveBeenCalled();
    expect(results[0].parcel_number).toBe('UT-1');
  });

  it('returns empty array with no client calls for an unsupported county (Davis)', async () => {
    const results = await dispatchSearchByAddress({} as any, '1 Main St, Layton, UT 84041');
    expect(results).toEqual([]);
    expect(slClient.searchByAddress).not.toHaveBeenCalled();
    expect(utahClient.searchByAddress).not.toHaveBeenCalled();
  });

  it('dispatchGetParcel routes by explicit county rather than re-deriving from an address', async () => {
    await dispatchGetParcel({} as any, 'UT-1', 'utah');
    expect(utahClient.getParcel).toHaveBeenCalledWith({}, 'UT-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parcelLookupDispatch.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/parcel-lookup/lookup'`

- [ ] **Step 3: Implement the dispatcher**

```ts
// src/utils/parcel-lookup/lookup.ts
// Thin dispatch layer: resolves the county for an address (or takes an
// explicit county when the caller already knows it, e.g. from
// parcel_records.source) and calls the matching package's
// searchByAddress/getParcel. Each county package owns its own cache/fallback
// chain internally via its own lookup usage in routes/assessor.ts — this
// module is purely the routing switch, not a duplicate fallback chain.

import type { Parcel, ParcelSummary } from './types';
import { resolveCountyFromAddress, type County } from './router';

import * as slClient from '../sl-assessor/client';
import * as utahClient from '../utah-assessor/client';
import * as summitClient from '../summit-assessor/client';
import * as tooeleClient from '../tooele-assessor/client';

export interface DispatchEnv { FIRECRAWL_API_KEY?: string; }

function clientFor(county: County) {
  switch (county) {
    case 'salt_lake': return slClient;
    case 'utah': return utahClient;
    case 'summit': return summitClient;
    case 'tooele': return tooeleClient;
    case 'unsupported': return null;
  }
}

export async function dispatchSearchByAddress(
  env: DispatchEnv,
  address: string,
): Promise<ParcelSummary[]> {
  const county = resolveCountyFromAddress(address);
  const client = clientFor(county);
  if (!client) return [];
  return client.searchByAddress(env, address);
}

/**
 * Detail lookups are keyed by parcel_number, which carries no county
 * signal by itself — callers that already know the county (e.g. from a
 * previously-stored parcel_records.source) MUST pass it explicitly rather
 * than re-deriving from an address that may not be available at this call
 * site (the /parcel/:parcel_no route, the backfill worker's second pass).
 */
export async function dispatchGetParcel(
  env: DispatchEnv,
  parcelNo: string,
  county: County,
): Promise<Parcel> {
  const client = clientFor(county);
  if (!client) throw new Error(`dispatchGetParcel: unsupported county for parcel ${parcelNo}`);
  return client.getParcel(env, parcelNo);
}

export { resolveCountyFromAddress };
export type { County };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parcelLookupDispatch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/parcel-lookup/lookup.ts tests/parcelLookupDispatch.test.ts
git commit -m "feat(assessor): add multi-county dispatch layer"
```

---

## Task 9: Wire dispatch into the backfill worker

**Files:**
- Modify: `src/utils/sl-assessor/backfill.ts`
- Test: `tests/assessorBackfillMultiCounty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/assessorBackfillMultiCounty.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/parcel-lookup/lookup', () => ({
  dispatchSearchByAddress: vi.fn(),
  dispatchGetParcel: vi.fn(),
  resolveCountyFromAddress: vi.fn(),
}));

import { dispatchSearchByAddress } from '../src/utils/parcel-lookup/lookup';
import { processBackfillTick } from '../src/utils/sl-assessor/backfill';

function makeFakeEnv(rows: Array<{ id: number; record_type: string; record_id: number; retry_count: number }>) {
  const dbRows = rows;
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM assessor_backfill_jobs') && sql.includes('LIMIT 1')) {
            return dbRows.shift() ?? null;
          }
          if (sql.includes('FROM businesses') || sql.includes('FROM properties')) {
            return { id: args[0], address: '100 E Center St, American Fork, UT 84003' };
          }
          return null;
        },
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }),
    }),
  };
  return { DB: db, KV: { get: async () => null, put: async () => {} } } as any;
}

describe('processBackfillTick — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls dispatchSearchByAddress instead of the SL-Co-only client directly', async () => {
    (dispatchSearchByAddress as any).mockResolvedValue([]);
    const env = makeFakeEnv([{ id: 1, record_type: 'business', record_id: 42, retry_count: 0 }]);
    await processBackfillTick(env);
    expect(dispatchSearchByAddress).toHaveBeenCalledWith(env, '100 E Center St, American Fork, UT 84003');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assessorBackfillMultiCounty.test.ts`
Expected: FAIL — `dispatchSearchByAddress` not called (backfill.ts still imports `searchByAddress` from `./client` directly)

- [ ] **Step 3: Update backfill.ts to dispatch through the router**

In `src/utils/sl-assessor/backfill.ts`, replace the import line:
```ts
import { searchByAddress, getParcel } from './client';
```
with:
```ts
import { dispatchSearchByAddress, dispatchGetParcel, resolveCountyFromAddress } from '../parcel-lookup/lookup';
```

Then in `processOneJob`, replace:
```ts
  let matches: ParcelSummary[];
  try {
    matches = await searchByAddress(env, rec.address);
  } catch (e: any) {
```
with:
```ts
  let matches: ParcelSummary[];
  try {
    matches = await dispatchSearchByAddress(env, rec.address);
  } catch (e: any) {
```

And replace the detail-fetch fallback:
```ts
      try { parcel = await getParcel(env, parcelNo); }
```
with:
```ts
      try {
        const county = resolveCountyFromAddress(rec.address);
        parcel = await dispatchGetParcel(env, parcelNo, county);
      }
```

Note: `rec` (the `{id, address}` row fetched earlier in `processOneJob`) is already in scope at this point in the function — no new query needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assessorBackfillMultiCounty.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing backfill test suite to confirm no regression**

Run: `npx vitest run -t "backfill"`
Expected: all previously-passing backfill tests still PASS

- [ ] **Step 6: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/sl-assessor/backfill.ts tests/assessorBackfillMultiCounty.test.ts
git commit -m "feat(assessor): route backfill worker through multi-county dispatch"
```

---

## Task 10: Wire dispatch into the /api/assessor route

**Files:**
- Modify: `src/routes/assessor.ts`
- Test: `tests/assessorRouteMultiCounty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/assessorRouteMultiCounty.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/parcel-lookup/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/parcel-lookup/lookup')>();
  return {
    ...actual,
    dispatchSearchByAddress: vi.fn(async (_env: any, address: string) => {
      if (address.includes('American Fork')) {
        return [{ parcel_number: 'UT-1', owner_of_record: 'X', situs_address: address, land_sqft: null, total_market_value: null, detail_url: 'https://utah.example/1' }];
      }
      return [];
    }),
  };
});

import app from '../src/routes/assessor';
import { dispatchSearchByAddress } from '../src/utils/parcel-lookup/lookup';

describe('GET /parcels — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a Utah County address through the dispatch layer', async () => {
    const fakeEnv = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) },
      KV: { get: async () => null, put: async () => {} },
    };
    const req = new Request('http://localhost/parcels?address=' + encodeURIComponent('100 E Center St, American Fork, UT 84003'));
    const res = await app.fetch(req, fakeEnv, { user: { role: 'admin' } } as any);
    expect(dispatchSearchByAddress).toHaveBeenCalled();
    const body = await res.json() as any;
    expect(body.parcels[0]?.parcel_number).toBe('UT-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assessorRouteMultiCounty.test.ts`
Expected: FAIL — `dispatchSearchByAddress` not invoked; route still calls SL Co's `lookupParcelsWithFallback` unconditionally

- [ ] **Step 3: Update the route's GET /parcels handler**

In `src/routes/assessor.ts`, add the import:
```ts
import { dispatchSearchByAddress } from '../utils/parcel-lookup/lookup';
```

Replace the body of `app.get('/parcels', ...)` — specifically the line:
```ts
  const r = await lookupParcelsWithFallback(c.env, address);
```
with a county-aware branch. The existing `lookupParcelsWithFallback` keeps its own KV fresh/stale cache chain for Salt Lake County specifically; for the three new counties, call the dispatcher directly (their own client modules don't yet have a fallback-chain wrapper — that's out of scope per the design doc's "kept per-county-duplicated" note, revisited only if needed):

```ts
  const county = resolveCountyFromAddress(address);
  let r: { parcels: ParcelSummary[]; source: string; code: string; degraded: boolean; manual_url: string; diagnostic?: string };
  if (county === 'salt_lake') {
    r = await lookupParcelsWithFallback(c.env, address);
  } else {
    try {
      const parcels = await dispatchSearchByAddress(c.env, address);
      r = {
        parcels,
        source: 'direct',
        code: parcels.length > 0 ? 'ok' : 'no_match',
        degraded: false,
        manual_url: '',
      };
    } catch (e: any) {
      r = {
        parcels: [],
        source: 'none',
        code: 'upstream_error',
        degraded: false,
        manual_url: '',
        diagnostic: e?.message ?? 'unknown',
      };
    }
  }
```

Add the `resolveCountyFromAddress` import alongside the `dispatchSearchByAddress` one:
```ts
import { dispatchSearchByAddress, resolveCountyFromAddress } from '../utils/parcel-lookup/lookup';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assessorRouteMultiCounty.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing assessor route test suite to confirm no regression**

Run: `npx vitest run -t "assessor"`
Expected: all previously-passing SL Co route tests still PASS (SL Co branch is untouched — same `lookupParcelsWithFallback` call as before)

- [ ] **Step 6: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/assessor.ts tests/assessorRouteMultiCounty.test.ts
git commit -m "feat(assessor): dispatch GET /parcels to the correct county package"
```

---

## Task 11: POST /apply — resolve county from stored parcel_records.source

**Files:**
- Modify: `src/routes/assessor.ts`
- Test: `tests/assessorApplyMultiCounty.test.ts`

**Context:** `POST /apply` currently calls `getParcel` from `sl-assessor/client` directly (line ~33 import, line ~142 call) when the KV cache misses. For a non-SL-Co parcel number, this needs to dispatch to the right county's `getParcel` instead — using the `source` value already stored on the `parcel_records` row for that parcel (if it exists) or, for a first-time apply, the county resolved from the record's own address.

- [ ] **Step 1: Write the failing test**

```ts
// tests/assessorApplyMultiCounty.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/parcel-lookup/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/parcel-lookup/lookup')>();
  return { ...actual, dispatchGetParcel: vi.fn() };
});

import app from '../src/routes/assessor';
import { dispatchGetParcel } from '../src/utils/parcel-lookup/lookup';

function makeFakeEnv(businessRow: Record<string, unknown>) {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('FROM businesses WHERE id')) return businessRow;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    },
    KV: { get: async () => null, put: async () => {} },
  } as any;
}

describe('POST /apply — multi-county dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches getParcel by the county resolved from the record address', async () => {
    (dispatchGetParcel as any).mockResolvedValue({
      parcel_number: 'UT-1', source: 'utah_county_assessor', source_url: 'https://utah.example/1',
      owner_of_record: 'X', owner_type: 'individual', owner_mailing_address: null,
      situs_address: null, situs_city: null, situs_zip: null, subdivision: null,
      land_acres: null, land_sqft: null, land_value: null, zoning: null,
      year_built: null, effective_year_built: null, total_bldg_sqft: null, finished_sqft: null,
      basement_sqft: null, garage_sqft: null, stories: null, bedrooms: null, bathrooms: null,
      construction_type: null, improvement_class: null, improvement_value: null,
      market_value_total: null, market_value_land: null, market_value_improvement: null,
      taxable_value: null, assessed_value: null, tax_year: null, legal_description: null,
      plat: null, lot: null, block: null, recorded_document_url: null, recorded_document_type: null,
      sales: [], raw_data_json: {}, account_number: null, serial_number: null, tax_district: null,
    });
    const env = makeFakeEnv({ id: 1, address: '100 E Center St, American Fork, UT 84003' });
    const req = new Request('http://localhost/apply', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: 1, parcel_number: 'UT-1' }),
    });
    await app.fetch(req, env, { user: { role: 'admin' } } as any);
    expect(dispatchGetParcel).toHaveBeenCalledWith(env, 'UT-1', 'utah');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assessorApplyMultiCounty.test.ts`
Expected: FAIL — route still imports `getParcel` from `sl-assessor/client` directly and never calls `dispatchGetParcel`

- [ ] **Step 3: Update POST /apply**

In `src/routes/assessor.ts`, the import block currently has:
```ts
import { getParcel } from '../utils/sl-assessor/client';
```
Change to:
```ts
import { dispatchGetParcel } from '../utils/parcel-lookup/lookup';
```

(The `resolveCountyFromAddress` import was already added in Task 10 — reuse it.)

In the `POST /apply` handler, the record is fetched before the parcel lookup:
```ts
  const record = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(body.record_id).first<Record<string, unknown>>();
  if (!record) return c.json({ code: 'not_found' }, 404);

  let parcel: Parcel;
  try {
    const cached = await getCached<Parcel>(c.env, cacheKeyParcel(body.parcel_number));
    parcel = cached ?? await getParcel(c.env, body.parcel_number);
    if (!cached) await putCached(c.env, cacheKeyParcel(body.parcel_number), parcel);
  } catch (e) { return handleError(c, e); }
```
Replace the parcel-fetch block with:
```ts
  let parcel: Parcel;
  try {
    const cached = await getCached<Parcel>(c.env, cacheKeyParcel(body.parcel_number));
    const county = resolveCountyFromAddress((record as { address?: string }).address ?? '');
    parcel = cached ?? await dispatchGetParcel(c.env, body.parcel_number, county);
    if (!cached) await putCached(c.env, cacheKeyParcel(body.parcel_number), parcel);
  } catch (e) { return handleError(c, e); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assessorApplyMultiCounty.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing /apply test suite to confirm no regression**

Run: `npx vitest run -t "apply"`
Expected: all previously-passing SL Co `/apply` tests still PASS (SL Co addresses resolve to `'salt_lake'`, dispatched to the same `sl-assessor` client as before)

- [ ] **Step 6: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/assessor.ts tests/assessorApplyMultiCounty.test.ts
git commit -m "feat(assessor): dispatch POST /apply parcel fetch by resolved county"
```

---

## Task 12: UI — Tooele recorder-document link-out

**Files:**
- Modify: `client/src/components/AssessorSuggestionPanel.tsx`
- Test: `client/src/components/__tests__/AssessorSuggestionPanel.test.tsx` (create if this test file doesn't already exist — check first)

- [ ] **Step 1: Read the current component to find its field-render structure**

Run: `grep -n "market_value_total\|year_built\|source ===" "client/src/components/AssessorSuggestionPanel.tsx"`

This locates where value fields are conditionally rendered (`{parcel.market_value_total != null && ...}` pattern) — the new branch goes alongside those.

- [ ] **Step 2: Write the failing test**

```tsx
// client/src/components/__tests__/AssessorSuggestionPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssessorSuggestionPanel from '../AssessorSuggestionPanel';

const tooeleParcel = {
  parcel_number: '05-123-0-0045',
  source: 'tooele_county_recorder',
  owner_of_record: 'DOE JANE',
  situs_address: null,
  land_sqft: null,
  total_market_value: null,
  recorded_document_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
  recorded_document_type: 'WARRANTY DEED',
  detail_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
};

describe('AssessorSuggestionPanel — Tooele recorder source', () => {
  it('renders a recorded-document link instead of value fields', () => {
    render(<AssessorSuggestionPanel parcels={[tooeleParcel as any]} onApply={() => {}} onDismiss={() => {}} />);
    const link = screen.getByRole('link', { name: /view recorded document/i });
    expect(link).toHaveAttribute('href', tooeleParcel.recorded_document_url);
    expect(screen.getByText(/warranty deed/i)).toBeInTheDocument();
  });
});
```

(If the component's actual prop names differ from `parcels`/`onApply`/`onDismiss`, adjust the test to match — check the real prop signature first via the Step 1 grep/read before finalizing this test.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/AssessorSuggestionPanel.test.tsx`
Expected: FAIL — no "View recorded document" link rendered yet

- [ ] **Step 4: Add the conditional branch**

Find the block in `AssessorSuggestionPanel.tsx` that renders per-parcel value fields (typically inside a `.map()` over parcels, near where `market_value_total`/`year_built` are shown). Add, as a sibling condition:

```tsx
{parcel.source === 'tooele_county_recorder' && parcel.recorded_document_url ? (
  <div className="text-[11px] text-text-secondary">
    {parcel.recorded_document_type && (
      <span className="mr-1 font-semibold">{parcel.recorded_document_type}</span>
    )}
    <a
      href={parcel.recorded_document_url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-400 underline"
    >
      View recorded document
    </a>
  </div>
) : (
  // existing value-field JSX (market_value_total, year_built, etc.) stays here unchanged
  null
)}
```

Wire this in as a replacement wrapper around the existing value-field JSX block — the existing JSX for non-Tooele parcels goes in the `else` branch verbatim (do not delete or rewrite it, just wrap it).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/AssessorSuggestionPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full existing component test suite to confirm no regression**

Run: `cd client && npx vitest run src/components/__tests__/AssessorSuggestionPanel.test.tsx -t "" 2>/dev/null; npx vitest run -t "AssessorSuggestionPanel"`
Expected: all previously-passing tests for this component still PASS

- [ ] **Step 7: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/components/AssessorSuggestionPanel.tsx client/src/components/__tests__/AssessorSuggestionPanel.test.tsx
git commit -m "feat(assessor-ui): render recorded-document link-out for Tooele County parcels"
```

---

## Task 13: Full verification pass

**Files:** none created/modified — verification only.

- [ ] **Step 1: Run the full Worker test suite**

Run: `npx vitest run`
Expected: all tests PASS (existing 202 files + the ~10 new test files from this plan)

- [ ] **Step 2: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 new errors — pre-existing errors unrelated to this change are acceptable per CLAUDE.md session log precedent, but confirm no NEW errors reference files touched in this plan)

- [ ] **Step 4: Run the client test suite**

Run: `cd client && npx vitest run`
Expected: PASS (pre-existing unrelated failures acceptable; no new failures in `AssessorSuggestionPanel`)

- [ ] **Step 5: Run the client build**

Run: `cd client && npx vite build`
Expected: build succeeds

- [ ] **Step 6: Apply migration 0157 locally one more time from a clean state to confirm idempotency**

Run: `npm run migrate:local`
Expected: no error (migration already applied — D1 migration tracking treats a re-run as a no-op)

- [ ] **Step 7: Final commit if any fixups were needed during verification**

```bash
git add -A
git commit -m "chore(assessor): fixups from full verification pass" --allow-empty-message -m "verification pass"
```
(Only run this if Steps 1-6 required any code changes. If everything passed clean, skip this step — there's nothing to commit.)
