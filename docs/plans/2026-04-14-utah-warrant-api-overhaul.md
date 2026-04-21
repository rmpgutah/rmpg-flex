# Utah Warrant API Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix accuracy bugs, expand field capture, add session-cookie warmup for CloudFront, and replace the flat-scan scheduler with a priority-tiered queue — all while preserving the "null-never-clears-warrants" correctness bedrock.

**Architecture:** Server-side only (Phases 1-4). The `server/src/utils/utahWarrantScraper.ts` pipeline keeps its existing `null` vs `[]` contract. Bugs in `server/src/routes/warrants.ts` get surgical fixes. Schema grows additively via `addCol` with a `raw_json` escape hatch. A new `warrant_scan_queue` table drives tier-based scheduling (hot/warm/cold) computed nightly from `persons` + `arrest_records` + `incident_officers` + `calls_for_service` activity. Session cookies are warmed once per scan burst to reduce CloudFront WAF friction.

**Tech Stack:** Express 5 + TypeScript + better-sqlite3 + vitest + supertest. No new deps.

**Reference:** See [2026-04-14 design doc](./2026-04-14-utah-warrant-api-overhaul-design.md) for rationale and §9 implementation order.

**Scope note:** This plan covers Phases 1-4 (API layer). Phase 5 (UI overhaul per [2026-04-06 doc](./2026-04-06-warrants-overhaul-design.md)) will be planned separately after Phase 4 ships.

---

## Phase 1 — Bug Fixes (surgical, low-risk)

### Task 1.1: Fix duplicate `severity`/`source` WHERE clauses in list route

**Files:**
- Modify: `server/src/routes/warrants.ts:47-84`
- Test: `server/tests/integration/warrants.test.ts` (append new `describe`)

**Step 1: Write the failing test**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('GET /api/warrants — filter de-duplication', () => {
  it('applies severity filter exactly once (no doubled WHERE clauses)', async () => {
    // Create two warrants with different offense_level
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Felony filter test', offense_level: 'felony'
    });
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Misdemeanor filter test', offense_level: 'misdemeanor'
    });

    const res = await request(app)
      .get('/api/warrants?severity=felony')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const w of res.body.data) {
      expect(w.offense_level).toBe('felony');
    }
  });

  it('applies source filter exactly once', async () => {
    const res = await request(app)
      .get('/api/warrants?source=manual')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const w of res.body.data) {
      expect(w.source === 'manual' || w.source === null).toBe(true);
    }
  });
});
```

**Step 2: Run test to verify it fails or passes based on current state**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "filter de-duplication"`
Expected: Tests likely PASS already because the duplicate just appends the same param twice. Verify by inspecting the generated SQL — the test should still PASS because duplicate filters are idempotent on equality. We still remove the duplicate for correctness and to make WHERE clauses auditable.

**Step 3: Apply the fix**

Modify `server/src/routes/warrants.ts:77-84` — delete the duplicate `severity` and `source` blocks:

```typescript
// DELETE these duplicate blocks (they repeat lines 47-54):
//    if (severity) {
//      whereClause += ' AND w.offense_level = ?';
//      params.push(severity);
//    }
//    if (source) {
//      whereClause += ' AND w.source = ?';
//      params.push(source);
//    }
```

Leave the first occurrence at lines 47-54 intact.

**Step 4: Re-run tests**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "filter de-duplication"`
Expected: All PASS.

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/trusting-banach"
git add server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "fix(warrants): dedupe severity/source WHERE clauses in list route"
```

---

### Task 1.2: Fix age-boundary math in scanner

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts:535-547`
- Test: `server/tests/unit/utahWarrantScraper.test.ts` (new file)

**Step 1: Write the failing test**

Create `server/tests/unit/utahWarrantScraper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeAgeFromDob } from '../../src/utils/utahWarrantScraper';

