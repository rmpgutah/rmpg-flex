# Geography Rebuild — Areas / Sectors / Zones / Beats — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the dispatch geography system on a 4-tier Areas→Sectors→Zones→Beats model, seed it from real Utah GeoJSON (6 AOGs, 29 counties, ~287 municipalities+unincorporated, 719 beats), rename the second tier from "sections" to "sectors" throughout the codebase, and replace the broken 1,040-line GeographyPage with a Spillman-style 4-column Miller-drilldown UI.

**Architecture:** Three mechanical+creative commits executed in order: (1) pure find-and-replace rename `section` → `sector` with zero behavior change, (2) schema migration + GeoJSON seed + API rewrite, (3) GeographyPage.tsx full rewrite with a 4-column Miller layout. Every task follows TDD: failing test first, minimal implementation, passing test, commit. Phase 0 handles a pre-existing Express version drift that would otherwise break CI on the first `npm install`.

**Tech Stack:** Server: Express 4 + better-sqlite3 + TypeScript + vitest + supertest. Client: React 18 + Vite 6 + Tailwind + TypeScript. Idempotent DB migrations via `database.ts` boot block. Pure-black Spillman theme via existing CSS variables.

**Design doc:** [docs/plans/2026-04-10-geography-areas-sectors-zones-beats-design.md](2026-04-10-geography-areas-sectors-zones-beats-design.md) — read this first if the executor wasn't in the brainstorming session.

---

## Risk flagged at planning time — RESOLVE FIRST

`server/package.json` has an Express drift that will break CI. The committed file currently declares `"express": "^5.2.1"` and `"@types/express": "^5.0.6"`, but `node_modules/express` still has version `4.22.1` installed from an older lockfile. The server boots fine locally because it is using the stale install. **The first clean `npm install` anyone runs will pull Express 5, and Express 5 is incompatible with the `path-to-regexp: "0.1.13"` override added in `361ffccc` — Express 5 natively uses path-to-regexp 8.x with named exports.** The geography work cannot be verified until this is resolved.

**Fix scope for this plan:** Revert Express to 4.x (the last-known-working version). Express 5 migration is a separate future feature. Phase 0 handles this.

---

## Phase summary

| Phase | What | Why first | Est. tasks |
|---|---|---|---|
| Phase 0 | Resolve Express drift + establish baseline | Unblocks all subsequent testing | 4 |
| Phase 1 | Mechanical rename `section` → `sector` | Zero behavior change, lowest risk first | 7 |
| Phase 2 | Schema migration + GeoJSON seed + API rewrite | Data layer before UI | 12 |
| Phase 3 | GeographyPage.tsx rewrite with Miller drilldown | UI is last because it depends on the new API | 10 |
| Phase 4 | Deploy + smoke + rollback docs | Production validation | 3 |

Each task = 2–5 minutes of focused work. Each ends with a commit or an explicit "no commit yet" note.

---

# Phase 0 — Preflight: Unblock main

**Goal of phase:** Get `npm install` in `server/` to succeed and the boot smoke test to stay green, so every subsequent task's verification gate actually runs.

---

### Task 0.1: Verify the Express drift is real

**Files:** Read-only

**Step 1:** Check committed package.json

Run: `cd "/Users/rmpgutah/RMPG Flex" && grep -E '"express"|"express-rate-limit"|"@types/express"|"path-to-regexp"' server/package.json`

Expected output includes `"express": "^5.2.1"`, `"@types/express": "^5.0.6"`, `"path-to-regexp": "0.1.13"`.

**Step 2:** Check installed Express version

Run: `cat server/node_modules/express/package.json | grep version`

Expected: `"version": "4.22.1"` (stale install — does NOT match package.json).

**Step 3:** Confirm reinstall reproduces the drift

Run: `cd server && rm -rf node_modules/express node_modules/path-to-regexp && npm install --ignore-scripts --legacy-peer-deps 2>&1 | tail -5 && cat node_modules/express/package.json | grep version`

Expected: `"version": "5.2.1"` or similar 5.x. This confirms the drift.

**Step 4:** Confirm boot crashes under Express 5 + path-to-regexp 0.1.13 pin

Run a short-lived background boot:

```bash
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/boot0.log 2>&1 &
BOOT_PID=$!
sleep 5
kill $BOOT_PID 2>/dev/null
sleep 1
kill -9 $BOOT_PID 2>/dev/null
grep -iE "pathRegexp|Missing parameter|TypeError" /tmp/boot0.log | head -5
```

Expected: A crash line mentioning `TypeError: pathRegexp is not a function` or `TypeError: Missing parameter name`. This is the failure mode the plan prevents.

**No commit** — diagnosis only.

---

### Task 0.2: Revert Express to 4.x

**Files:**
- Modify: `server/package.json`

**Step 1:** Edit `server/package.json`

Change these fields:

```diff
- "express": "^5.2.1",
+ "express": "^4.21.2",
```

```diff
- "@types/express": "^5.0.6",
+ "@types/express": "^4.17.21",
```

Leave `express-rate-limit: "^8.3.2"` as-is — it is compatible with Express 4.

Leave the `overrides` block exactly as it is (`path-to-regexp: "0.1.13"`) — that is the correct pin for Express 4.

**Step 2:** Clean reinstall

Run: `cd server && rm -rf node_modules package-lock.json && npm install --ignore-scripts --legacy-peer-deps 2>&1 | tail -8`

Expected: `added NNN packages` with no errors.

**Step 3:** Verify installed Express is 4.x

Run: `cat server/node_modules/express/package.json | grep version`

Expected: `"version": "4.21.2"` or similar 4.x.

**Step 4:** Verify path-to-regexp is the pinned version

Run: `find server/node_modules -name path-to-regexp -maxdepth 6 -type d -exec cat {}/package.json \; 2>/dev/null | grep '"version"' | head -3`

Expected: All instances show `"version": "0.1.13"`.

**Step 5:** Boot smoke test

Run:

```bash
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/boot_phase0.log 2>&1 &
BOOT_PID=$!
sleep 5
kill $BOOT_PID 2>/dev/null
sleep 1
kill -9 $BOOT_PID 2>/dev/null
grep -iE "WebSocket server initialized|RMPG Flex CAD/RMS Server" /tmp/boot_phase0.log
grep -iE "error|pathRegexp|uncaught|crash" /tmp/boot_phase0.log || echo "no errors"
```

Expected:
- `WebSocket server initialized` and `RMPG Flex CAD/RMS Server` lines present
- No error lines

**Step 6:** Commit

```bash
cd "/Users/rmpgutah/RMPG Flex"
git add server/package.json server/package-lock.json
git commit -m "fix(server): revert Express to 4.21.x (drift from 5.2.1 was breaking CI)"
```

Write the full commit body in the commit message — mention the drift, the incompatibility with the path-to-regexp 0.1.13 pin, and the verification steps.

---

### Task 0.3: Run full baseline verification

