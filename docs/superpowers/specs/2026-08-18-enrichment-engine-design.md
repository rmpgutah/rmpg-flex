# Open-Source Enrichment Engine — Design Spec
**Date:** 2026-08-18  
**Branch:** `claude/emergency-dispatch-data-capture-7ed78c`  
**Status:** Approved for implementation

---

## Problem

The skip tracer and process-server workflows operate on local D1 data only (after MicroBilt live round-trips became unavailable post-VPS decommission). When a subject's address is stale or missing, investigators and process servers have no automated way to cross-reference free public data sources. Matches returned today carry no confidence signal — there is no way to tell if `John Smith, DOB 1990-05-12` in a search result is the same John Smith being sought.

---

## Goal

A shared enrichment engine that:
1. Fans out to 6 free/open-source data APIs in parallel
2. Applies a **hard-lock** confidence algorithm — DOB match within ±1 year **AND** at least one secondary anchor (SSN last-4, DL number, or known prior address)
3. Returns `match_tier: 'CONFIRMED' | 'UNCONFIRMED'` along with which anchors sealed the match
4. Caches results 24 hours in D1 (same TTL as CarsXE)
5. Surfaces in two UI entry points via a shared hook: **Skip Tracer** and **Serve workflow**

---

## Architecture

### Approach chosen: Synchronous Worker route (Option 2)

All 6 source adapters run in a single `Promise.allSettled()` call inside the Worker's 30-second CPU budget. Partial results (some sources timed out, some succeeded) are always returned — the caller never gets an empty response due to a single adapter failure. Long-running sources (court scraping, multi-page pagination) are explicitly excluded from v1; they can be added via the `PersonIntelDO` async path in a future iteration.

---

## Data Model

### New table: `enrichment_cache`

```sql
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key    TEXT NOT NULL UNIQUE,
  seed_json    TEXT NOT NULL,
  results_json TEXT NOT NULL,
  match_tier   TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  anchors_json TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  searched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  searched_by  INTEGER,
  org_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_key ON enrichment_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_expires ON enrichment_cache(expires_at);
```

**Cache key:** `SHA-256(normalize(first_name + last_name + dob))` — same subject searched from Skip Tracer and from the serve workflow hits the same row.

**TTL:** 24 hours. Expired rows are served stale with `stale: true` so the UI can offer a manual refresh without silently re-querying free-tier quotas.

**Migration file:** `migrations/0254_enrichment_cache.sql`  
Apply after merge: `scripts/apply-migration.sh 0254_enrichment_cache.sql`

---

## Enrichment Engine (`src/utils/enrichment/`)

```
src/utils/enrichment/
  types.ts           — all shared interfaces
  normalize.ts       — name normalization + SHA-256 cache key
  matcher.ts         — hard-lock algorithm
  sources/
    nsopw.ts         — sex offender registry (fully free, reuses nsopw.ts logic)
    assessor.ts      — SL County Assessor property owner lookup (free, reuses sl-assessor)
    openSanctions.ts — OpenSanctions API (global sanctions/watchlist, fully open)
    usps.ts          — USPS Web Tools address standardization (free with USPS account)
    openCorporates.ts — OpenCorporates business registry officer lookup (500/day free)
    numverify.ts     — phone carrier + line-type lookup (100/day free tier)
```

### Types (`types.ts`)

```ts
export interface EnrichmentSeed {
  first_name: string;
  last_name: string;
  dob?: string;          // ISO YYYY-MM-DD; run through normalizeDob() before use
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  dl_number?: string;
  ssn_last4?: string;
}

export type MatchTier = 'CONFIRMED' | 'UNCONFIRMED';

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  source: string;
}

export interface EnrichedRecord {
  name?: string;
  dob?: string;
  addresses: Address[];
  phones: string[];
  emails: string[];
  dl_number?: string;
  ssn_last4?: string;
  business_associations?: string[];
  watchlist_flags?: string[];
  source: string;
  raw?: unknown;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  latency_ms: number;
  records: EnrichedRecord[];
  error?: string;
}

export interface HardLockResult {
  confirmed: boolean;
  anchors: string[];   // e.g. ['dob_match', 'address_anchor']
}

export interface EnrichmentResponse {
  match_tier: MatchTier;
  anchors: string[];
  sources: SourceResult[];
  records: EnrichedRecord[];   // all records, confirmed first
  confirmed_count: number;
  cached: boolean;
  stale: boolean;
  searched_at: string;
}
```

