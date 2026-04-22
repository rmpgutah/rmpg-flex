# Utah Roads Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import the UGRC SGID Utah Roads dataset (statewide, ~1M segments) into `server/data/rmpg-flex.db` as two new tables, plus ship a tested pure-function address-range interpolation helper. No HTTP endpoint in v1.

**Architecture:** Two new SQLite tables (`roads` for attributes, `road_segments_geom` for geometry) created at server boot via the existing `database.ts` lazy-CREATE pattern. A standalone Node script (`server/scripts/import-utah-roads.ts`) populates them in two streaming passes (CSV → roads, GeoJSON → geometry) inside a single transaction. The script is run manually on the VPS; nothing in the request path queries the new tables in v1.

**Tech Stack:** TypeScript + tsx, better-sqlite3, `csv-parse` (new), `stream-json` (new), Vitest.

**Design doc:** [docs/plans/2026-04-20-utah-roads-import-design.md](2026-04-20-utah-roads-import-design.md) — read this first.

**Critical project gotchas to re-read before starting:**
- CLAUDE.md Gotcha #9 — migrations via lazy `CREATE TABLE IF NOT EXISTS` + `addCol()` in `server/src/models/database.ts`.
- CLAUDE.md Gotcha #42 — the security hook blocks the literal-exec substring; use `db.prepare(...).run()` for every DDL statement, never the better-sqlite3 bulk-execute shortcut.
- CLAUDE.md Gotcha #43 — parallel worktree deploys can clobber each other; do not deploy from this worktree if another active worktree is also deploying.
- Production-only paths (`server/data/`, `server/.env`, `server/certs/`, `server/uploads/`) must never be touched locally.

---

## Task 1: Add `csv-parse` and `stream-json` dependencies

**Files:**
- Modify: `server/package.json`

**Step 1: Install both deps**

Run from repo root:
```bash
cd server && npm install --save csv-parse stream-json --legacy-peer-deps
```

Expected: both appear under `"dependencies"` in `server/package.json`. `package-lock.json` updated.

**Step 2: Verify versions resolve cleanly**

```bash
cd server && npm ls csv-parse stream-json
```
Expected: both listed at a single version, no `UNMET` or `invalid` markers.

**Step 3: Verify typecheck still passes**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(server): add csv-parse and stream-json for Utah Roads importer"
```

---

## Task 2: Create the `addressRange` pure-function helper (TDD)

**Files:**
- Create: `server/src/utils/addressRange.ts`
- Create: `server/src/utils/__tests__/addressRange.test.ts`

**Step 1: Write the failing tests**

Create `server/src/utils/__tests__/addressRange.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  interpolateAlongRange,
  parityMatches,
  normalizeStreetName,
} from '../addressRange';

describe('interpolateAlongRange', () => {
  it('returns 0.5 for the midpoint of an ascending range', () => {
    expect(interpolateAlongRange(100, 0, 200)).toBeCloseTo(0.5);
  });

  it('returns 0.5 for the midpoint of a descending range', () => {
    expect(interpolateAlongRange(100, 200, 0)).toBeCloseTo(0.5);
  });

  it('clamps house numbers above the range to 1.0', () => {
    expect(interpolateAlongRange(300, 0, 200)).toBe(1);
  });

  it('clamps house numbers below the range to 0.0', () => {
    expect(interpolateAlongRange(-50, 0, 200)).toBe(0);
  });

  it('returns 0 when endpoints are equal (no divide-by-zero)', () => {
    expect(interpolateAlongRange(100, 100, 100)).toBe(0);
  });
});

describe('parityMatches', () => {
  it('odd house matches O parity', () => {
    expect(parityMatches(101, 'O')).toBe(true);
  });
  it('even house does not match O parity', () => {
    expect(parityMatches(100, 'O')).toBe(false);
  });
  it('even house matches E parity', () => {
    expect(parityMatches(100, 'E')).toBe(true);
  });
  it('odd house does not match E parity', () => {
    expect(parityMatches(101, 'E')).toBe(false);
  });
  it('any house matches B parity', () => {
    expect(parityMatches(100, 'B')).toBe(true);
    expect(parityMatches(101, 'B')).toBe(true);
  });
  it('any house matches null parity', () => {
    expect(parityMatches(100, null)).toBe(true);
  });
});