**Files:** Read-only

**Step 1:** Server TypeScript check — run `cd server && npx tsc --noEmit`, expect exit 0.

**Step 2:** Server test suite — run `cd server && npx vitest run`, expect `343 passed` (or whatever the actual count is — record this as `BASELINE_SERVER_TESTS`).

**Step 3:** Client TypeScript check — run `cd client && npx tsc --noEmit 2>&1 | grep -c "error TS"`, record the number as `BASELINE_CLIENT_TS_ERRORS` (expected ~130 per CLAUDE.md).

**Step 4:** Client Vite build — run `cd client && npx vite build`, expect success.

**Step 5:** Duplicate-routes check — run `cd server && npm run check:routes`, expect 0 duplicates.

**No commit** — baseline measurement only.

---

### Task 0.4: Push Phase 0

**Files:** none (push only)

**Step 1:** Push to main

```bash
cd "/Users/rmpgutah/RMPG Flex"
git pull --rebase origin main && git push origin main
```

Expected: push succeeds with the Phase 0 commit on top of main.

---

# Phase 1 — Mechanical rename (commit 1)

**Goal of phase:** Rename everything `section` → `sector` across the codebase with zero behavior change. Keep the DB migration minimal. Tests and builds must be green the entire time. No new features, no logic changes, no deletions of old endpoints yet — that is commit 2.

---

### Task 1.1: Write the migration block for database.ts

**Files:**
- Modify: `server/src/models/database.ts`

**Step 1:** Locate the existing `dispatch_sections` block

Run: `grep -n "dispatch_sections" server/src/models/database.ts | head -10`

Record the line numbers. You will insert the migration just before the existing `CREATE TABLE IF NOT EXISTS dispatch_sections` block so the rename runs before the fresh-DB create.

**Step 2:** Insert the idempotent rename migration

Find the right place in the migration function. Add this block BEFORE the `dispatch_sections` create statement:

```typescript
// ── Migration: rename dispatch_sections → dispatch_sectors ──
// Idempotent: checks sqlite_master first so it is a no-op on fresh DBs.
try {
  const oldExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_sections'"
  ).get();
  const newExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_sectors'"
  ).get();
  if (oldExists && !newExists) {
    db.prepare('ALTER TABLE dispatch_sections RENAME TO dispatch_sectors').run();
    console.log('[migrate] Renamed dispatch_sections → dispatch_sectors');
  }

  // Rename FK columns on consuming tables (wrapped per-table because the
  // column may not exist yet on a fresh DB).
  const consumerTables = ['calls_for_service', 'incidents'];
  for (const table of consumerTables) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
      const hasOld = cols.some((c) => c.name === 'section_id');
      const hasNew = cols.some((c) => c.name === 'sector_id');
      if (hasOld && !hasNew) {
        db.prepare(`ALTER TABLE ${table} RENAME COLUMN section_id TO sector_id`).run();
        console.log(`[migrate] Renamed ${table}.section_id → sector_id`);
      }
    } catch (e: any) {
      console.log(`[migrate] ${table} section_id rename skipped: ${e.message}`);
    }
  }

  // Rebuild indexes
  try {
    db.prepare('DROP INDEX IF EXISTS idx_sections_area').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sectors_area ON dispatch_sectors(area_id)').run();
  } catch { /* best effort */ }
} catch (err: any) {
  console.log('[migrate] Section → sector rename:', err.message);
}
```

**Step 3:** Change the fresh-DB create from `dispatch_sections` to `dispatch_sectors`

Find the existing `CREATE TABLE IF NOT EXISTS dispatch_sections (...)` block (used via `db.prepare(...).run()` or similar). Change the table name to `dispatch_sectors` and rename the two columns `section_code` → `sector_code` and `section_name` → `sector_name`. Leave other columns unchanged.

**Step 4:** Server TypeScript check

Run: `cd server && npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: `0`.

**No commit yet.**

---

### Task 1.2: Delete local DB and boot to trigger migration

**Files:** Delete local DB only (never touch production)

**Step 1:** Backup the local DB — `cp server/data/rmpg-flex.db /tmp/rmpg-flex.db.pre-phase1.bak`

**Step 2:** Delete — `rm server/data/rmpg-flex.db server/data/rmpg-flex.db-shm server/data/rmpg-flex.db-wal 2>/dev/null`

**Step 3:** Boot server and observe migration logs

```bash
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/boot1.log 2>&1 &
BOOT_PID=$!
sleep 5
kill $BOOT_PID 2>/dev/null
sleep 1
kill -9 $BOOT_PID 2>/dev/null
grep -iE "sectors|section" /tmp/boot1.log | head -10
grep -iE "error|uncaught|crash" /tmp/boot1.log | head -5 || echo "no errors"
```

Expected: A line showing `dispatch_sectors` created on a fresh DB, no error lines.

**Step 4:** Verify table exists with new name

Run: `sqlite3 server/data/rmpg-flex.db ".schema dispatch_sectors"`

Expected: Shows `CREATE TABLE dispatch_sectors` with `sector_code` and `sector_name` columns.

**Step 5:** Verify old table does NOT exist

Run: `sqlite3 server/data/rmpg-flex.db ".schema dispatch_sections"` — expected no output.

**No commit yet.**

---

### Task 1.3: Rename in districts.ts API routes (file still called districts.ts for now — full rename is Phase 2)

**Files:**
- Modify: `server/src/routes/dispatch/districts.ts`

**Step 1:** Apply the rename with sed

```bash
cd "/Users/rmpgutah/RMPG Flex"
sed -i.bak \
  -e 's/dispatch_sections/dispatch_sectors/g' \
  -e 's/section_id/sector_id/g' \
  -e 's/section_name/sector_name/g' \
  -e 's/section_code/sector_code/g' \
  server/src/routes/dispatch/districts.ts
rm server/src/routes/dispatch/districts.ts.bak
```

**Step 2:** Verify

Run: `grep -nE "dispatch_sections|section_id|section_name|section_code" server/src/routes/dispatch/districts.ts`

Expected: no output.

**Step 3:** Do NOT delete the old `/geography/sections*` URL endpoints yet — both URL sets coexist through Phase 1 for safety. Verify they still exist:

Run: `grep -cE "router\\.(get|post|put|delete)\\('/geography/sections" server/src/routes/dispatch/districts.ts`

Expected: a positive number (the old route set is still there).

**Step 4:** Server tsc — run `cd server && npx tsc --noEmit`, expect 0 errors.

**No commit yet.**

---

### Task 1.4: Rename in consuming server files

**Files:** grep to find the list authoritatively

**Step 1:** Find all server files referencing the old names

```bash
cd "/Users/rmpgutah/RMPG Flex"
grep -rlE "dispatch_sections|section_id|section_name|section_code" server/src/ --include="*.ts" | grep -v "__tests__" | grep -v "districts.ts"
```

**Step 2:** For EACH file in the output, apply the sed rename

```bash
FILE="server/src/routes/dispatch/calls.ts"  # substitute each file
sed -i.bak \
  -e 's/dispatch_sections/dispatch_sectors/g' \
  -e 's/section_id/sector_id/g' \
  -e 's/section_name/sector_name/g' \
  -e 's/section_code/sector_code/g' \
  "$FILE"