### Hard-lock matcher (`matcher.ts`)

**Algorithm — both conditions must pass for `confirmed: true`:**

**Condition 1 — DOB window:**  
`|record.dob_epoch - seed.dob_epoch| ≤ 366 * 24 * 60 * 60 * 1000` ms  
- Uses epoch ms comparison to avoid timezone offset traps (same pattern as `parseD1TimestampMs`)
- 366 days covers leap years + the full 1-year tolerance
- If either seed or record has no DOB: condition 1 fails → `confirmed: false` always

**Condition 2 — Secondary anchor (any one of):**
- `ssn_last4` exact match (4-digit string, both non-empty)
- `dl_number` exact match (normalized uppercase, both non-empty)
- Address anchor: record address `city + state` matches seed `city + state` OR any address in the local `persons` / `dl_records` rows for this person (looked up by the route before calling the matcher)

**Anchors array:** populated with the names of every condition that passed, even if confirmation already locked. Used for audit display in the UI.

```ts
export function hardLock(seed: EnrichmentSeed, record: EnrichedRecord): HardLockResult {
  const anchors: string[] = [];

  // --- Condition 1: DOB window ---
  const seedDob = normalizeDob(seed.dob ?? null);
  const recDob  = normalizeDob(record.dob ?? null);
  let dobPass = false;
  if (seedDob && recDob) {
    const diffMs = Math.abs(Date.parse(seedDob) - Date.parse(recDob));
    if (diffMs <= 366 * 24 * 60 * 60 * 1000) {
      dobPass = true;
      anchors.push('dob_match');
    }
  }

  if (!dobPass) return { confirmed: false, anchors };

  // --- Condition 2: at least one secondary anchor ---
  if (seed.ssn_last4 && record.ssn_last4 && seed.ssn_last4 === record.ssn_last4) {
    anchors.push('ssn_last4');
  }
  if (seed.dl_number && record.dl_number &&
      seed.dl_number.toUpperCase() === record.dl_number.toUpperCase()) {
    anchors.push('dl_number');
  }
  // Address anchor checked against record addresses + caller-supplied known addresses
  const seedCityState = `${(seed.city ?? '').toLowerCase()}|${(seed.state ?? '').toLowerCase()}`;
  for (const addr of record.addresses) {
    const recCityState = `${(addr.city ?? '').toLowerCase()}|${(addr.state ?? '').toLowerCase()}`;
    if (seedCityState.length > 1 && seedCityState === recCityState) {
      anchors.push('address_anchor');
      break;
    }
  }

  const hasAnchor = anchors.some(a => a !== 'dob_match');
  return { confirmed: hasAnchor, anchors };
}
```

**Edge cases:**
- Name-only match with no DOB → always `UNCONFIRMED` (DOB is required for condition 1)
- Multiple anchors all recorded in `anchors[]` — never deduplicated — so audit shows full picture
- Record with no addresses, no ssn_last4, no dl_number → `UNCONFIRMED` even if DOB passes

---

## Route (`src/routes/enrichment.ts`)

**Mount:** `POST /api/enrichment/search`, `GET /api/enrichment/sources`  
**Auth:** required (same gate as `/api/skiptracer`); `client_viewer` excluded  
**Mount in `src/index.ts`:** `app.use('/api/enrichment', authMiddleware)` + `app.route('/api/enrichment', enrichment)`

### `POST /api/enrichment/search`

**Request body:**
```json
{
  "first_name": "John",
  "last_name": "Smith",
  "dob": "1990-05-12",
  "city": "Salt Lake City",
  "state": "UT",
  "phone": "8015550123"
}
```

**Execution sequence:**
1. Validate `first_name` + `last_name` required; run `normalizeDob()` on `dob`
2. Compute `cache_key = SHA-256(normalize(first+last+dob))`
3. Query `enrichment_cache WHERE cache_key = ? AND expires_at > datetime('now')` → return cached if fresh
4. If stale row exists, return it with `stale: true` (do not re-query; client shows a Refresh button)
5. Look up seed person's known city+state from local `persons` + `dl_records` to pre-load address anchors
6. `Promise.allSettled([nsopw, assessor, openSanctions, usps, openCorporates, numverify])` with individual 8-second timeouts per adapter
7. Run `hardLock()` against every `EnrichedRecord` from all sources
8. Compute `match_tier`: `'CONFIRMED'` if any record confirmed; else `'UNCONFIRMED'`
9. Write to `enrichment_cache` with `expires_at = datetime('now', '+24 hours')`
10. `recordAudit()` — action `enrichment.search`, entity `person`, details include `match_tier` + `source_count`
11. Return `EnrichmentResponse`