describe('normalizeStreetName', () => {
  it('uppercases input', () => {
    expect(normalizeStreetName('main')).toBe('MAIN');
  });
  it('strips periods', () => {
    expect(normalizeStreetName('S. Main St.')).toBe('S MAIN ST');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeStreetName('south   main   street')).toBe('SOUTH MAIN STREET');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeStreetName('  main  ')).toBe('MAIN');
  });
  it('handles empty input', () => {
    expect(normalizeStreetName('')).toBe('');
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run src/utils/__tests__/addressRange.test.ts
```
Expected: failure with "Cannot find module '../addressRange'".

**Step 3: Implement the helper**

Create `server/src/utils/addressRange.ts`:

```typescript
export function interpolateAlongRange(
  houseNumber: number,
  fromAddr: number,
  toAddr: number,
): number {
  if (fromAddr === toAddr) return 0;
  const lo = Math.min(fromAddr, toAddr);
  const hi = Math.max(fromAddr, toAddr);
  if (houseNumber <= lo) return fromAddr <= toAddr ? 0 : 1;
  if (houseNumber >= hi) return fromAddr <= toAddr ? 1 : 0;
  const fraction = (houseNumber - fromAddr) / (toAddr - fromAddr);
  return fraction;
}

export function parityMatches(
  houseNumber: number,
  parity: string | null,
): boolean {
  if (parity == null || parity === 'B') return true;
  const isOdd = houseNumber % 2 !== 0;
  if (parity === 'O') return isOdd;
  if (parity === 'E') return !isOdd;
  return true;
}

export function normalizeStreetName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/utils/__tests__/addressRange.test.ts
```
Expected: all 16 tests pass.

**Step 5: Run typecheck**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

**Step 6: Commit**

```bash
git add server/src/utils/addressRange.ts server/src/utils/__tests__/addressRange.test.ts
git commit -m "feat(server): add addressRange interpolation helper with tests"
```

---

## Task 3: Add `roads` and `road_segments_geom` schema to `database.ts`

**Files:**
- Modify: `server/src/models/database.ts`

**Step 1: Locate the right insertion point**

Open `server/src/models/database.ts` and find an existing `db.prepare('CREATE TABLE IF NOT EXISTS …').run()` block near the end of the table-creation section (around the dispatch geography or persons tables). Add the new blocks just after one of those, before any `addCol` calls or seed routines.

**Step 2: Add the schema**

Insert these blocks (one `prepare().run()` per statement — per Gotcha #42 do NOT use bulk-execute):

```typescript
db.prepare(`CREATE TABLE IF NOT EXISTS roads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  utah_road_unique_id TEXT UNIQUE NOT NULL,
  unique_id TEXT,
  full_name TEXT,
  street_name TEXT,
  pre_dir TEXT,
  post_type TEXT,
  post_dir TEXT,
  left_from INTEGER,
  left_to INTEGER,
  right_from INTEGER,
  right_to INTEGER,
  parity_left TEXT,
  parity_right TEXT,
  postal_community_left TEXT,
  postal_community_right TEXT,
  zip_left TEXT,
  zip_right TEXT,
  esn_left TEXT,
  esn_right TEXT,
  msag_community_left TEXT,
  msag_community_right TEXT,
  one_way TEXT,
  posted_speed INTEGER,
  dot_functional_class TEXT,
  county_left TEXT,
  county_right TEXT
)`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_street_community
  ON roads(street_name, postal_community_left)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_zip_left
  ON roads(zip_left)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_esn_left
  ON roads(esn_left)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_esn_right
  ON roads(esn_right)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS road_segments_geom (
  utah_road_unique_id TEXT PRIMARY KEY,
  geom_json TEXT NOT NULL,
  FOREIGN KEY (utah_road_unique_id) REFERENCES roads(utah_road_unique_id)
)`).run();
```

**Step 3: Verify typecheck**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Verify the tables get created in a fresh dev DB**

If a local dev DB exists at `server/data/rmpg-flex.db` (it should NOT — that path is production-only — but if there's a dev variant), use a throwaway path:

```bash
cd server && rm -f /tmp/test-roads.db && npx tsx -e "
import Database from 'better-sqlite3';
process.env.DB_PATH = '/tmp/test-roads.db';
import('./src/models/database.js').then(async (m) => {
  await m.initializeDatabase?.();
  const db = new Database('/tmp/test-roads.db');
  console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('roads','road_segments_geom') ORDER BY name\").all());
  db.close();
});
"
```

If the project doesn't expose `DB_PATH` env-overrideable initialization, instead inspect the file by booting the server briefly: `npx tsx src/index.ts &` then `sqlite3 <dev-db-path> ".schema roads"` then kill the server. If neither approach is feasible, skip this step and rely on the route-collision check + typecheck — the schema will be exercised the first time the importer runs.

Expected: both table names listed.

**Step 5: Run the full server test suite (regression check)**

```bash
cd server && npx vitest run
```
Expected: full suite passes (461+ tests).

**Step 6: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(server): add roads and road_segments_geom tables for Utah Roads import"
```

---

## Task 4: Build the import script — skeleton + CLI argument parsing

**Files:**
- Create: `server/scripts/import-utah-roads.ts`

**Step 1: Write the skeleton**

Create `server/scripts/import-utah-roads.ts`:

```typescript
#!/usr/bin/env npx tsx
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

interface Args {
  csv: string;
  geojson: string;
  db: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--csv') { args.csv = value; i++; }
    else if (flag === '--geojson') { args.geojson = value; i++; }
    else if (flag === '--db') { args.db = value; i++; }
  }
  if (!args.csv || !args.geojson) {
    console.error('Usage: import-utah-roads.ts --csv <path> --geojson <path> [--db <path>]');
    process.exit(1);
  }
  return {
    csv: args.csv,
    geojson: args.geojson,
    db: args.db ?? path.resolve(__dirname, '../data/rmpg-flex.db'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, file] of [['csv', args.csv], ['geojson', args.geojson]] as const) {
    if (!fs.existsSync(file)) {
      console.error(`[error] ${label} file not found: ${file}`);
      process.exit(1);
    }
  }
  const db = new Database(args.db);
  console.log(`[import] db=${args.db} csv=${args.csv} geojson=${args.geojson}`);
  // TODO Task 5: pass 1 (CSV)
  // TODO Task 6: pass 2 (GeoJSON)
  db.close();
  console.log('[import] done (skeleton only)');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
```

**Step 2: Smoke-run the skeleton with bogus paths to confirm CLI parsing**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/modest-haslett-ea2ab4" && npx tsx server/scripts/import-utah-roads.ts
```
Expected: usage message, exit code 1.

**Step 3: Smoke-run with a non-existent CSV to confirm existence check**

```bash
npx tsx server/scripts/import-utah-roads.ts --csv /tmp/nope.csv --geojson /tmp/nope.geojson
```
Expected: `[error] csv file not found: /tmp/nope.csv`, exit code 1.

**Step 4: Run typecheck**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors. (If `__dirname` is unavailable under `"type": "module"`, replace with `path.dirname(new URL(import.meta.url).pathname)`.)

**Step 5: Commit**

```bash
git add server/scripts/import-utah-roads.ts
git commit -m "feat(server): scaffold Utah Roads import script (CLI + skeleton)"
```

---

## Task 5: Implement Pass 1 — CSV → `roads`

**Files:**
- Modify: `server/scripts/import-utah-roads.ts`

**Step 1: Add the CSV streaming + insert logic**

Replace the `// TODO Task 5` line with:

```typescript
import { parse } from 'csv-parse';
import { normalizeStreetName } from '../src/utils/addressRange';

function toIntOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function importCsv(db: Database.Database, csvPath: string): Promise<{ inserted: number; skipped: number }> {
  const insert = db.prepare(`INSERT OR IGNORE INTO roads (
    utah_road_unique_id, unique_id, full_name, street_name,
    pre_dir, post_type, post_dir,
    left_from, left_to, right_from, right_to,
    parity_left, parity_right,
    postal_community_left, postal_community_right,
    zip_left, zip_right,
    esn_left, esn_right,
    msag_community_left, msag_community_right,
    one_way, posted_speed, dot_functional_class,
    county_left, county_right
  ) VALUES (
    @utah_road_unique_id, @unique_id, @full_name, @street_name,
    @pre_dir, @post_type, @post_dir,
    @left_from, @left_to, @right_from, @right_to,
    @parity_left, @parity_right,
    @postal_community_left, @postal_community_right,
    @zip_left, @zip_right,
    @esn_left, @esn_right,
    @msag_community_left, @msag_community_right,
    @one_way, @posted_speed, @dot_functional_class,
    @county_left, @county_right
  )`);

  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  const rows: any[] = [];
  const FLUSH_EVERY = 50000;

  const flush = db.transaction((batch: any[]) => {
    for (const row of batch) {
      const result = insert.run(row);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  const parser = fs.createReadStream(csvPath).pipe(parse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }));

  for await (const rec of parser) {
    rows.push({
      utah_road_unique_id: rec.UtahRoadUniqueID ?? rec.UniqueID ?? null,
      unique_id: rec.UniqueID ?? null,
      full_name: rec.FullName ?? null,
      street_name: rec.StreetName ? normalizeStreetName(rec.StreetName) : null,
      pre_dir: rec.StreetNamePreDirectional ?? null,
      post_type: rec.StreetNamePostType ?? null,
      post_dir: rec.StreetNamePostDirectional ?? null,
      left_from: toIntOrNull(rec.LeftFromAddress),
      left_to: toIntOrNull(rec.LeftToAddress),
      right_from: toIntOrNull(rec.RightFromAddress),
      right_to: toIntOrNull(rec.RightToAddress),
      parity_left: rec.ParityLeft ?? null,
      parity_right: rec.ParityRight ?? null,
      postal_community_left: rec.PostalCommunityNameLeft ?? rec.PostalCommunityLeft ?? null,
      postal_community_right: rec.PostalCommunityNameRight ?? rec.PostalCommunityRight ?? null,
      zip_left: rec.PostalZipCodeLeft ?? rec.ZipLeft ?? null,
      zip_right: rec.PostalZipCodeRight ?? rec.ZipRight ?? null,
      esn_left: rec.ESNLeft ?? null,
      esn_right: rec.ESNRight ?? null,
      msag_community_left: rec.MSAGCommunityLeft ?? null,
      msag_community_right: rec.MSAGCommunityRight ?? null,
      one_way: rec.OneWayCode ?? null,
      posted_speed: toIntOrNull(rec.PostedSpeedLimit),
      dot_functional_class: rec['DOTFunctional Class'] ?? rec.DOTFunctionalClass ?? null,
      county_left: rec.CountyLeft ?? null,
      county_right: rec.CountyRight ?? null,
    });
    if (rows.length >= FLUSH_EVERY) {
      flush(rows.splice(0));
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[roads] ${inserted} inserted, ${skipped} skipped, ${elapsed}s elapsed`);
    }
  }
  if (rows.length) flush(rows.splice(0));

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[roads] DONE — ${inserted} inserted, ${skipped} skipped, ${totalElapsed}s total`);
  return { inserted, skipped };
}
```

Then in `main()`, replace the `// TODO Task 5` comment with:
```typescript
const csvStats = await importCsv(db, args.csv);
```

**Step 2: Verify exact CSV column names**

The schema in this plan assumes column names from the header you pasted in the task brief. The brief showed `DOTFunctional Class` (with a space) and truncated `PostalCommunityName*`/`PostalZipCode*`. Before running on the real file, confirm the exact headers:

```bash
head -1 ~/Downloads/UtahRoads_*.csv | tr ',' '\n' | nl
```

If any of `PostalCommunityNameLeft`, `PostalCommunityNameRight`, `PostalZipCodeLeft`, `PostalZipCodeRight`, `CountyLeft`, `CountyRight`, `DOTFunctional Class` differ, update the field-mapping object accordingly. The `??` chains in the code already cover two common variants; add more if needed.

**Step 3: Smoke-test with a tiny synthetic CSV**

```bash
mkdir -p /tmp/utahroads-smoke
cat > /tmp/utahroads-smoke/tiny.csv <<'EOF'
UtahRoadUniqueID,UniqueID,FullName,StreetName,StreetNamePreDirectional,StreetNamePostType,StreetNamePostDirectional,LeftFromAddress,LeftToAddress,RightFromAddress,RightToAddress,ParityLeft,ParityRight,PostalCommunityNameLeft,PostalCommunityNameRight,PostalZipCodeLeft,PostalZipCodeRight,ESNLeft,ESNRight,MSAGCommunityLeft,MSAGCommunityRight,OneWayCode,PostedSpeedLimit,DOTFunctional Class,CountyLeft,CountyRight
URID-1,UID-1,S Main St,Main,S,St,,1,99,2,98,O,E,Salt Lake City,Salt Lake City,84101,84101,101,101,SLC,SLC,,25,Local,Salt Lake,Salt Lake
EOF
rm -f /tmp/test-roads.db
npx tsx server/scripts/import-utah-roads.ts --csv /tmp/utahroads-smoke/tiny.csv --geojson /tmp/utahroads-smoke/tiny.csv --db /tmp/test-roads.db
sqlite3 /tmp/test-roads.db "SELECT count(*), street_name, esn_left FROM roads;"
```
Expected output: `1|MAIN|101`. (GeoJSON pass not yet implemented — script may error after the CSV pass. Confirm CSV insert succeeded before the error.)

**Step 4: Verify idempotency by re-running**

```bash
npx tsx server/scripts/import-utah-roads.ts --csv /tmp/utahroads-smoke/tiny.csv --geojson /tmp/utahroads-smoke/tiny.csv --db /tmp/test-roads.db
sqlite3 /tmp/test-roads.db "SELECT count(*) FROM roads;"
```
Expected: still `1`, log shows `1 skipped` on second run.

**Step 5: Run typecheck**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

**Step 6: Commit**

```bash
git add server/scripts/import-utah-roads.ts
git commit -m "feat(server): implement CSV pass for Utah Roads importer"
```

---

## Task 6: Implement Pass 2 — GeoJSON → `road_segments_geom`

**Files:**
- Modify: `server/scripts/import-utah-roads.ts`

**Step 1: Add the GeoJSON streaming logic**

Add these imports near the top:
```typescript
import StreamArray from 'stream-json/streamers/StreamArray.js';
import { parser as jsonParser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick.js';
```

Add the function:
```typescript
async function importGeoJson(
  db: Database.Database,
  geojsonPath: string,
): Promise<{ inserted: number; skipped: number }> {
  const knownKeys = new Set<string>(
    db.prepare('SELECT utah_road_unique_id FROM roads').all().map((r: any) => r.utah_road_unique_id),
  );
  console.log(`[geom] loaded ${knownKeys.size} road keys for orphan filter`);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO road_segments_geom (utah_road_unique_id, geom_json) VALUES (?, ?)`,
  );

  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  let orphans = 0;
  const batch: Array<{ key: string; geom: string }> = [];
  const FLUSH_EVERY = 50000;

  const flush = db.transaction((items: typeof batch) => {
    for (const item of items) {
      const result = insert.run(item.key, item.geom);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  const stream = fs.createReadStream(geojsonPath)
    .pipe(jsonParser())
    .pipe(pick({ filter: 'features' }))
    .pipe(StreamArray.streamArray());

  for await (const { value } of stream as AsyncIterable<{ value: any }>) {
    const props = value.properties ?? {};
    const key = props.UtahRoadUniqueID ?? props.UniqueID;
    if (!key) continue;
    if (!knownKeys.has(key)) { orphans++; continue; }
    const coords = value.geometry?.coordinates;
    if (!coords) continue;
    batch.push({ key, geom: JSON.stringify(coords) });
    if (batch.length >= FLUSH_EVERY) {
      flush(batch.splice(0));
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[geom] ${inserted} inserted, ${skipped} skipped, ${orphans} orphans, ${elapsed}s elapsed`);
    }
  }
  if (batch.length) flush(batch.splice(0));

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[geom] DONE — ${inserted} inserted, ${skipped} skipped, ${orphans} orphans, ${totalElapsed}s total`);
  return { inserted, skipped };
}
```

In `main()` replace `// TODO Task 6` with:
```typescript
const geomStats = await importGeoJson(db, args.geojson);
```

And after `db.close()`, add a final summary:
```typescript
console.log('\n[summary]');
console.log(`  roads:              ${csvStats.inserted} inserted / ${csvStats.skipped} skipped`);
console.log(`  road_segments_geom: ${geomStats.inserted} inserted / ${geomStats.skipped} skipped`);
```

**Step 2: Smoke-test with a synthetic GeoJSON**

```bash
cat > /tmp/utahroads-smoke/tiny.geojson <<'EOF'
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "UtahRoadUniqueID": "URID-1" },
      "geometry": {
        "type": "MultiLineString",
        "coordinates": [[[-111.89, 40.76],[-111.89, 40.77]]]
      }
    },
    {
      "type": "Feature",
      "properties": { "UtahRoadUniqueID": "URID-ORPHAN" },
      "geometry": {
        "type": "MultiLineString",
        "coordinates": [[[-111.0, 40.0],[-111.0, 40.1]]]
      }
    }
  ]
}
EOF
rm -f /tmp/test-roads.db
npx tsx server/scripts/import-utah-roads.ts --csv /tmp/utahroads-smoke/tiny.csv --geojson /tmp/utahroads-smoke/tiny.geojson --db /tmp/test-roads.db
sqlite3 /tmp/test-roads.db "SELECT utah_road_unique_id, length(geom_json) FROM road_segments_geom;"
```
Expected: 1 row (`URID-1`), the orphan logged but not inserted, summary shows `1 inserted / 0 skipped` for geom and `1 orphans`.

**Step 3: Verify idempotency**

```bash
npx tsx server/scripts/import-utah-roads.ts --csv /tmp/utahroads-smoke/tiny.csv --geojson /tmp/utahroads-smoke/tiny.geojson --db /tmp/test-roads.db
```
Expected: summary shows `0 inserted / 1 skipped` for both tables.

**Step 4: Run typecheck**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

**Step 5: Run the full server test suite**

```bash
cd server && npx vitest run
```
Expected: full suite passes; `addressRange` tests included.

**Step 6: Commit**

```bash
git add server/scripts/import-utah-roads.ts
git commit -m "feat(server): implement GeoJSON pass + summary for Utah Roads importer"
```

---

## Task 7: Local end-to-end dry run on the real source files

**Files:** none modified.

**Step 1: Confirm the source files are still where the brief said**

```bash
ls -lh ~/Downloads/UtahRoads_*.csv ~/Downloads/UtahRoads_*.geojson
```
Expected: CSV ~144MB, GeoJSON ~887MB.

**Step 2: Run the importer against a throwaway local DB**

```bash
rm -f /tmp/utahroads-real.db
time npx tsx server/scripts/import-utah-roads.ts \
  --csv ~/Downloads/UtahRoads_*.csv \
  --geojson ~/Downloads/UtahRoads_*.geojson \
  --db /tmp/utahroads-real.db
```
Expected: completes in 5–15 minutes. Final summary should show roughly 800k–1.1M inserts in `roads` and similar in `road_segments_geom`. Note any non-zero `orphans` count.

**Step 3: Spot-check a known SLC address**

```bash
sqlite3 /tmp/utahroads-real.db "SELECT count(*) FROM roads;"
sqlite3 /tmp/utahroads-real.db "SELECT count(*) FROM road_segments_geom;"
sqlite3 /tmp/utahroads-real.db "SELECT street_name, left_from, left_to, esn_left, postal_community_left FROM roads WHERE street_name='MAIN' AND postal_community_left LIKE '%Salt Lake City%' LIMIT 5;"
```
Expected: row counts in the high hundreds-of-thousands; the `MAIN` query returns multiple segments with sensible address ranges and ESN values.

**Step 4: Note results in the design doc (do NOT commit the throwaway DB)**

Append a "Dry run results" subsection to `docs/plans/2026-04-20-utah-roads-import-design.md` with: row counts, runtime, DB file size delta. Then:

```bash
git add docs/plans/2026-04-20-utah-roads-import-design.md
git commit -m "docs: record local dry-run results for Utah Roads importer"
rm /tmp/utahroads-real.db
```

---

## Task 8: Pre-deploy verification

**Step 1: Full test suite + typecheck + route-collision check**

```bash
cd server && npx tsc --noEmit && npx vitest run && npm run check:routes
cd ../client && npx tsc --noEmit
```
Expected: all four pass with 0 errors and 0 duplicate routes.

**Step 2: Confirm the worktree's husky pre-push hook is wired (Gotcha #44)**

```bash
git config --show-origin --get-all core.hooksPath
```
Expected: only `.husky/_` entries, no per-worktree override pointing at `.git/hooks`. If a `config.worktree` entry appears, run `git config --worktree --unset core.hooksPath`.

**Step 3: Push the branch**

```bash
git push -u origin claude/modest-haslett-ea2ab4
```
Expected: husky pre-push runs the full server vitest suite cleanly; push succeeds.

**Step 4: Open the PR**

Use the `gh pr create` workflow per repo convention. PR body should reference the design doc and call out the manual VPS import step.

---

## Task 9: Production deploy + manual import on VPS

**Do this only after the PR merges to `main`.** Per Gotcha #43, deploy from the `main` workspace, not this worktree, if any other worktree is also active.

**Step 1: Deploy the code**

```bash
cd "/Users/rmpgutah/RMPG Flex"  # main workspace, NOT this worktree
git checkout main && git pull
bash deploy/deploy.sh
curl -sf https://rmpgutah.us/api/health
```
Expected: deploy succeeds, health check returns 200. Tables auto-created at server boot.

**Step 2: Verify tables exist on prod**

```bash
ssh root@194.113.64.90 "sqlite3 /opt/rmpg-flex/server/data/rmpg-flex.db \"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('roads','road_segments_geom');\""
```
Expected: both names listed.

**Step 3: Copy source files to VPS**

```bash
scp ~/Downloads/UtahRoads_*.csv root@194.113.64.90:/tmp/utahroads.csv
scp ~/Downloads/UtahRoads_*.geojson root@194.113.64.90:/tmp/utahroads.geojson
```
Expected: both transfers complete (~1GB total).

**Step 4: Run the importer on the VPS**

```bash
ssh root@194.113.64.90 "cd /opt/rmpg-flex && time npx tsx server/scripts/import-utah-roads.ts --csv /tmp/utahroads.csv --geojson /tmp/utahroads.geojson"
```
Expected: same row counts and timings as the local dry run.

**Step 5: Verify and clean up**

```bash
ssh root@194.113.64.90 "sqlite3 /opt/rmpg-flex/server/data/rmpg-flex.db \"SELECT count(*) FROM roads; SELECT count(*) FROM road_segments_geom;\""
ssh root@194.113.64.90 "ls -lh /opt/rmpg-flex/server/data/rmpg-flex.db"
ssh root@194.113.64.90 "rm /tmp/utahroads.csv /tmp/utahroads.geojson"
```
Expected: row counts match dry run; DB file grew by ~300MB.

**Step 6: Confirm the API is still healthy**

```bash
curl -sf https://rmpgutah.us/api/health
```
Expected: 200 OK. No service restart was required.

---

## Done

The dataset is in production, the helper is tested, and the importer is idempotent for future re-runs. Future work (geocoding endpoint, reverse geocoding, R-tree, map rendering) is intentionally deferred per the design doc.