rm "$FILE.bak"
```

Caution: the rename targets specific strings only. It will NOT rename comments containing the English word "section" or function names like `parseSection()`. If tsc in Task 1.6 flags a renamed identifier that should not have been renamed, revert that instance by hand.

**Step 3:** Verify no lingering old names

```bash
grep -rnE "dispatch_sections|section_id[^s]|section_name|section_code" server/src/ --include="*.ts" | grep -v "__tests__"
```

Expected: only matches in English comments, no SQL or API references.

**No commit yet.**

---

### Task 1.5: Rename in client files (server-facing identifiers only)

**Files:** grep to find the list

**Step 1:** Find all client files

```bash
cd "/Users/rmpgutah/RMPG Flex"
grep -rlE "section_id|section_name|section_code|/geography/sections" client/src/ --include="*.ts" --include="*.tsx"
```

**Step 2:** Apply the rename to each file EXCEPT `client/src/pages/GeographyPage.tsx`

```bash
FILE="client/src/pages/DispatchPage.tsx"  # substitute each file
sed -i.bak \
  -e 's/section_id/sector_id/g' \
  -e 's/section_name/sector_name/g' \
  -e 's/section_code/sector_code/g' \
  "$FILE"
rm "$FILE.bak"
```

**Do NOT blindly replace** `/geography/sections` → `/geography/sectors` in `GeographyPage.tsx`. That file is about to be fully rewritten in Phase 3. For GeographyPage.tsx, touch only the column/property name references (the simple field renames) and leave URL literals alone until Phase 2.

**Step 3:** For the other client files, update any URL literal referring to the sections endpoint

```bash
grep -rn "/geography/sections" client/src/ --include="*.ts" --include="*.tsx"
```

If there are hits outside GeographyPage.tsx, edit each manually and change `/geography/sections` → `/geography/sectors`.

**Step 4:** Client tsc error count

Run: `cd client && npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: less than or equal to `BASELINE_CLIENT_TS_ERRORS` from Task 0.3. If higher, inspect which new errors appeared and revert the overreach.

**No commit yet.**

---

### Task 1.6: Full verification — tsc + tests + build + duplicate-routes + boot

**Files:** Read-only

**Step 1:** Server tsc — `cd server && npx tsc --noEmit` → expect 0 errors.

**Step 2:** Server tests — `cd server && npx vitest run` → expect `BASELINE_SERVER_TESTS` (343) passing.

**Step 3:** Client tsc — `cd client && npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect ≤ baseline.

**Step 4:** Client build — `cd client && npx vite build` → expect success.

**Step 5:** Duplicate-routes — `cd server && npm run check:routes` → expect clean.

**Step 6:** Boot smoke test

```bash
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/boot1b.log 2>&1 &
BOOT_PID=$!
sleep 5
kill $BOOT_PID 2>/dev/null
sleep 1
kill -9 $BOOT_PID 2>/dev/null
grep -iE "WebSocket server initialized" /tmp/boot1b.log
grep -iE "error|uncaught" /tmp/boot1b.log || echo "no errors"
```

Expected: WebSocket initialized, no errors.

**If any gate fails:** STOP. Fix the failure before proceeding.

**No commit yet.**

---

### Task 1.7: Commit and push Phase 1

**Files:** all of Phase 1

**Step 1:** Review the full diff

Run: `cd "/Users/rmpgutah/RMPG Flex" && git diff --stat`

Expected: ~15 files changed, modest +/- per file, total under 200 line changes.

**Step 2:** Stage the specific files from Tasks 1.1 through 1.5 (not `git add -A` — be explicit so stray artifacts do not land in the commit)

**Step 3:** Commit

```
refactor(geography): rename dispatch_sections → dispatch_sectors (mechanical)
```

Include in the commit body: the full rename mapping, the list of files touched, the migration SQL (ALTER TABLE RENAME TO + ALTER TABLE RENAME COLUMN), and the verification checklist you just ran.

**Step 4:** Push

```bash
git pull --rebase origin main && git push origin main
```

**Phase 1 complete.**

---

# Phase 2 — Schema + seed + API (commit 2)

**Goal of phase:** Wire the GeoJSON files into the database. Create the seed module. Replace `districts.ts` with a new `geography.ts` that has full CRUD on all 4 tiers plus `/tree`, `/stats`, `/identify`. Add integration tests. Delete the obsolete `/geography/sections` endpoints.

---

### Task 2.1: Write the first failing test

**Files:**
- Create: `server/tests/integration/geography.test.ts`

**Step 1:** Check existing integration test pattern

Run: `ls server/tests/integration/ 2>&1 | head -10`

Look at `server/tests/helpers/testApp.ts` to see the test setup API.

**Step 2:** Write the test file with a single initial test

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, cleanupTestApp, getAuthToken } from '../helpers/testApp';

describe('Geography API — areas', () => {
  let app: any;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    adminToken = await getAuthToken(app, 'admin');
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  test('GET /areas returns 6 Utah AOG areas', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/areas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(6);
    const codes = res.body.map((a: any) => a.area_code).sort();
    expect(codes).toEqual([
      'BEAR_RIVER',
      'FIVE_COUNTY',
      'SIX_COUNTY',
      'SOUTHEASTERN',
      'UINTAH_BASIN',
      'WASATCH_FRONT',
    ]);
  });
});
```

Note: adapt `buildTestApp`, `cleanupTestApp`, `getAuthToken` to whatever names actually exist in `server/tests/helpers/testApp.ts`.

**Step 3:** Run the test — expect FAIL

Run: `cd server && npx vitest run tests/integration/geography.test.ts`

Expected: test fails because either the endpoint returns 0 rows or returns 404 (the seed has not been built yet). Either failure is fine — we want to confirm the test infrastructure runs and fails.

**No commit yet.**

---

### Task 2.2: Create the AOG data file

**Files:**
- Create: `server/src/seeds/data/utahAogRegions.ts`

**Step 1:** Write the file