describe('computeAgeFromDob', () => {
  it('returns correct age before birthday', () => {
    // Born Dec 31 1990, today is Dec 30 2026 → age 35 (not 36)
    const age = computeAgeFromDob('1990-12-31', new Date('2026-12-30'));
    expect(age).toBe(35);
  });

  it('returns correct age on birthday', () => {
    const age = computeAgeFromDob('1990-12-31', new Date('2026-12-31'));
    expect(age).toBe(36);
  });

  it('returns correct age after birthday', () => {
    const age = computeAgeFromDob('1990-12-31', new Date('2027-01-02'));
    expect(age).toBe(36);
  });

  it('returns null for invalid DOB', () => {
    expect(computeAgeFromDob('not-a-date')).toBeNull();
    expect(computeAgeFromDob('')).toBeNull();
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts`
Expected: FAIL — `computeAgeFromDob` does not exist.

**Step 3: Implement and refactor**

In `server/src/utils/utahWarrantScraper.ts`, export new helper near the top with other helpers (around line 90):

```typescript
/** Compute age from DOB (YYYY-MM-DD) using month/day, not just year. */
export function computeAgeFromDob(dob: string, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
```

Then refactor the age-verification block at lines 535-547 to use it:

```typescript
// DOB verification — if both records have DOB, require match to reduce false positives
if (person.dob && r.age != null) {
  const expectedAge = computeAgeFromDob(person.dob);
  if (expectedAge !== null) {
    const ageDiff = Math.abs(expectedAge - r.age);
    if (ageDiff > 1) {
      continue; // Age mismatch by more than 1 year — likely a different person
    }
  }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts`
Expected: PASS.

Run the full suite: `cd server && npx vitest run`
Expected: No regressions.

**Step 5: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts server/tests/unit/utahWarrantScraper.test.ts
git commit -m "fix(warrants): age-boundary math — use month/day not just year"
```

---

### Task 1.3: Propagate `partial_errors` flag through API

**Files:**
- Modify: `server/src/routes/warrants.ts` (three endpoints: `/utah-search`, `/utah-search/auto-poll-status`, `/check/:personId`)
- Modify: `server/src/utils/utahWarrantScraper.ts` — export typed getter for `__hasPartialErrors`
- Test: `server/tests/integration/warrants.test.ts` (new `describe`)

**Step 1: Write failing test**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('Utah search partial_errors propagation', () => {
  it('exposes partial_errors: false by default in /utah-search', async () => {
    const res = await request(app)
      .post('/api/warrants/utah-search')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Nonexistent', lastName: 'TestPerson' });
    // Either 200 (empty results) or 200 with cache — both should expose partial_errors
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('partial_errors');
    expect(typeof res.body.partial_errors).toBe('boolean');
  });
});
```

**Step 2: Run test**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "partial_errors"`
Expected: FAIL — `partial_errors` not in response.

**Step 3: Add helper in scraper**

In `server/src/utils/utahWarrantScraper.ts`, change the `(results as any).__hasPartialErrors = true;` pattern to a typed exported helper. After the `UtahWarrantResult` type:

```typescript
/** Result bundle so callers can read partial-failure flag without unsafe casts. */
export interface UtahWarrantSearchBundle {
  results: UtahWarrantResult[];
  partialErrors: boolean;
}

/** Search with structured result (replaces raw array + symbol-property pattern). */
export async function searchUtahWarrantsLiveBundle(
  firstName: string,
  lastName: string
): Promise<UtahWarrantSearchBundle | null> {
  const raw = await searchUtahWarrantsLive(firstName, lastName);
  if (raw === null) return null;
  const partialErrors = Boolean((raw as any).__hasPartialErrors);
  return { results: raw, partialErrors };
}
```

**Step 4: Wire into `/utah-search` endpoint**

Modify `server/src/routes/warrants.ts:1349-1421` (`/utah-search`):

Replace:
```typescript
results = (await searchUtahWarrantsLive(first, last)) || [];
```

With:
```typescript
const bundle = await searchUtahWarrantsLiveBundle(first, last);
results = bundle?.results || [];
partialErrors = bundle?.partialErrors || false;
```

Add `let partialErrors = false;` near `let blocked = false;`. Add `partial_errors: partialErrors` to the response JSON.

Import `searchUtahWarrantsLiveBundle` in the existing scraper import at line 8:
```typescript
import { getUtahWarrantSyncStatus, isUtahApiBlocked, runWarrantWatchScan, searchUtahWarrantsLive, searchUtahWarrantsLiveBundle, searchUtahWarrantsCache } from '../utils/utahWarrantScraper';
```

**Step 5: Wire into `/check/:personId`**

At `server/src/routes/warrants.ts:739-762`, any place that calls `universalWarrantCheck` currently lacks partial-error info. Return `partial_errors: false` for now (Phase 3 adds true flag once the universal scanner aligns). This keeps the API shape consistent.

**Step 6: Wire into `/utah-search/auto-poll-status`**

At `server/src/routes/warrants.ts:1425-end-of-handler`, add `partial_errors: isUtahApiBlocked()` to the response body (WAF block = definitionally partial). If not blocked, `partial_errors: false`.

**Step 7: Re-run tests**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "partial_errors"`
Expected: PASS.

Run full suite: `cd server && npx vitest run`
Expected: No regressions.

**Step 8: Commit**

```bash
git add server/src/routes/warrants.ts server/src/utils/utahWarrantScraper.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): propagate partial_errors flag through Utah search API"
```

---

### Task 1.4: Log insufficient-name persons during scan

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts` (watch scan query + log)

**Step 1: Apply the change**

The current query at line 464 filters `WHERE first_name IS NOT NULL AND first_name != '' AND last_name IS NOT NULL AND last_name != ''`. Add a second query to count skipped persons and emit a log event.

After the `persons` fetch in `_runWarrantWatchScanImpl`:

```typescript
const skippedCount = (db.prepare(`
  SELECT COUNT(*) as cnt FROM persons
  WHERE archived_at IS NULL
    AND (
      first_name IS NULL OR first_name = '' OR
      last_name IS NULL OR last_name = ''
    )
`).get() as { cnt: number }).cnt;

if (skippedCount > 0) {
  console.log(`[Warrant Watch] ${skippedCount} persons skipped (missing first or last name)`);
  db.prepare(`
    INSERT INTO warrant_watch_log
      (person_id, person_name, event, scan_run_id, created_at)
    VALUES (NULL, ?, 'skipped_insufficient_name', ?, ?)
  `).run(`${skippedCount} persons`, runId, now);
}
```

**Step 2: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts
git commit -m "feat(warrants): log count of persons skipped for missing name during scan"
```

---

## Phase 2 — Schema Expansion

### Task 2.1: Add columns to `utah_warrants` via `addCol`

**Files:**
- Modify: `server/src/models/database.ts` (append `addCol` calls near line 4059)

**Step 1: Write the test first**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('utah_warrants schema expansion', () => {
  it('has new columns after migration', async () => {
    const db = (await import('../../src/models/database')).getDb();
    const cols = db.prepare(`PRAGMA table_info(utah_warrants)`).all() as any[];
    const names = new Set(cols.map((c: any) => c.name));
    for (const col of [
      'date_of_birth', 'sex', 'race',
      'height_inches', 'weight_lbs', 'eye_color', 'hair_color',
      'home_street', 'home_state', 'home_zip',
      'bond_amount', 'statute', 'disposition', 'ori', 'raw_json',
    ]) {
      expect(names.has(col)).toBe(true);
    }
  });
});
```

**Step 2: Run to see failure**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "schema expansion"`
Expected: FAIL — columns don't exist.

**Step 3: Apply migration**

In `server/src/models/database.ts`, find the section with existing `addCol('warrant_watch_runs', ...)` around line 4059. Append:

```typescript
// Utah warrants schema expansion (2026-04-14)
addCol('utah_warrants', 'date_of_birth', 'TEXT');
addCol('utah_warrants', 'sex', 'TEXT');
addCol('utah_warrants', 'race', 'TEXT');
addCol('utah_warrants', 'height_inches', 'INTEGER');
addCol('utah_warrants', 'weight_lbs', 'INTEGER');
addCol('utah_warrants', 'eye_color', 'TEXT');
addCol('utah_warrants', 'hair_color', 'TEXT');
addCol('utah_warrants', 'home_street', 'TEXT');
addCol('utah_warrants', 'home_state', 'TEXT');
addCol('utah_warrants', 'home_zip', 'TEXT');
addCol('utah_warrants', 'bond_amount', 'REAL');
addCol('utah_warrants', 'statute', 'TEXT');
addCol('utah_warrants', 'disposition', 'TEXT');
addCol('utah_warrants', 'ori', 'TEXT');
addCol('utah_warrants', 'raw_json', 'TEXT');
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "schema expansion"`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/models/database.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): expand utah_warrants table with physical/bond/statute fields"
```

---

### Task 2.2: Expand `UtahApiPerson` / `UtahApiWarrant` type capture

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts:56-86`

**Step 1: Write test with mocked fetch**

Append to `server/tests/unit/utahWarrantScraper.test.ts`:

```typescript
import { vi, beforeEach } from 'vitest';
import { searchUtahWarrantsLive } from '../../src/utils/utahWarrantScraper';

describe('searchUtahWarrantsLive — field capture', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('captures DOB, sex, race, physical description, bond, statute when present', async () => {
    const mockFetch = vi.fn()
      // First call: persons search
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          persons: [{
            id: 'P1',
            name: { first: 'TEST', middle: '', last: 'PERSON' },
            dateOfBirth: '1980-06-15',
            sex: 'M',
            race: 'W',
            heightInches: 72,
            weightLbs: 180,
            eyeColor: 'BLU',
            hairColor: 'BRO',
            homeAddress: { street: '123 MAIN ST', city: 'SLC', state: 'UT', zip: '84101' },
            age: 45,
          }],
        }),
        text: async () => '',
      })
      // Second call: warrants for P1
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          warrants: [{
            id: 'W1',
            issueDate: '2025-01-15',
            court: { name: 'UTAH 3RD DIST', caseId: '251234567' },
            charges: ['41-6a-502 DUI'],
            bondAmount: 5000,
            statute: '41-6a-502',
            disposition: 'ACTIVE',
            ori: 'UT0180100',
          }],
        }),
        text: async () => '',
      });
    vi.stubGlobal('fetch', mockFetch);

    const results = await searchUtahWarrantsLive('TEST', 'PERSON');
    expect(results).not.toBeNull();
    expect(results!.length).toBe(1);
    const r = results![0];
    expect(r.date_of_birth).toBe('1980-06-15');
    expect(r.sex).toBe('M');
    expect(r.race).toBe('W');
    expect(r.height_inches).toBe(72);
    expect(r.weight_lbs).toBe(180);
    expect(r.eye_color).toBe('BLU');
    expect(r.hair_color).toBe('BRO');
    expect(r.home_street).toBe('123 MAIN ST');
    expect(r.home_state).toBe('UT');
    expect(r.home_zip).toBe('84101');
    expect(r.bond_amount).toBe(5000);
    expect(r.statute).toBe('41-6a-502');
    expect(r.disposition).toBe('ACTIVE');
    expect(r.ori).toBe('UT0180100');
    expect(r.raw_json).toBeTruthy(); // JSON string
    const parsed = JSON.parse(r.raw_json!);
    expect(parsed.person.id).toBe('P1');
    expect(parsed.warrant.id).toBe('W1');
  });
});
```

**Step 2: Run, see failure**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts -t "field capture"`
Expected: FAIL — result fields don't exist.