### `GET /api/enrichment/sources`

Returns configured + health status of each adapter. Used by the UI to show which sources are active. Checks env vars (USPS_USER_ID, OPENCORPORATES_API_KEY, NUMVERIFY_API_KEY) and returns `configured: boolean` per source. NSOPW and OpenSanctions have no key requirement.

---

## Open-Source Sources

### Config / secrets required

| Source | Secret | Notes |
|---|---|---|
| NSOPW | none | Federal NSOPW API, no key |
| SL County Assessor | none | Already integrated |
| OpenSanctions | none | Public dataset API, no key |
| USPS Web Tools | `USPS_USER_ID` | Free USPS account registration |
| OpenCorporates | `OPENCORPORATES_API_KEY` | Free tier 500 req/day |
| Numverify | `NUMVERIFY_API_KEY` | Free tier 100 req/day |

Unset secrets → adapter returns `{ ok: false, records: [], error: 'not_configured' }` rather than crashing. Route proceeds with the remaining adapters — partial results are always better than a 503.

### Adapter contract

Every adapter exports:
```ts
export async function search(seed: EnrichmentSeed, env: Env): Promise<SourceResult>
```

- Wraps its fetch in `AbortController` with 8-second timeout
- Returns `{ source, ok: false, latency_ms, records: [], error }` on any failure
- Never throws — all errors are caught and returned as `ok: false`
- Records returned use the shared `EnrichedRecord` shape — no source-specific types leak to the route

---

## Client Integration

### `client/src/hooks/useEnrichment.ts`

```ts
interface UseEnrichmentReturn {
  search: (seed: EnrichmentSeed) => Promise<void>;
  result: EnrichmentResponse | null;
  loading: boolean;
  error: string | null;
  reset: () => void;
}
```

Uses `apiFetch` internally. Exported from `client/src/hooks/useEnrichment.ts`.

### Skip Tracer (`SkipTracerV2Page.tsx`)

- "Enrich from open sources" button appears in the right dossier panel after a local search completes
- Runs enrichment with the selected person's name + DOB from the search result
- `CONFIRMED` match: green badge + anchor chips (e.g. `DOB ✓`, `Address ✓`)
- `UNCONFIRMED` match: amber badge + "Review required" note
- Stale cache: grey badge with timestamp + "Refresh" button

### Serve workflow (subject file tab)

- "Locate subject" button on a serve job's subject file tab
- Seeds enrichment from the serve subject's `first_name` + `last_name` + `dob` stored on the serve record
- `CONFIRMED` → returned addresses appear as "Suggested re-attempt locations" with a one-click "Add attempt location" action that pre-fills the serve attempt form
- `UNCONFIRMED` → addresses appear as "Possible locations — officer review required" without the one-click action

---

## Secrets to add after merge

```bash
wrangler secret put USPS_USER_ID
wrangler secret put OPENCORPORATES_API_KEY
wrangler secret put NUMVERIFY_API_KEY
```

Add to `.dev.vars` for local development.

---

## Testing

- `tests/enrichment/matcher.test.ts` — unit tests for `hardLock()`: DOB boundary cases, anchor combinations, no-DOB always-unconfirmed, multiple anchors all recorded
- `tests/enrichment/normalize.test.ts` — cache key determinism (same seed → same key regardless of whitespace/case)
- Miniflare smoke test in `test-workers/enrichment.test.ts`: mock adapters, verify cache hit on second call, verify `match_tier` propagation

---

## Migration checklist (post-merge)

1. `scripts/apply-migration.sh 0254_enrichment_cache.sql`
2. Verify: `wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE name='enrichment_cache'"`
3. Set the three secrets above
4. Hit `GET /api/enrichment/sources` — confirm all 6 sources appear, 3 show `configured: true` minimum (NSOPW, assessor, OpenSanctions require no key)