```typescript
// Utah Associations of Government (AOG) region definitions.
// Wasatch Front combines WFRC (Weber/Davis/Morgan/SL/Tooele) + MAG
// (Utah/Wasatch/Summit) into a single region per the design decision.

export const UTAH_AOG_REGIONS = {
  BEAR_RIVER: {
    name: 'Bear River',
    counties: ['BOX ELDER', 'CACHE', 'RICH'],
    color: '#d4a017',
    sort_order: 1,
  },
  WASATCH_FRONT: {
    name: 'Wasatch Front',
    counties: [
      'WEBER', 'MORGAN', 'DAVIS', 'SALT LAKE',
      'TOOELE', 'SUMMIT', 'UTAH', 'WASATCH',
    ],
    color: '#a0a0a0',
    sort_order: 2,
  },
  SIX_COUNTY: {
    name: 'Six County',
    counties: ['JUAB', 'MILLARD', 'PIUTE', 'SANPETE', 'SEVIER', 'WAYNE'],
    color: '#888888',
    sort_order: 3,
  },
  UINTAH_BASIN: {
    name: 'Uintah Basin',
    counties: ['DAGGETT', 'DUCHESNE', 'UINTAH'],
    color: '#707070',
    sort_order: 4,
  },
  SOUTHEASTERN: {
    name: 'Southeastern',
    counties: ['CARBON', 'EMERY', 'GRAND', 'SAN JUAN'],
    color: '#5a5a5a',
    sort_order: 5,
  },
  FIVE_COUNTY: {
    name: 'Five County',
    counties: ['BEAVER', 'GARFIELD', 'IRON', 'KANE', 'WASHINGTON'],
    color: '#c8c8c8',
    sort_order: 6,
  },
} as const;

export type AogRegionKey = keyof typeof UTAH_AOG_REGIONS;

// Reverse lookup: county NAME → AOG region key
export const COUNTY_TO_AOG: Record<string, AogRegionKey> = {};
for (const [key, region] of Object.entries(UTAH_AOG_REGIONS) as [
  AogRegionKey,
  (typeof UTAH_AOG_REGIONS)[AogRegionKey],
][]) {
  for (const county of region.counties) {
    COUNTY_TO_AOG[county.toUpperCase()] = key;
  }
}

// Sector code disambiguation for county names that would collide on
// 3-letter prefix, or need to match existing beat.geojson city_codes.
export const SECTOR_CODE_OVERRIDES: Record<string, string> = {
  'SAN JUAN': 'SJN',
  'SANPETE':  'SNP',
  'BOX ELDER':'BXE',
  'SALT LAKE':'SLC',
  'UINTAH':   'UNT',
  'UTAH':     'UTC',
};
```

**Step 2:** TypeScript check — run `cd server && npx tsc --noEmit`, expect 0 errors.

**No commit yet.**

---

### Task 2.3: Write the seed module

**Files:**
- Create: `server/src/seeds/geographySeed.ts`