**Step 3: Expand types + mapping**

In `server/src/utils/utahWarrantScraper.ts`:

Replace the `UtahApiPerson` / `UtahApiWarrant` types (lines 58-70):

```typescript
interface UtahApiPerson {
  id: string;
  name: { first: string; middle: string; last: string };
  dateOfBirth?: string;
  sex?: string;
  race?: string;
  heightInches?: number;
  weightLbs?: number;
  eyeColor?: string;
  hairColor?: string;
  homeAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  age?: number | string;
}

interface UtahApiWarrant {
  id: string;
  issueDate: string;
  court: { name: string; caseId: string };
  charges: string[];
  bondAmount?: number;
  statute?: string;
  disposition?: string;
  ori?: string;
}
```

Extend `UtahWarrantResult`:

```typescript
export interface UtahWarrantResult {
  // ...existing...
  date_of_birth: string | null;
  sex: string | null;
  race: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  eye_color: string | null;
  hair_color: string | null;
  home_street: string | null;
  home_state: string | null;
  home_zip: string | null;
  bond_amount: number | null;
  statute: string | null;
  disposition: string | null;
  ori: string | null;
  raw_json: string | null;
}
```

Update the mapping inside `searchUtahWarrantsLive` (lines 223-238):

```typescript
for (const w of warrantData.warrants) {
  results.push({
    utah_person_id: person.id,
    first_name: person.name.first || '',
    middle_name: person.name.middle || null,
    last_name: person.name.last || '',
    age: person.age != null ? (parseInt(String(person.age), 10) || null) : null,
    city: person.homeAddress?.city || null,
    utah_warrant_id: w.id,
    issue_date: w.issueDate || null,
    court_name: w.court?.name || null,
    case_id: w.court?.caseId || null,
    charges: JSON.stringify(w.charges || []),
    source: 'UTAH_STATE',
    date_of_birth: person.dateOfBirth || null,
    sex: person.sex || null,
    race: person.race || null,
    height_inches: typeof person.heightInches === 'number' ? person.heightInches : null,
    weight_lbs: typeof person.weightLbs === 'number' ? person.weightLbs : null,
    eye_color: person.eyeColor || null,
    hair_color: person.hairColor || null,
    home_street: person.homeAddress?.street || null,
    home_state: person.homeAddress?.state || null,
    home_zip: person.homeAddress?.zip || null,
    bond_amount: typeof w.bondAmount === 'number' ? w.bondAmount : null,
    statute: w.statute || null,
    disposition: w.disposition || null,
    ori: w.ori || null,
    raw_json: JSON.stringify({ person, warrant: w }),
  });
}
```