**Step 1:** Write the full module. Reference the design doc [Section 2](2026-04-10-geography-areas-sectors-zones-beats-design.md#section-2--seed-from-real-geojson) for the complete specification. Key requirements:

- Exports `seedGeographyFromGeoJSON(db, geojsonDir)`
- Idempotent: checks all 4 tables are empty before doing any work
- Reads `county.geojson`, `municipality.geojson`, `beat.geojson` from the given directory
- Wraps all inserts in a single `db.transaction(() => { ... })()` for atomicity
- Inserts in order: areas (6) → sectors (29) → zones (municipalities then synthetic unincorporated) → beats (719)
- All INSERT statements use `db.prepare(...).run()` — DO NOT use `db.exec()` (prevents the security-hook false positive)
- Uses the `SECTOR_CODE_OVERRIDES` and `COUNTY_TO_AOG` from Task 2.2
- Logs the final counts like `[geography-seed] Seeded: { areas: 6, sectors: 29, zones: 287, beats: 719 }`
- Counts and logs orphan beats (zone lookup miss)

Signature:

```typescript
export function seedGeographyFromGeoJSON(
  db: Database.Database,
  geojsonDir: string,
): { areas: number; sectors: number; zones: number; beats: number } | null;
```

Returns `null` if the guard skipped the seed. Returns the row counts on success.

**Step 2:** TS check — expect 0 errors.

**No commit yet.**

---

### Task 2.4: Add missing columns to the normalized tables

**Files:**
- Modify: `server/src/models/database.ts`

**Step 1:** Update `dispatch_sectors` table definition

Find the `CREATE TABLE IF NOT EXISTS dispatch_sectors` block (renamed in Phase 1). Add two columns:

```diff
   CREATE TABLE IF NOT EXISTS dispatch_sectors (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     sector_code TEXT NOT NULL UNIQUE,
     sector_name TEXT NOT NULL,
     area_id INTEGER REFERENCES dispatch_areas(id) ON DELETE SET NULL,
+    county_nbr TEXT,
+    fips_code TEXT,
     ...
   )
```

Then add `addCol()` migrations right after the create (follows the existing pattern — check `grep -n "addCol" server/src/models/database.ts | head -3` to see how `addCol` is used elsewhere):

```typescript
try { addCol(db, 'dispatch_sectors', 'county_nbr', 'TEXT'); } catch {}
try { addCol(db, 'dispatch_sectors', 'fips_code', 'TEXT'); } catch {}
```

**Step 2:** Update `dispatch_zones` table definition

Add `zone_type` and `ugrc_code` columns the same way:

```diff
   CREATE TABLE IF NOT EXISTS dispatch_zones (
     ...
     sector_id INTEGER REFERENCES dispatch_sectors(id) ON DELETE SET NULL,
+    zone_type TEXT DEFAULT 'municipality',
+    ugrc_code TEXT,
     ...
   )
```

```typescript
try { addCol(db, 'dispatch_zones', 'zone_type', "TEXT DEFAULT 'municipality'"); } catch {}
try { addCol(db, 'dispatch_zones', 'ugrc_code', 'TEXT'); } catch {}
```

Defensive: ensure `dispatch_zones.sector_id` exists (may have been `section_id` before Phase 1). Add:

```typescript
try {
  const cols = db.prepare('PRAGMA table_info(dispatch_zones)').all() as any[];
  if (cols.some(c => c.name === 'section_id') && !cols.some(c => c.name === 'sector_id')) {
    db.prepare('ALTER TABLE dispatch_zones RENAME COLUMN section_id TO sector_id').run();
  }
} catch {}
```

**Step 3:** Update `dispatch_beats` table definition

Add `district_letter` and `beat_number`:

```diff
   CREATE TABLE IF NOT EXISTS dispatch_beats (
     ...
     zone_id INTEGER REFERENCES dispatch_zones(id) ON DELETE SET NULL,
+    district_letter TEXT,
+    beat_number INTEGER,
     dispatch_code TEXT,
     ...
   )
```

```typescript
try { addCol(db, 'dispatch_beats', 'district_letter', 'TEXT'); } catch {}
try { addCol(db, 'dispatch_beats', 'beat_number', 'INTEGER'); } catch {}
```

**Step 4:** Drop `dispatch_districts`

Add near the top of the migration block:

```typescript
try {
  db.prepare('DROP TABLE IF EXISTS dispatch_districts').run();
  console.log('[migrate] Dropped obsolete dispatch_districts table');
} catch (e: any) {
  console.log('[migrate] dispatch_districts drop skipped:', e.message);
}
```

**Step 5:** Server tsc — expect 0 errors.

**No commit yet.**

---

### Task 2.5: Wire the seed into database.ts

**Files:**
- Modify: `server/src/models/database.ts`

**Step 1:** Find the existing old seed block

Run: `grep -n "Seed normalized geography" server/src/models/database.ts`

Delete the entire old seed block that inserted rows from `dispatch_districts`.

**Step 2:** Replace with a call to the new seed module

```typescript
// ── Seed dispatch_areas / sectors / zones / beats from GeoJSON ──
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { seedGeographyFromGeoJSON } = require('../seeds/geographySeed');
  const geojsonDir = path.resolve(__dirname, '../../../client/public/geojson');
  seedGeographyFromGeoJSON(db, geojsonDir);
} catch (err: any) {
  console.log('[migrate] Geography seed skipped:', err.message);
}
```

Use `require()` (not `await import()`) unless the surrounding function is already async. Check first with `grep -nE "async function" server/src/models/database.ts`.

**Step 3:** Remove any import or reference to the old `DISPATCH_DISTRICTS` constant

```bash
grep -n "DISPATCH_DISTRICTS" server/src/models/database.ts
```

Delete any import line or code block that references it.

**Step 4:** Server tsc — expect 0 errors.

**No commit yet.**

---

### Task 2.6: Delete the old DISPATCH_DISTRICTS constant file

**Files:**
- Delete: the file where `DISPATCH_DISTRICTS` is defined

**Step 1:** Find the file

```bash
grep -rl "export const DISPATCH_DISTRICTS" server/src/
```

**Step 2:** Remove with `git rm <path>`

**Step 3:** Verify no references remain — `grep -rn "DISPATCH_DISTRICTS" server/src/` should return nothing.

**Step 4:** Server tsc — expect 0 errors.

**No commit yet.**

---

### Task 2.7: Fresh DB seed verification

**Files:** Read-only

**Step 1:** Delete local DB

```bash
rm server/data/rmpg-flex.db server/data/rmpg-flex.db-shm server/data/rmpg-flex.db-wal 2>/dev/null
```

**Step 2:** Boot and watch seed logs

```bash
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/seed.log 2>&1 &
BOOT_PID=$!
sleep 8
kill $BOOT_PID 2>/dev/null
sleep 1
kill -9 $BOOT_PID 2>/dev/null
grep -iE "geography-seed|Seeded" /tmp/seed.log
```

Expected: a log line like `[geography-seed] Seeded: { areas: 6, sectors: 29, zones: 287, beats: 719 }` (zones may be slightly different).

**Step 3:** Query the DB

```bash
sqlite3 server/data/rmpg-flex.db "SELECT COUNT(*) FROM dispatch_areas;"
sqlite3 server/data/rmpg-flex.db "SELECT COUNT(*) FROM dispatch_sectors;"
sqlite3 server/data/rmpg-flex.db "SELECT COUNT(*) FROM dispatch_zones;"
sqlite3 server/data/rmpg-flex.db "SELECT COUNT(*) FROM dispatch_beats;"
```

Expected: 6, 29, ~287, 719.

**Step 4:** Spot-check SLC

```bash
sqlite3 server/data/rmpg-flex.db "SELECT sector_code, sector_name, area_id FROM dispatch_sectors WHERE sector_code = 'SLC';"
```

Expected: One row: `SLC|Salt Lake County|<area id of WASATCH_FRONT>`.

**If counts are wrong or seed fails:** STOP. Debug the seed module.

**No commit yet.**

---

### Task 2.8: Rename districts.ts → geography.ts and rewrite endpoints

**Files:**
- Rename: `server/src/routes/dispatch/districts.ts` → `server/src/routes/dispatch/geography.ts`
- Modify: `server/src/routes/dispatch/index.ts`

**Step 1:** git mv

```bash
cd "/Users/rmpgutah/RMPG Flex"
git mv server/src/routes/dispatch/districts.ts server/src/routes/dispatch/geography.ts
```

**Step 2:** Delete the old `/geography/sections*` endpoint set

Open `server/src/routes/dispatch/geography.ts`. Find the four handlers `router.get('/geography/sections'`, `router.post('/geography/sections'`, `router.put('/geography/sections/:id'`, `router.delete('/geography/sections/:id'`. Delete all four complete handler functions — not just the paths, the entire function bodies.

**Step 3:** Update the existing `/geography/sectors*` endpoints to include the new fields

For the GET sectors handler, include `county_nbr`, `fips_code`, the joined `area_name`, and the `zone_count` rollup. Reference implementation:

```typescript
router.get(
  '/geography/sectors',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { area_id } = req.query;
      let query = `
        SELECT s.*,
          a.area_name,
          (SELECT COUNT(*) FROM dispatch_zones WHERE sector_id = s.id) as zone_count
        FROM dispatch_sectors s
        LEFT JOIN dispatch_areas a ON a.id = s.area_id
      `;
      const params: any[] = [];
      if (area_id) {
        query += ' WHERE s.area_id = ?';
        params.push(Number(area_id));
      }
      query += ' ORDER BY s.sort_order, s.sector_name';
      const rows = db.prepare(query).all(...params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: 'SECTORS_FETCH_FAILED' });
    }
  },
);
```

Apply the same pattern to POST, PUT, DELETE. For DELETE, before deleting the sector row, set child zones' `sector_id = NULL` via a second `db.prepare(...).run()`.

**Step 4:** Extend `/geography/zones` and `/geography/beats` GET handlers

Add query filter support:

```typescript
// GET /geography/beats
router.get(
  '/geography/beats',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { zone_id, sector_id, area_id, active } = req.query;
      let query = `
        SELECT b.*,
          z.zone_name,
          z.sector_id,
          s.sector_name,
          s.area_id,
          a.area_name
        FROM dispatch_beats b
        LEFT JOIN dispatch_zones z ON z.id = b.zone_id
        LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
        LEFT JOIN dispatch_areas a ON a.id = s.area_id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (zone_id) { query += ' AND b.zone_id = ?'; params.push(Number(zone_id)); }
      if (sector_id) { query += ' AND z.sector_id = ?'; params.push(Number(sector_id)); }
      if (area_id) { query += ' AND s.area_id = ?'; params.push(Number(area_id)); }
      if (active !== undefined) {
        query += ' AND b.active = ?';
        params.push(active === '1' || active === 'true' ? 1 : 0);
      }
      query += ' ORDER BY b.sort_order, b.beat_name';
      const rows = db.prepare(query).all(...params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: 'BEATS_FETCH_FAILED' });
    }
  },
);
```

Same pattern for zones (accept `?sector_id`, `?area_id`).

**Step 5:** Replace `/geography/tree` with a proper 4-level nester

```typescript
router.get(
  '/geography/tree',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const areas = db.prepare('SELECT * FROM dispatch_areas ORDER BY sort_order, area_name').all() as any[];
      const sectors = db.prepare('SELECT * FROM dispatch_sectors ORDER BY sort_order, sector_name').all() as any[];
      const zones = db.prepare('SELECT * FROM dispatch_zones ORDER BY sort_order, zone_name').all() as any[];
      const beats = db.prepare('SELECT * FROM dispatch_beats ORDER BY sort_order, beat_name').all() as any[];

      const beatsByZone = new Map<number, any[]>();
      for (const b of beats) {
        if (b.zone_id == null) continue;
        if (!beatsByZone.has(b.zone_id)) beatsByZone.set(b.zone_id, []);
        beatsByZone.get(b.zone_id)!.push(b);
      }
      const zonesBySector = new Map<number, any[]>();
      for (const z of zones) {
        (z as any).beats = beatsByZone.get(z.id) || [];
        if (z.sector_id == null) continue;
        if (!zonesBySector.has(z.sector_id)) zonesBySector.set(z.sector_id, []);
        zonesBySector.get(z.sector_id)!.push(z);
      }
      const sectorsByArea = new Map<number, any[]>();
      for (const s of sectors) {
        (s as any).zones = zonesBySector.get(s.id) || [];
        if (s.area_id == null) continue;
        if (!sectorsByArea.has(s.area_id)) sectorsByArea.set(s.area_id, []);
        sectorsByArea.get(s.area_id)!.push(s);
      }
      for (const a of areas) {
        (a as any).sectors = sectorsByArea.get(a.id) || [];
      }

      res.json({ areas });
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: 'TREE_FETCH_FAILED' });
    }
  },
);
```

**Step 6:** Add `/geography/stats`

```typescript
router.get(
  '/geography/stats',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const c = (sql: string) => (db.prepare(sql).get() as any).n;
      res.json({
        area_count: c('SELECT COUNT(*) as n FROM dispatch_areas'),
        sector_count: c('SELECT COUNT(*) as n FROM dispatch_sectors'),
        zone_count: c('SELECT COUNT(*) as n FROM dispatch_zones'),
        beat_count: c('SELECT COUNT(*) as n FROM dispatch_beats'),
        active_beat_count: c('SELECT COUNT(*) as n FROM dispatch_beats WHERE active = 1'),
        orphan_beat_count: c('SELECT COUNT(*) as n FROM dispatch_beats WHERE zone_id IS NULL'),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

**Step 7:** Stub `/geography/identify`

The old handler did point-in-polygon against `dispatch_districts`. Replace with a stub that returns a 200 but a `note` field explaining the polygon lookup is a follow-up task. This prevents breaking existing callers while making it clear the feature is incomplete:

```typescript
router.get(
  '/geography/identify',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (req: Request, res: Response) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    res.json({
      area: null,
      sector: null,
      zone: null,
      beat: null,
      note: 'identify-by-lat-lng polygon lookup not yet implemented against new schema',
    });
  },
);
```

Test 6 in Task 2.10 must tolerate this stub response (accept a 200 with the `note` field OR a real identified chain).

**Step 8:** Update the import in `server/src/routes/dispatch/index.ts`

```diff
- import districtsRouter from './districts';
+ import geographyRouter from './geography';

- router.use('/', districtsRouter);
+ router.use('/', geographyRouter);
```

**Step 9:** Server tsc — expect 0 errors.

**No commit yet.**

---

### Task 2.9: Curl smoke test the endpoints

**Files:** Read-only

**Step 1:** Boot the server fresh

Delete the local DB first, then boot:

```bash
rm server/data/rmpg-flex.db* 2>/dev/null
cd server && PORT=13001 DISABLE_SSL=true JWT_SECRET=smoketest npx tsx src/index.ts > /tmp/phase2.log 2>&1 &
BOOT_PID=$!
sleep 8
```

**Step 2:** Mark admin `totp_exempt` and set a known password

```bash
sqlite3 server/data/rmpg-flex.db "UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE username = 'admin';"

node -e "
const bcrypt = require('./server/node_modules/bcryptjs');
const db = require('./server/node_modules/better-sqlite3')('server/data/rmpg-flex.db');
const hash = bcrypt.hashSync('GeoTest2026!', 10);
db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'admin');
db.close();
"
```

**Step 3:** Get a token

```bash
TOKEN=$(curl -sS -X POST http://localhost:13001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"GeoTest2026!"}' | jq -r '.token')
```

**Step 4:** Hit each endpoint and verify counts

```bash
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/areas | jq 'length'
# Expected: 6

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/sectors | jq 'length'
# Expected: 29

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/zones | jq 'length'
# Expected: ~287

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/beats | jq 'length'
# Expected: 719

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/tree | jq '.areas | length'
# Expected: 6

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/stats | jq
# Expected: object with 6 count fields

curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" http://localhost:13001/api/dispatch/geography/sections
# Expected: 404
```

**Step 5:** Kill the test server

```bash
kill $BOOT_PID 2>/dev/null; sleep 1; kill -9 $BOOT_PID 2>/dev/null
```

**If any endpoint returns unexpected data:** STOP and debug.

**No commit yet.**

---

### Task 2.10: Complete the test file

**Files:**
- Modify: `server/tests/integration/geography.test.ts`

**Step 1:** Add the remaining 9 tests to the test file

Use the design doc [Section 3](2026-04-10-geography-areas-sectors-zones-beats-design.md#section-3--api-routes) test list as the specification. Each test follows the pattern from Task 2.1. The full list:

1. `/areas` returns 6 rows with correct codes *(already written in 2.1)*
2. `/sectors` returns 29 rows
3. `/sectors?area_id=<bear_river_id>` returns 3 rows (Box Elder, Cache, Rich)
4. `/zones` returns `>250 && <320` rows
5. `/beats` returns 719 rows
6. `/tree` nesting: WASATCH_FRONT area → SLC sector → has zones → zones have beats
7. `/identify?lat=40.7608&lng=-111.8910` returns 200 with either the chain or the stub `note` field
8. Anonymous GET `/areas` returns 401
9. Officer POST `/sectors` returns 403 (if `getAuthToken(app, 'officer')` works; otherwise mark the test `test.todo(...)` and file a follow-up)
10. POST `/zones` without `sector_id` returns 400
11. Regression guard: GET `/sections` returns 404

**Step 2:** Run the test file

Run: `cd server && npx vitest run tests/integration/geography.test.ts`

Expected: 10–11 tests pass (depending on the officer-token situation).

**Step 3:** Run the full test suite

Run: `cd server && npx vitest run`

Expected: baseline + 10 or 11 tests pass (so ~353–354).

**No commit yet.**

---

### Task 2.11: Client stub for GeographyPage

**Files:**
- Modify (full replacement): `client/src/pages/GeographyPage.tsx`

**Step 1:** Replace with a minimal stats-only stub so the page does not crash between Phase 2 and Phase 3

```typescript
import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { MapPin } from 'lucide-react';

export default function GeographyPage() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    apiFetch<any>('/dispatch/geography/stats')
      .then(setStats)
      .catch(console.error);
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
      <div className="panel-raised p-6 text-center">
        <p className="text-[var(--text-muted)] text-sm">
          Geography admin — 4-column Miller layout arriving in next commit.
        </p>
        {stats && (
          <div className="mt-4 grid grid-cols-4 gap-4 text-center">
            {[
              ['area_count', 'AREAS'],
              ['sector_count', 'SECTORS'],
              ['zone_count', 'ZONES'],
              ['beat_count', 'BEATS'],
            ].map(([key, label]) => (
              <div key={label}>
                <div className="text-2xl font-bold text-[#d4a017]">{stats[key]}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2:** Client tsc — expect ≤ baseline.

**Step 3:** Vite build — expect success.

**No commit yet.**

---

### Task 2.12: Commit and push Phase 2

**Files:** all of Phase 2

**Step 1:** Review diff

```bash
cd "/Users/rmpgutah/RMPG Flex"
git status --short
git diff --stat | tail -20
```

Expected files:
- Modified: `server/src/models/database.ts`
- Modified: `server/src/routes/dispatch/index.ts`
- Renamed: `server/src/routes/dispatch/districts.ts` → `geography.ts` (extensively modified)
- New: `server/src/seeds/geographySeed.ts`
- New: `server/src/seeds/data/utahAogRegions.ts`
- New: `server/tests/integration/geography.test.ts`
- Deleted: the old DISPATCH_DISTRICTS data file
- Modified: `client/src/pages/GeographyPage.tsx` (stub)

**Step 2:** Final verification

```bash
cd server && npm run check:routes && npx tsc --noEmit && npx vitest run
cd ../client && npx tsc --noEmit 2>&1 | grep -c "error TS" && npx vite build
```

Expected: everything green.

**Step 3:** Commit

```
feat(geography): seed from Utah GeoJSON + rewrite API (4-tier Areas→Beats)
```

Commit body: full description of schema changes, seed module, API changes, deleted endpoints, new tests, verification output.

**Step 4:** Push

```bash
git pull --rebase origin main && git push origin main
```

**Phase 2 complete.**

---

# Phase 3 — UI rewrite (commit 3)

**Goal of phase:** Replace the minimal stub from Phase 2 with a full Spillman 4-column Miller drilldown.

---

### Task 3.1: Create the TypeScript types

**Files:**
- Create: `client/src/types/geography.ts`

**Step 1:** Write the file with `Area`, `Sector`, `Zone`, `Beat`, `GeographyTree`, `GeographyStats`, `TierId` interfaces. Match the server response shapes from Phase 2's geography.ts — each interface mirrors the SQL columns + JOINed parent names + child rollup counts.

**Step 2:** TS check — expect 0 new errors.

**No commit yet.**

---

### Task 3.2: Create the useGeographyTree hook

**Files:**
- Create: `client/src/hooks/useGeographyTree.ts`

**Step 1:** Write the hook

```typescript
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { GeographyTree } from '../types/geography';

const CACHE_DURATION_MS = 60_000;
let cachedTree: GeographyTree | null = null;
let cachedAt = 0;

export function useGeographyTree() {
  const [tree, setTree] = useState<GeographyTree | null>(cachedTree);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cachedTree && (now - cachedAt) < CACHE_DURATION_MS) {
      setTree(cachedTree);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<GeographyTree>('/dispatch/geography/tree');
      cachedTree = data;
      cachedAt = now;
      setTree(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load geography tree');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  return { tree, loading, error, refetch: () => fetchTree(true) };
}
```

**Step 2:** TS check — expect 0 errors.

**No commit yet.**

---

### Task 3.3: Build the GeographyPage skeleton with 4 columns

**Files:**
- Modify (full rewrite): `client/src/pages/GeographyPage.tsx`

**Step 1:** Write the skeleton with 4 columns + detail pane + stats bar. Reference the design doc [Section 4](2026-04-10-geography-areas-sectors-zones-beats-design.md#section-4--ui-geographypage-rebuild) for the full component tree:

```
GeographyPage
├── GeographyHeader (title + search)
├── GeographyColumns (TierColumn x4)
├── DetailPane
└── StatsBar
```

All components colocated in a single file.

Key requirements:
- `TierColumn` is a generic function component parametrized by item shape
- Columns have fixed widths (180, 180, 240, 240) and a flex-1 detail pane
- Selection cascade: selecting Area clears Sector/Zone/Beat; selecting Sector clears Zone/Beat; etc.
- Uses `useGeographyTree()` for data
- Loading state shows a placeholder
- Error state shows the error + a retry button
- Pure-black theme: `var(--surface-raised)`, `#222` dividers, `#d4a017` selection border, 2px radii, `.input-dark` / `.select-dark` form classes
- **Zero blue hex** — grep the final file with `grep -E "#(3b82f6|60a5fa|2563eb|38bdf8|22d3ee)"`

**Step 2:** TS check — expect 0 new errors.

**Step 3:** Vite build — expect success.

**No commit yet.**

---

### Task 3.4: Wire click-select cascade

**Files:**
- Modify: `client/src/pages/GeographyPage.tsx`

**Step 1:** Implement `selectArea`, `selectSector`, `selectZone`, `selectBeat` callbacks that update state and clear lower tiers. Wire each `TierColumn`'s `onSelect` prop.

**Step 2:** Derive `currentAreas`, `currentSectors`, `currentZones`, `currentBeats` from the tree + selection state via `useMemo`.

**Step 3:** Vite build — expect success.

**No commit yet.**

---

### Task 3.5: Add search filter

**Files:**
- Modify: `client/src/pages/GeographyPage.tsx`

**Step 1:** Add a search input to the header:

```tsx
<input
  type="text"
  value={state.searchQuery}
  onChange={(e) => setState((s) => ({ ...s, searchQuery: e.target.value }))}
  placeholder="Search all tiers..."
  className="input-dark text-xs flex-1 max-w-xs"
/>
```

**Step 2:** Filter the `currentSectors`, `currentZones`, `currentBeats` memos by search query (case-insensitive substring match on name + code).

**Step 3:** Vite build — expect success.

**No commit yet.**

---

### Task 3.6: Add Detail pane with edit/delete buttons

**Files:**
- Modify: `client/src/pages/GeographyPage.tsx`

**Step 1:** In the `DetailPane` component, resolve the most-specific selected item (Beat > Zone > Sector > Area). Render a field table with all metadata except navigation children (`sectors`, `zones`, `beats`) and timestamps.

**Step 2:** Add Edit and Delete buttons. For the first pass:
- Edit opens a `window.prompt()` with the current name pre-filled, then PUTs the new name
- Delete confirms via `window.confirm()`, then DELETEs
- Both call `onRefetch()` after success

(Form modal improvements are deferred — see the follow-up list.)

**Step 3:** Wire `[+ Add]` buttons in TierColumn to `window.prompt()` for a new name, then POST with the appropriate parent ID.

**Step 4:** Vite build — expect success.

**No commit yet.**

---

### Task 3.7: Interactive verification in preview server

**Files:** Read-only

**Step 1:** Start both preview servers via the preview tools

**Step 2:** Log in as admin (use the password set in Task 2.9 or reset it again) and navigate to `/geography`

**Step 3:** Click through the cascade:
- Click `Wasatch Front` → sectors column populates with 8 counties
- Click `Salt Lake County` → zones column populates
- Click `Salt Lake City` zone → beats column populates
- Click a beat → detail pane shows its metadata

**Step 4:** Type `Salt` in the search box → verify all 4 columns filter.

**Step 5:** Click `[+ Add]` on Areas → prompt appears → enter `TEST AREA` → row added → refetch shows it.

**Step 6:** Click the new TEST AREA row → click Delete → confirm → row removed.

**Step 7:** Take a screenshot via `preview_screenshot`.

**Step 8:** Check preview console logs for errors via `preview_console_logs` level='error'. Expected: no red errors.

**If any interaction fails:** STOP and debug.

**No commit yet.**

---

### Task 3.8: Blue hex sanity check

**Files:** Read-only

Run: `grep -cE "#(3b82f6|60a5fa|2563eb|1e40af|1d4ed8|06b6d4|38bdf8|0ea5e9)" client/src/pages/GeographyPage.tsx`

Expected: `0`.

If any hits, replace per blue-killswitch conventions from earlier in the session.

**No commit yet.**

---

### Task 3.9: Full final verification

**Files:** Read-only

1. Server tests — `cd server && npx vitest run` → expect 353+ passing
2. Client tsc — `cd client && npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect ≤ baseline
3. Vite build — `cd client && npx vite build` → expect success
4. check:routes — `cd server && npm run check:routes` → expect clean

---

### Task 3.10: Commit and push Phase 3

**Files:** all of Phase 3

```
feat(geography): rebuild GeographyPage with 4-column Miller drilldown
```

Commit body: full description of the layout, interactions, search, detail pane, theme compliance, verification output, known deferred follow-ups (form modals, keyboard nav, polygon identify, mobile fallback).

Push to main.

**Phase 3 complete.**

---

# Phase 4 — Deploy + smoke test + rollback docs

**Goal of phase:** Ship to production and verify live.

---

### Task 4.1: Deploy

**Files:** Read-only

**Step 1:** Local preflight

```bash
cd "/Users/rmpgutah/RMPG Flex"
cd server && npx vitest run
cd ../client && npx vite build
cd ..
```

Expected: green.

**Step 2:** Deploy

Run: `bash deploy/deploy.sh`

Watch for:
- Client typecheck passed
- Server tests passed (353+)
- Client build succeeded
- rsync succeeded
- `systemctl restart rmpg-flex: OK`
- `curl /api/health` returns 200

---

### Task 4.2: Post-deploy smoke test

**Files:** Read-only

**Step 1:** Health check

Run: `curl -sf https://rmpgutah.us/api/health | jq .version`

Expected: `"5.7.0"`.

**Step 2:** Log in as production admin via browser (NOT the local GeoTest password — the real production admin credentials)

**Step 3:** Hit stats with a real token

```bash
TOKEN="<production admin token from browser devtools>"
curl -sS -H "Authorization: Bearer $TOKEN" https://rmpgutah.us/api/dispatch/geography/stats | jq
```

Expected: `{area_count: 6, sector_count: 29, zone_count: ~287, beat_count: 719, ...}`

**Step 4:** Tree shape

```bash
curl -sS -H "Authorization: Bearer $TOKEN" https://rmpgutah.us/api/dispatch/geography/tree \
  | jq '{areas: (.areas | length), wasatch_sectors: ([.areas[] | select(.area_code == "WASATCH_FRONT") | .sectors | length] | add)}'
```

Expected: `{"areas": 6, "wasatch_sectors": 8}`

**Step 5:** Navigate to `https://rmpgutah.us/geography` and verify:
- 4 columns render
- Click-through cascade works end-to-end
- Search filters
- Create + delete work

**Step 6:** Production logs

```bash
ssh root@194.113.64.90 "journalctl -u rmpg-flex --no-pager -n 30 | grep -iE 'error|geography' | tail -10"
```

Expected: no errors. `[geography-seed] Skipping` is normal if production DB already has rows from a previous deploy of this plan.

---

### Task 4.3: Document the deploy + rollback

**Files:**
- Modify: `docs/plans/2026-04-10-geography-areas-sectors-zones-beats.md` (this file)

**Step 1:** Append a "Deployed to Production" section at the bottom of this file with:
- Deploy timestamp
- Commit range (Phase 0 first SHA through Phase 3 last SHA)
- Row counts observed in production
- Any issues encountered

**Step 2:** Rollback procedure documented:

```
1. Restore DB:
   ssh root@194.113.64.90 "cp /opt/rmpg-flex/server/data/rmpg-flex.db.bak /opt/rmpg-flex/server/data/rmpg-flex.db && systemctl restart rmpg-flex"
2. Revert code:
   git revert <phase-3-sha>..<phase-0-sha> on main
3. Redeploy:
   bash deploy/deploy.sh
4. Verify:
   curl -sf https://rmpgutah.us/api/health
```

**Step 3:** Commit + push the post-deploy notes

```
docs(plans): record geography rebuild deploy outcome
```

**Plan complete.**

---

## Verification summary — what "done" means

| Check | Command |
|---|---|
| Phase 0 Express fix landed | `git log --oneline -5 main` shows the revert commit |
| Phase 1 rename landed | `grep -rE "section_id" server/src client/src --include="*.ts" --include="*.tsx"` returns no code hits |
| Phase 2 schema+seed+API landed | `curl` to production `/api/dispatch/geography/stats` returns `{areas:6, sectors:29, zones:~287, beats:719}` |
| Phase 3 UI landed | Production `/geography` renders 4 columns, cascade works |
| Server tests | `cd server && npx vitest run` → 353+ passed |
| Client build | `cd client && npx vite build` → success |
| Duplicate routes | `cd server && npm run check:routes` → 0 duplicates |
| Blue-killswitch compliance | `grep -rE "#(3b82f6|60a5fa|2563eb|38bdf8|22d3ee)" client/src/pages/GeographyPage.tsx` → 0 hits |
| Production health | `curl -sf https://rmpgutah.us/api/health` → 200 |
| Production logs | `journalctl -u rmpg-flex` clean after 15 min of live traffic |

---

## Deferred follow-ups (explicitly not blocking this plan)

1. `/geography/identify` real polygon lookup against `beat.geojson`
2. Form modals instead of `window.prompt()` for create/edit flows
3. Keyboard navigation bindings (`↑↓→← n e Del Esc /`)
4. Mobile fallback layout at < 1024px viewport
5. Express 5 migration (separate plan)
6. Wasatch Front AOG split if you later want WFRC and MAG as separate areas
7. "RMPG operational jurisdictions" filter toggle