**Step 4: Update `cacheResults` INSERT**

In the same file, update `cacheResults` to persist the new columns:

```typescript
const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO utah_warrants
    (utah_person_id, first_name, middle_name, last_name, age, city,
     utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at,
     date_of_birth, sex, race, height_inches, weight_lbs, eye_color, hair_color,
     home_street, home_state, home_zip, bond_amount, statute, disposition, ori, raw_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

Update the `.run(...)` call to pass the 15 additional params in order.

**Step 5: Run tests**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts`
Expected: PASS.

Run: `cd server && npx vitest run`
Expected: No regressions.

**Step 6: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts server/tests/unit/utahWarrantScraper.test.ts
git commit -m "feat(warrants): capture DOB/physical/bond/statute/ORI fields from Utah API"
```

---

### Task 2.3: Expose new fields in cache-reader + `/utah-search` response

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts:297-342` (cache SELECT)
- No route change needed — `/utah-search` already spreads `results` directly

**Step 1: Update SELECT columns**

Update both branches of `searchUtahWarrantsCache` to SELECT the new columns:

```sql
SELECT utah_person_id, first_name, middle_name, last_name, age, city,
       utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at,
       date_of_birth, sex, race, height_inches, weight_lbs, eye_color, hair_color,
       home_street, home_state, home_zip, bond_amount, statute, disposition, ori, raw_json
FROM utah_warrants
WHERE ...
```

**Step 2: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts
git commit -m "feat(warrants): surface expanded utah_warrants columns from cache reader"
```

---

## Phase 3 — Session-Cookie Warmup

### Task 3.1: Add cookie jar + pre-scan warmup

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts` (add cookie jar module-scope)

**Step 1: Write test**

Append to `server/tests/unit/utahWarrantScraper.test.ts`:

```typescript
describe('Utah scraper cookie warmup', () => {
  it('warms up cookies before scan and reuses them', async () => {
    const { warmUtahSession, getUtahCookieHeader, resetUtahCookies } =
      await import('../../src/utils/utahWarrantScraper');
    resetUtahCookies();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'set-cookie': '_cfuvid=abc123; Path=/; Secure' }),
        text: async () => '<html></html>',
      });
    vi.stubGlobal('fetch', mockFetch);

    await warmUtahSession();
    const cookieHeader = getUtahCookieHeader();
    expect(cookieHeader).toContain('_cfuvid=abc123');
  });

  it('clears cookies after 403 to allow fresh warmup', async () => {
    const { setUtahCookiesFromHeader, invalidateUtahCookies, getUtahCookieHeader } =
      await import('../../src/utils/utahWarrantScraper');
    setUtahCookiesFromHeader('_cfuvid=stale; Path=/');
    expect(getUtahCookieHeader()).toContain('_cfuvid=stale');
    invalidateUtahCookies();
    expect(getUtahCookieHeader()).toBe('');
  });
});
```

**Step 2: Run, see failure**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts -t "cookie warmup"`
Expected: FAIL — functions don't exist.

**Step 3: Implement cookie jar**

In `server/src/utils/utahWarrantScraper.ts`, after the rate-limit tracking near line 54:

```typescript
// ── Cookie jar ───────────────────────────────────────────────
let _utahCookies = new Map<string, string>();

export function resetUtahCookies(): void {
  _utahCookies.clear();
}

export function invalidateUtahCookies(): void {
  _utahCookies.clear();
}

export function setUtahCookiesFromHeader(setCookie: string | string[] | null): void {
  if (!setCookie) return;
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of headers) {
    // Parse "name=value; Path=/; ..." — take only name=value
    const firstSemi = header.indexOf(';');
    const pair = firstSemi === -1 ? header : header.slice(0, firstSemi);
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) _utahCookies.set(name, value);
  }
}

export function getUtahCookieHeader(): string {
  if (_utahCookies.size === 0) return '';
  return Array.from(_utahCookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export async function warmUtahSession(): Promise<void> {
  try {
    const res = await fetch('https://warrants.utah.gov/', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // fetch() returns Headers; getSetCookie() on Node 20+ returns multiple values
    const setCookieValues = typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie');
    if (setCookieValues) setUtahCookiesFromHeader(setCookieValues);
  } catch (err: any) {
    console.warn('[Utah Warrants] Cookie warmup failed:', err.message);
  }
}
```

**Step 4: Wire cookies into `fetchJson`**

In `fetchJson`, inject the cookie header:

```typescript
const cookieHeader = getUtahCookieHeader();
const res = await fetch(url, {
  ...options,
  signal: controller.signal,
  headers: {
    'Content-Type': 'application/json',
    // ... existing headers ...
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    ...(options.headers || {}),
  },
});
```

Also invalidate cookies on any 403 response — add inside the `if (res.status === 403)` block (after CloudFront detection):

```typescript
invalidateUtahCookies(); // Next call will warm up fresh cookies
```

**Step 5: Call warmup at start of scan**

In `_runWarrantWatchScanImpl`, before the loop (after line 473):

```typescript
console.log(`[Warrant Watch] Warming Utah session cookies...`);
await warmUtahSession();
```

**Step 6: Run tests**

Run: `cd server && npx vitest run tests/unit/utahWarrantScraper.test.ts -t "cookie"`
Expected: PASS.

Run: `cd server && npx vitest run`
Expected: No regressions.

**Step 7: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts server/tests/unit/utahWarrantScraper.test.ts
git commit -m "feat(warrants): warm Utah session cookies to reduce CloudFront WAF friction"
```

---

## Phase 4 — Priority Scan Queue

### Task 4.1: Add `warrant_scan_queue` table

**Files:**
- Modify: `server/src/models/database.ts` (new CREATE TABLE + indexes)

**Step 1: Write test**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('warrant_scan_queue schema', () => {
  it('exists with required columns and unique constraint on person_id', async () => {
    const db = (await import('../../src/models/database')).getDb();
    const cols = db.prepare(`PRAGMA table_info(warrant_scan_queue)`).all() as any[];
    const names = new Set(cols.map((c: any) => c.name));
    for (const col of [
      'id', 'person_id', 'tier', 'next_due_at',
      'last_checked_at', 'last_result', 'consecutive_errors', 'created_at',
    ]) {
      expect(names.has(col)).toBe(true);
    }

    // Verify unique on person_id
    const indexes = db.prepare(`PRAGMA index_list(warrant_scan_queue)`).all() as any[];
    const hasUnique = indexes.some((i: any) => i.unique === 1);
    expect(hasUnique).toBe(true);
  });
});
```

**Step 2: Run, see failure**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "warrant_scan_queue schema"`
Expected: FAIL.

**Step 3: Add CREATE TABLE + indexes**

In `server/src/models/database.ts`, find the warrant section near line 4458. Add within the same block:

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS warrant_scan_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'cold',
    next_due_at TEXT NOT NULL,
    last_checked_at TEXT,
    last_result TEXT,
    consecutive_errors INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_warrant_scan_queue_due ON warrant_scan_queue(tier, next_due_at)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_warrant_scan_queue_person ON warrant_scan_queue(person_id)`).run();
```

Note: per CLAUDE.md Gotcha #42, use single-statement `.prepare().run()` calls, not the bulk multi-statement form.

**Step 4: Run test**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "warrant_scan_queue schema"`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/models/database.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): add warrant_scan_queue table for tiered scanning"
```

---

### Task 4.2: Tier reclassification logic

**Files:**
- Create: `server/src/utils/warrantScanQueue.ts`
- Test: `server/tests/unit/warrantScanQueue.test.ts`

**Step 1: Write failing test**

Create `server/tests/unit/warrantScanQueue.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDataDir, teardownTestDataDir } from '../helpers/testDb';
import { rebuildScanQueue, computePersonTier, type ScanTier } from '../../src/utils/warrantScanQueue';

let testDir: string;
let db: any;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  db = initDatabase();
});

describe('computePersonTier', () => {
  it('returns hot when person was arrested in last 30 days', () => {
    // Seed person + arrest
    const r1 = db.prepare("INSERT INTO persons (first_name, last_name) VALUES ('A', 'B')").run();
    const personId = Number(r1.lastInsertRowid);
    db.prepare(
      "INSERT INTO arrest_records (person_id, arrest_datetime) VALUES (?, datetime('now','-10 days'))"
    ).run(personId);

    const tier = computePersonTier(personId);
    expect(tier).toBe<ScanTier>('hot');
  });

  it('returns warm when person had incident in last 90 days', () => {
    const r1 = db.prepare("INSERT INTO persons (first_name, last_name) VALUES ('C', 'D')").run();
    const personId = Number(r1.lastInsertRowid);
    db.prepare(`
      INSERT INTO incidents (incident_number, title, status, created_at)
      VALUES ('INC-1', 't', 'open', datetime('now','-60 days'))
    `).run();
    const inc = Number(db.prepare("SELECT last_insert_rowid() as id").get().id);
    db.prepare(`
      INSERT INTO incident_persons (incident_id, person_id, role)
      VALUES (?, ?, 'subject')
    `).run(inc, personId);

    const tier = computePersonTier(personId);
    expect(tier).toBe<ScanTier>('warm');
  });

  it('returns cold for inactive persons', () => {
    const r1 = db.prepare("INSERT INTO persons (first_name, last_name) VALUES ('E', 'F')").run();
    const personId = Number(r1.lastInsertRowid);
    const tier = computePersonTier(personId);
    expect(tier).toBe<ScanTier>('cold');
  });
});

describe('rebuildScanQueue', () => {
  it('creates queue entries for all non-archived persons', () => {
    rebuildScanQueue();
    const queueCount = (db.prepare('SELECT COUNT(*) as cnt FROM warrant_scan_queue').get() as any).cnt;
    const personCount = (db.prepare('SELECT COUNT(*) as cnt FROM persons WHERE archived_at IS NULL').get() as any).cnt;
    expect(queueCount).toBe(personCount);
  });

  it('is idempotent — re-running does not duplicate rows', () => {
    rebuildScanQueue();
    const c1 = (db.prepare('SELECT COUNT(*) as cnt FROM warrant_scan_queue').get() as any).cnt;
    rebuildScanQueue();
    const c2 = (db.prepare('SELECT COUNT(*) as cnt FROM warrant_scan_queue').get() as any).cnt;
    expect(c1).toBe(c2);
  });
});
```

**Step 2: Run, see failure**

Run: `cd server && npx vitest run tests/unit/warrantScanQueue.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `server/src/utils/warrantScanQueue.ts`:

```typescript
// ============================================================
// Warrant Scan Queue — Tiered Priority Scheduling
// ============================================================
// Replaces "scan every person every 4h" with a priority queue:
//   hot  — arrested in last 30d, on active case, or flagged. Hourly.
//   warm — named on an incident/citation/FI in last 90d. Every 4h.
//   cold — everyone else. Weekly, spread across the week.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

export type ScanTier = 'hot' | 'warm' | 'cold';

const HOT_INTERVAL_MS = 60 * 60 * 1000;           // 1h
const WARM_INTERVAL_MS = 4 * 60 * 60 * 1000;      // 4h
const COLD_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

/** Compute tier for a single person from recent activity. */
export function computePersonTier(personId: number): ScanTier {
  const db = getDb();

  // Hot: arrested in last 30 days
  const arrestHit = db.prepare(`
    SELECT 1 FROM arrest_records
    WHERE person_id = ?
      AND arrest_datetime >= datetime('now','-30 days')
    LIMIT 1
  `).get(personId);
  if (arrestHit) return 'hot';

  // Hot: listed as warrant subject with active status
  const warrantHit = db.prepare(`
    SELECT 1 FROM warrants
    WHERE subject_person_id = ?
      AND status = 'active'
      AND archived_at IS NULL
    LIMIT 1
  `).get(personId);
  if (warrantHit) return 'hot';

  // Warm: incident_persons in last 90 days
  const incidentHit = db.prepare(`
    SELECT 1 FROM incident_persons ip
    JOIN incidents i ON i.id = ip.incident_id
    WHERE ip.person_id = ?
      AND i.created_at >= datetime('now','-90 days')
    LIMIT 1
  `).get(personId);
  if (incidentHit) return 'warm';

  // Warm: citation in last 90 days
  const citationHit = db.prepare(`
    SELECT 1 FROM citations
    WHERE subject_person_id = ?
      AND issued_at >= datetime('now','-90 days')
    LIMIT 1
  `).get(personId);
  if (citationHit) return 'warm';

  return 'cold';
}

/** Milliseconds from last check until next check for a given tier. */
export function intervalForTier(tier: ScanTier): number {
  switch (tier) {
    case 'hot':  return HOT_INTERVAL_MS;
    case 'warm': return WARM_INTERVAL_MS;
    case 'cold': return COLD_INTERVAL_MS;
  }
}

/** Spread cold-tier next_due across the week to smooth load. */
function spreadColdDueAt(personId: number, now: Date): Date {
  const weekMinutes = 7 * 24 * 60;
  const offset = (personId * 7919) % weekMinutes; // prime multiplier for distribution
  const due = new Date(now);
  due.setMinutes(due.getMinutes() + offset);
  return due;
}

/** (Re)build the scan queue from `persons` activity. Idempotent. */
export function rebuildScanQueue(): { inserted: number; updated: number; removed: number } {
  const db = getDb();
  const now = new Date();

  let inserted = 0;
  let updated = 0;

  const persons = db.prepare(`
    SELECT id FROM persons WHERE archived_at IS NULL
  `).all() as { id: number }[];

  const upsert = db.prepare(`
    INSERT INTO warrant_scan_queue (person_id, tier, next_due_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET
      tier = excluded.tier,
      next_due_at = CASE
        WHEN warrant_scan_queue.tier != excluded.tier THEN excluded.next_due_at
        ELSE warrant_scan_queue.next_due_at
      END
  `);

  const txn = db.transaction(() => {
    for (const p of persons) {
      const tier = computePersonTier(p.id);
      const due = tier === 'cold' ? spreadColdDueAt(p.id, now) : now;
      const result = upsert.run(p.id, tier, due.toISOString(), localNow());
      if (result.changes > 0) {
        // SQLite doesn't distinguish insert vs update on conflict — count all as updated
        updated++;
      }
    }
  });

  txn();

  // Remove queue entries for archived/deleted persons
  const removed = db.prepare(`
    DELETE FROM warrant_scan_queue WHERE person_id NOT IN (
      SELECT id FROM persons WHERE archived_at IS NULL
    )
  `).run().changes;

  return { inserted, updated, removed };
}

/** Get next batch of persons due for scan, by tier priority. */
export function nextBatchDue(limit: number): Array<{ person_id: number; tier: ScanTier }> {
  const db = getDb();
  return db.prepare(`
    SELECT person_id, tier FROM warrant_scan_queue
    WHERE next_due_at <= ?
    ORDER BY
      CASE tier WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
      next_due_at ASC
    LIMIT ?
  `).all(new Date().toISOString(), limit) as Array<{ person_id: number; tier: ScanTier }>;
}

/** Mark a person checked and reschedule based on tier. */
export function markChecked(
  personId: number,
  result: 'hit' | 'clear' | 'error' | 'blocked'
): void {
  const db = getDb();
  const row = db.prepare(`
    SELECT tier, consecutive_errors FROM warrant_scan_queue WHERE person_id = ?
  `).get(personId) as { tier: ScanTier; consecutive_errors: number } | undefined;
  if (!row) return;

  const now = new Date();
  let nextDue: Date;
  let errors = row.consecutive_errors;

  if (result === 'error' || result === 'blocked') {
    errors = Math.min(errors + 1, 8);
    // Exponential backoff on errors, capped at 24h
    const backoffMs = Math.min(
      intervalForTier(row.tier) * Math.pow(2, errors - 1),
      24 * 60 * 60 * 1000
    );
    nextDue = new Date(now.getTime() + backoffMs);
  } else {
    errors = 0;
    nextDue = new Date(now.getTime() + intervalForTier(row.tier));
  }

  db.prepare(`
    UPDATE warrant_scan_queue
    SET last_checked_at = ?, last_result = ?, consecutive_errors = ?, next_due_at = ?
    WHERE person_id = ?
  `).run(localNow(), result, errors, nextDue.toISOString(), personId);
}

/** Push a person to hot tier immediately (e.g. just arrested). */
export function enqueueHot(personId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO warrant_scan_queue (person_id, tier, next_due_at, created_at)
    VALUES (?, 'hot', ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET
      tier = 'hot', next_due_at = excluded.next_due_at
  `).run(personId, now, localNow());
}

/** Queue stats for the admin UI. */
export function getQueueStats(): {
  hot: number; warm: number; cold: number;
  due: number; error: number; blocked: number;
} {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN tier = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN tier = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN tier = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN next_due_at <= ? THEN 1 ELSE 0 END) as due,
      SUM(CASE WHEN last_result = 'error' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN last_result = 'blocked' THEN 1 ELSE 0 END) as blocked
    FROM warrant_scan_queue
  `).get(now) as any;
  return {
    hot: row.hot || 0, warm: row.warm || 0, cold: row.cold || 0,
    due: row.due || 0, error: row.error || 0, blocked: row.blocked || 0,
  };
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/unit/warrantScanQueue.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/utils/warrantScanQueue.ts server/tests/unit/warrantScanQueue.test.ts
git commit -m "feat(warrants): tiered scan queue (hot/warm/cold) with activity-based classification"
```

---

### Task 4.3: Integrate queue into `runWarrantWatchScan`

**Files:**
- Modify: `server/src/utils/utahWarrantScraper.ts` — `_runWarrantWatchScanImpl`

**Step 1: Refactor main scan loop**

Replace the `persons` query at line 464 with a call to the queue:

```typescript
import { nextBatchDue, markChecked, rebuildScanQueue } from './warrantScanQueue';

// ... inside _runWarrantWatchScanImpl, after cookie warmup:

// Legacy fallback via env flag
const legacyMode = process.env.WARRANT_SCAN_MODE === 'legacy';

let personIds: Array<{ person_id: number; tier?: string }>;
if (legacyMode) {
  personIds = (db.prepare(`
    SELECT id as person_id FROM persons
    WHERE first_name IS NOT NULL AND first_name != ''
      AND last_name IS NOT NULL AND last_name != ''
      AND archived_at IS NULL
    ORDER BY last_name, first_name
  `).all()) as Array<{ person_id: number }>;
} else {
  // Fetch current batch from queue (hot + warm priorities first, cold by due-time)
  const batch = nextBatchDue(30); // one scan cycle = 30 persons max
  personIds = batch;
}

// Enrich person_id → full row for scanning
const persons = personIds
  .map(({ person_id, tier }) => {
    const p = db.prepare(`
      SELECT id, first_name, last_name, dob FROM persons
      WHERE id = ? AND first_name != '' AND last_name != '' AND archived_at IS NULL
    `).get(person_id) as any;
    return p ? { ...p, _tier: tier } : null;
  })
  .filter(Boolean) as Array<{ id: number; first_name: string; last_name: string; dob: string | null; _tier?: string }>;
```

In the per-person loop, after scan completes, call `markChecked`:

```typescript
if (!legacyMode) {
  if (results === null) {
    markChecked(person.id, isUtahApiBlocked() ? 'blocked' : 'error');
  } else if (foundWarrantIds.size > 0) {
    markChecked(person.id, 'hit');
  } else {
    markChecked(person.id, 'clear');
  }
}
```

**Step 2: Schedule nightly queue rebuild**

In `scheduleUtahWarrantSync`, add a 24h interval to call `rebuildScanQueue()`:

```typescript
import { rebuildScanQueue } from './warrantScanQueue';

// ... inside scheduleUtahWarrantSync, after cleanupIntervalHandle setup:

// Nightly queue rebuild — recomputes tiers based on fresh activity
const queueRebuildHandle = setInterval(() => {
  try {
    const stats = rebuildScanQueue();
    console.log(`[Warrant Watch] Queue rebuild: ${stats.updated} entries, ${stats.removed} removed`);
  } catch (e: any) {
    console.warn('[Warrant Watch] Queue rebuild error:', e?.message);
  }
}, 24 * 60 * 60 * 1000);
if (queueRebuildHandle.unref) queueRebuildHandle.unref();

// Initial rebuild on startup
setTimeout(() => {
  try { rebuildScanQueue(); } catch (e: any) { console.warn('[Warrant Watch] Initial queue build failed:', e?.message); }
}, 60_000).unref?.();
```

**Step 3: Switch scan cadence**

Change `SCAN_INTERVAL_MS` from 4h to **1h** — with the queue, hot persons get checked hourly; warm and cold wait their turn.

```typescript
const SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1h cycles — queue governs per-person cadence
```

**Step 4: Test integration**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('Warrant watch scan — queue integration', () => {
  it('markChecked updates next_due_at based on tier after successful scan', async () => {
    const { markChecked, enqueueHot } = await import('../../src/utils/warrantScanQueue');
    const db = (await import('../../src/models/database')).getDb();

    // Insert a test person + queue entry
    const r = db.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Q', 'Test')").run();
    const personId = Number(r.lastInsertRowid);
    enqueueHot(personId);

    markChecked(personId, 'clear');

    const row = db.prepare('SELECT next_due_at, last_result FROM warrant_scan_queue WHERE person_id = ?').get(personId) as any;
    expect(row.last_result).toBe('clear');
    const nextDue = new Date(row.next_due_at).getTime();
    const now = Date.now();
    // Hot tier = 1h interval, tolerate ±10min skew
    expect(nextDue - now).toBeGreaterThan(50 * 60 * 1000);
    expect(nextDue - now).toBeLessThan(70 * 60 * 1000);
  });

  it('markChecked on error applies exponential backoff', async () => {
    const { markChecked, enqueueHot } = await import('../../src/utils/warrantScanQueue');
    const db = (await import('../../src/models/database')).getDb();
    const r = db.prepare("INSERT INTO persons (first_name, last_name) VALUES ('E', 'Err')").run();
    const personId = Number(r.lastInsertRowid);
    enqueueHot(personId);

    markChecked(personId, 'error');
    markChecked(personId, 'error');
    markChecked(personId, 'error');

    const row = db.prepare('SELECT consecutive_errors, next_due_at FROM warrant_scan_queue WHERE person_id = ?').get(personId) as any;
    expect(row.consecutive_errors).toBe(3);
    const delay = new Date(row.next_due_at).getTime() - Date.now();
    // 3 errors: 1h * 2^2 = 4h backoff
    expect(delay).toBeGreaterThan(3.5 * 60 * 60 * 1000);
  });
});
```

**Step 5: Run**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "queue integration"`
Expected: PASS.

Run: `cd server && npx vitest run`
Expected: No regressions.

**Step 6: Commit**

```bash
git add server/src/utils/utahWarrantScraper.ts server/src/utils/warrantScanQueue.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): integrate priority scan queue into watch run"
```

---

### Task 4.4: Expose scan queue via API endpoints

**Files:**
- Modify: `server/src/routes/warrants.ts` — append three endpoints

**Step 1: Write tests**

Append to `server/tests/integration/warrants.test.ts`:

```typescript
describe('GET /api/warrants/scan-queue', () => {
  it('returns tier counts and due backlog', async () => {
    const res = await request(app)
      .get('/api/warrants/scan-queue')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hot');
    expect(res.body).toHaveProperty('warm');
    expect(res.body).toHaveProperty('cold');
    expect(res.body).toHaveProperty('due');
  });
});

describe('POST /api/warrants/scan-queue/enqueue/:personId', () => {
  it('pushes a person to hot tier', async () => {
    const res = await request(app)
      .post(`/api/warrants/scan-queue/enqueue/${testPersonId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('hot');
  });
});
```

**Step 2: Run, see failure**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "scan-queue"`
Expected: FAIL — routes don't exist.

**Step 3: Implement endpoints**

At the top of `warrants.ts`, add the import:
```typescript
import { getQueueStats, rebuildScanQueue, enqueueHot, markChecked } from '../utils/warrantScanQueue';
```

Append before the last route (or before `export default router`):

```typescript
// GET /api/warrants/scan-queue — tier stats for admin UI
router.get('/scan-queue', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    res.json(getQueueStats());
  } catch (error: any) {
    console.error('Get scan queue error:', error);
    res.status(500).json({ error: 'Failed to fetch scan queue', code: 'SCAN_QUEUE_ERROR' });
  }
});

// POST /api/warrants/scan-queue/rebuild — force tier reclassification
router.post('/scan-queue/rebuild', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const stats = rebuildScanQueue();
    res.json({ success: true, ...stats });
  } catch (error: any) {
    console.error('Rebuild scan queue error:', error);
    res.status(500).json({ error: 'Failed to rebuild queue', code: 'SCAN_QUEUE_REBUILD_ERROR' });
  }
});

// POST /api/warrants/scan-queue/enqueue/:personId — push to hot tier
router.post('/scan-queue/enqueue/:personId', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const personId = parseInt(req.params.personId as string, 10);
    if (!personId || isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person id', code: 'INVALID_PERSON_ID' });
      return;
    }
    const db = getDb();
    const exists = db.prepare('SELECT id FROM persons WHERE id = ?').get(personId);
    if (!exists) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }
    enqueueHot(personId);
    auditLog(req, 'UPDATE' as any, 'warrant' as any, personId, 'Enqueued to hot tier for Utah warrant scan');
    res.json({ success: true, person_id: personId, tier: 'hot' });
  } catch (error: any) {
    console.error('Enqueue hot error:', error);
    res.status(500).json({ error: 'Failed to enqueue', code: 'ENQUEUE_ERROR' });
  }
});
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "scan-queue"`
Expected: PASS.

Run full regression: `cd server && npx vitest run`
Expected: All PASS.

**Step 5: Route-collision check**

Run: `cd server && npm run check:routes`
Expected: 0 duplicate METHOD+path handlers.

**Step 6: Commit**

```bash
git add server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): scan-queue API endpoints (stats, rebuild, enqueue)"
```

---

### Task 4.5: Surface `partial_errors` from universal scanner

**Files:**
- Modify: `server/src/utils/universalWarrantScanner.ts`
- Modify: `server/src/routes/warrants.ts` — `/check/:personId` endpoint

**Step 1: Pass partial-error flag through**

Inspect `universalWarrantCheck` return shape. If it calls Utah scraper, surface the `partialErrors` bit in its return. Then update the route:

```typescript
// /check/:personId
const result = await universalWarrantCheck(personId);
res.json({
  ...result,
  partial_errors: result.partialErrors || false,
});
```

**Step 2: Add basic test**

Append:

```typescript
it('/check/:personId returns partial_errors flag', async () => {
  const res = await request(app)
    .get(`/api/warrants/check/${testPersonId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('partial_errors');
});
```

**Step 3: Run, implement, commit**

Run tests, iterate until green.

```bash
git add server/src/utils/universalWarrantScanner.ts server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): surface partial_errors from universal scanner"
```

---

## Phase 5 — UI Overhaul (separate plan)

Phase 5 implements the UI per [2026-04-06 design](./2026-04-06-warrants-overhaul-design.md). After Phase 4 ships and bakes in production for 48h, create a new plan file `docs/plans/2026-04-XX-warrants-ui-overhaul.md` and execute it.

Phase 5 preview (NOT part of this plan):
- `addCol` migrations on `warrants` (OCA/ORI/NCIC/extradition/caution_flags/assigned_*)
- `addCol` on `warrant_service_attempts` (GPS/photos/signature)
- Assignment board, analytics, timeline, map-data endpoints
- WarrantsPage rewrite (top/bottom CAD split)

---

## Deployment Checklist

After all of Phase 1-4 lands on `claude/trusting-banach`:

1. **Bump service-worker cache**: `client/public/sw.js` — bump `CACHE_NAME` (per CLAUDE.md rule)
2. **Local typecheck**: `cd client && npx tsc --noEmit` — must be 0 errors
3. **Server tests**: `cd server && npx vitest run` — all pass
4. **Route collision**: `cd server && npm run check:routes` — 0 duplicates
5. **Deploy to VPS**: `bash deploy/deploy.sh`
6. **Verify health**: `curl -sf https://rmpgutah.us/api/health`
7. **Watch logs for scan activity**: `ssh root@194.113.64.90 "journalctl -u rmpg-flex -n 200 --no-pager | grep -iE 'warrant|utah'"`
8. **Confirm queue populated**: `ssh root@194.113.64.90 "cd /opt/rmpg-flex/server && sqlite3 data/rmpg-flex.db 'SELECT tier, COUNT(*) FROM warrant_scan_queue GROUP BY tier;'"`
9. **24h observation**: verify no `WARRANT_SCAN_MODE=legacy` fallback needed

## Rollback

- Any phase: `git revert <commit>` — each task is its own commit
- Scan queue issues only: set `WARRANT_SCAN_MODE=legacy` in `/opt/rmpg-flex/server/.env` and restart the service — falls back to flat scan. No code revert needed.
- Schema columns: additive only; no rollback needed. `DROP COLUMN` is avoided entirely.
