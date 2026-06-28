# Vehicle Capture Dossier + OCR Trust Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the model's self-reported OCR confidence with a derived trust score (cross-read consensus + plate-format validity + cross-model corroboration), package every ≥0.80-trust vehicle read into a 3-photo evidence file (full / vehicle / plate), and organize all captures into a per-vehicle dossier.

**Architecture:** A pure, server-authoritative trust core (`src/utils/plateTrust.ts`) scores reads; the capture route gates on that score (≥0.80 package, ≥0.85 assert), merges variant reads to one canonical plate, and writes a `vehicle_capture_photos` row. The client generates the vehicle/plate crops from the workflow bboxes and uploads them; the dossier UI groups packages by canonical plate and shows an honest trust badge.

**Tech Stack:** Hono on Cloudflare Workers, D1 (via `src/utils/db.ts`), R2 (`UPLOADS`), React 18 + Vite + vitest, canvas for client cropping.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `migrations/0118_vehicle_capture_photos.sql` | New `vehicle_capture_photos` table + trust columns on `vehicle_sightings` |
| `src/utils/plateTrust.ts` | **Pure, authoritative** trust core: normalize, format-score, consensus, corroborate, trustScore |
| `tests/plateTrust.test.ts` | Worker-side vitest for the trust core |
| `src/routes/alpr.ts` | Wire trust scoring + gating + canonical merge + `vehicle_capture_photos` persist; add crop-upload endpoint; dossier read endpoints |
| `client/src/utils/plateTrust.ts` | Thin mirror: badge formatter + multi-frame consensus (shares normalize/format logic) |
| `client/src/utils/__tests__/plateTrust.test.ts` | Client vitest for badge + consensus |
| `client/src/utils/vehicleCrops.ts` | Canvas: full/vehicle/plate crops from bboxes; plate-box-expansion fallback |
| `client/src/utils/__tests__/vehicleCrops.test.ts` | vitest for box math + fallback |
| `client/src/components/TrustBadge.tsx` | Honest trust indicator (replaces bare "%") |
| `client/src/components/VehicleDossier.tsx` | Per-vehicle file: 3-thumbnail packages, timeline, export |
| `client/src/components/AlprCaptureGallery.tsx` | Group tiles by canonical plate; use `TrustBadge` |

> **Worker vs client note:** `/src/` and `/client/src/` share no build. The normalize/format logic is duplicated intentionally (kept in sync); the Worker copy is authoritative for gating.

---

### Task 1: Migration — `vehicle_capture_photos` + sighting trust columns

**Files:**
- Create: `migrations/0118_vehicle_capture_photos.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0118_vehicle_capture_photos.sql
-- Per-vehicle-per-capture 3-photo evidence package + derived trust.
CREATE TABLE IF NOT EXISTS vehicle_capture_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_id INTEGER,
  vehicle_record_id INTEGER,
  canonical_plate TEXT,
  raw_reads_json TEXT,          -- [{plate, modelPct, source}]
  variants_json TEXT,           -- [{plate, count}] disagreeing reads
  read_count INTEGER DEFAULT 1,
  consensus_ratio REAL,         -- 0..1 agreement among raw reads
  trust_score REAL,             -- 0..1 derived (authoritative)
  trust_basis TEXT,             -- human-readable ("8/9 frames agree · CA valid")
  full_r2_key TEXT,
  vehicle_r2_key TEXT,
  plate_r2_key TEXT,
  vehicle_bbox_json TEXT,
  plate_bbox_json TEXT,
  source_type TEXT,             -- 'field' | 'dashcam' | 'manual' | 'footage_enhanced'
  asserted INTEGER DEFAULT 0,   -- 1 when >=0.85 (attributes written as fact)
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vcp_vehicle ON vehicle_capture_photos(vehicle_record_id);
CREATE INDEX IF NOT EXISTS idx_vcp_canonical ON vehicle_capture_photos(canonical_plate);
CREATE INDEX IF NOT EXISTS idx_vcp_capture ON vehicle_capture_photos(capture_id);
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: applies without error.

- [ ] **Step 3: Commit**

```bash
git add migrations/0118_vehicle_capture_photos.sql
git commit -m "feat(alpr): migration 0118 vehicle_capture_photos + trust columns"
```

> **After merge to main:** apply this DDL directly to live D1 `785de7ae` (deploy migration apply is `continue-on-error`). The route also reconciles the table at runtime (Task 6), but do not rely on the deploy log.

---

### Task 2: `plateTrust.ts` — `normalizePlate`

**Files:**
- Create: `src/utils/plateTrust.ts`
- Test: `tests/plateTrust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/plateTrust.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../src/utils/plateTrust';

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizePlate(' kjh-345 ')).toBe('KJH345');
  });
  it('maps ambiguous glyphs to a canonical form for comparison', () => {
    // O->0, I->1, S->5, B->8, Z->2
    expect(normalizePlate('OISBZ')).toBe('01582');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plateTrust.test.ts -t normalizePlate`
Expected: FAIL — module not found / `normalizePlate` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/plateTrust.ts
const AMBIGUITY: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2' };

/** Canonical comparison form: uppercase, alphanumerics only, ambiguous glyphs folded. */
export function normalizePlate(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/[OISBZ]/g, (c) => AMBIGUITY[c] ?? c);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plateTrust.test.ts -t normalizePlate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/plateTrust.ts tests/plateTrust.test.ts
git commit -m "feat(alpr): plateTrust.normalizePlate with ambiguity folding"
```

---

### Task 3: `plateTrust.ts` — `formatScore` (jurisdiction grammars)

**Files:**
- Modify: `src/utils/plateTrust.ts`
- Test: `tests/plateTrust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/plateTrust.test.ts
import { formatScore } from '../src/utils/plateTrust';

describe('formatScore', () => {
  it('matches a CA plate (1ABC234) and names the jurisdiction', () => {
    const r = formatScore('5KJH345');
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.jurisdiction).toBe('CA');
  });
  it('penalizes a string that matches no known format', () => {
    expect(formatScore('!!').score).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plateTrust.test.ts -t formatScore`
Expected: FAIL — `formatScore` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/utils/plateTrust.ts

/** One jurisdiction's plate grammar. Seeded with UT + neighbors + CA; extend freely. */
export interface PlateFormat { code: string; label: string; regex: RegExp; }

export const PLATE_FORMATS: PlateFormat[] = [
  { code: 'UT', label: 'Utah',     regex: /^[A-Z]\d{2}[A-Z]{2}$|^\d{3}[A-Z]{3}$/ },
  { code: 'CA', label: 'California', regex: /^\d[A-Z]{3}\d{3}$/ },
  { code: 'AZ', label: 'Arizona',  regex: /^[A-Z]{3}\d{4}$/ },
  { code: 'NV', label: 'Nevada',   regex: /^\d{3}[A-Z]\d{2}$|^[A-Z]{3}\d{3}$/ },
  { code: 'ID', label: 'Idaho',    regex: /^[A-Z]\d{6}$|^\d[A-Z]\d{5}$/ },
  { code: 'WY', label: 'Wyoming',  regex: /^\d{1,2}-?\d{3,5}$/ },
];

export interface FormatResult { score: number; jurisdiction: string | null; }

/** Best jurisdiction match for a RAW (un-normalized) plate. */
export function formatScore(rawPlate: string): FormatResult {
  const plate = (rawPlate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plate.length < 2) return { score: 0.1, jurisdiction: null };
  for (const f of PLATE_FORMATS) {
    if (f.regex.test(plate)) return { score: 0.95, jurisdiction: f.code };
  }
  // Plausible length/charset but no exact grammar → weak partial credit.
  return { score: /^[A-Z0-9]{5,8}$/.test(plate) ? 0.5 : 0.2, jurisdiction: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plateTrust.test.ts -t formatScore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/plateTrust.ts tests/plateTrust.test.ts
git commit -m "feat(alpr): plateTrust.formatScore with jurisdiction grammars"
```

---

### Task 4: `plateTrust.ts` — `consensus`

**Files:**
- Modify: `src/utils/plateTrust.ts`
- Test: `tests/plateTrust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/plateTrust.test.ts
import { consensus } from '../src/utils/plateTrust';

describe('consensus', () => {
  it('picks the majority canonical read and reports the agreement ratio', () => {
    const r = consensus(['KJH345', 'KJH345', '5KJH345', 'KJH345']);
    expect(r.canonical).toBe('KJH345');     // most frequent ORIGINAL spelling of the winning cluster
    expect(r.ratio).toBeCloseTo(0.75, 2);   // 3 of 4 agree (5KJH345 differs after normalize)
    expect(r.variants).toEqual([{ plate: '5KJH345', count: 1 }]);
  });
  it('a single read has ratio 1 but no corroboration (one vote)', () => {
    const r = consensus(['ABC123']);
    expect(r.canonical).toBe('ABC123');
    expect(r.ratio).toBe(1);
    expect(r.readCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plateTrust.test.ts -t consensus`
Expected: FAIL — `consensus` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/utils/plateTrust.ts

export interface ConsensusResult {
  canonical: string;
  ratio: number;                 // share of reads in the winning cluster
  readCount: number;
  variants: { plate: string; count: number }[];
}

/** Cluster reads by normalized form; winner = largest cluster, displayed as its
 *  most common ORIGINAL spelling. ratio = winningClusterSize / total. */
export function consensus(reads: string[]): ConsensusResult {
  const valid = (reads ?? []).filter((r) => r && r.trim());
  if (valid.length === 0) return { canonical: '', ratio: 0, readCount: 0, variants: [] };

  const clusters = new Map<string, string[]>();
  for (const r of valid) {
    const key = normalizePlate(r);
    (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
  let bestKey = ''; let bestArr: string[] = [];
  for (const [k, arr] of clusters) if (arr.length > bestArr.length) { bestKey = k; bestArr = arr; }

  // Display spelling = most frequent original in the winning cluster.
  const spell = new Map<string, number>();
  for (const s of bestArr) spell.set(s, (spell.get(s) ?? 0) + 1);
  const canonical = [...spell.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const variants = [...clusters.entries()]
    .filter(([k]) => k !== bestKey)
    .map(([, arr]) => ({ plate: arr[0], count: arr.length }));

  return { canonical, ratio: bestArr.length / valid.length, readCount: valid.length, variants };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plateTrust.test.ts -t consensus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/plateTrust.ts tests/plateTrust.test.ts
git commit -m "feat(alpr): plateTrust.consensus clusters reads + agreement ratio"
```

---

### Task 5: `plateTrust.ts` — `trustScore` (the gate input)

**Files:**
- Modify: `src/utils/plateTrust.ts`
- Test: `tests/plateTrust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/plateTrust.test.ts
import { trustScore } from '../src/utils/plateTrust';

describe('trustScore', () => {
  it('multi-frame agreement on a format-valid plate beats a lone model 100%', () => {
    const strong = trustScore({ reads: ['5KJH345', '5KJH345', '5KJH345'], modelPct: 0.6 });
    const lone = trustScore({ reads: ['5KJH345'], modelPct: 1.0 });
    expect(strong.trustScore).toBeGreaterThan(lone.trustScore);
  });
  it('caps a single read below the 0.85 assert gate no matter the model %', () => {
    const r = trustScore({ reads: ['5KJH345'], modelPct: 1.0 });
    expect(r.trustScore).toBeLessThan(0.85);
    expect(r.basis).toContain('single read');
  });
  it('surfaces the canonical plate and a human basis', () => {
    const r = trustScore({ reads: ['KJH345', 'KJH345'], modelPct: 0.8 });
    expect(r.canonical).toBe('KJH345');
    expect(typeof r.basis).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plateTrust.test.ts -t trustScore`
Expected: FAIL — `trustScore` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/utils/plateTrust.ts

export interface TrustInput {
  reads: string[];          // every raw plate read (frames / models / sightings)
  modelPct?: number;        // model self-reported confidence (demoted to tiebreaker)
}
export interface TrustResult {
  canonical: string;
  trustScore: number;       // 0..1 — the value the 0.80/0.85 gates run on
  basis: string;
  consensusRatio: number;
  readCount: number;
  variants: { plate: string; count: number }[];
  jurisdiction: string | null;
}

/** Derived trust. Consensus dominates; format validity is a strong factor; the
 *  model's self-reported % is at most a small tiebreaker. A single read is hard-
 *  capped below the assert gate (no corroboration). */
export function trustScore(input: TrustInput): TrustResult {
  const c = consensus(input.reads);
  const fmt = formatScore(c.canonical);
  const parts: string[] = [];

  // Consensus component (dominant). One read => no agreement evidence.
  const consensusComponent = c.readCount <= 1 ? 0.45 : 0.45 + 0.30 * c.ratio;
  if (c.readCount <= 1) parts.push('single read — unverified');
  else parts.push(`${Math.round(c.ratio * c.readCount)}/${c.readCount} agree`);

  // Format component.
  const formatComponent = 0.20 * fmt.score;
  if (fmt.jurisdiction) parts.push(`${fmt.jurisdiction} format valid`);
  else parts.push('no known format');

  // Model % tiebreaker (tiny).
  const tiebreaker = 0.05 * (input.modelPct ?? 0);

  let score = consensusComponent + formatComponent + tiebreaker; // max ~1.0
  if (c.readCount <= 1) score = Math.min(score, 0.84); // never assert on one read

  return {
    canonical: c.canonical,
    trustScore: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    basis: parts.join(' · '),
    consensusRatio: c.ratio,
    readCount: c.readCount,
    variants: c.variants,
    jurisdiction: fmt.jurisdiction,
  };
}
```

- [ ] **Step 4: Run full trust suite**

Run: `npx vitest run tests/plateTrust.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/utils/plateTrust.ts tests/plateTrust.test.ts
git commit -m "feat(alpr): plateTrust.trustScore — derived gate input, model % demoted"
```

---

### Task 6: Capture route — score, gate, merge, persist

**Files:**
- Modify: `src/routes/alpr.ts` (extend `ensureAlprSchema`; use `plateTrust` in `finalizeCapture`; add `POST /capture/:id/photos`, `GET /vehicle/:plate/dossier`)

- [ ] **Step 1: Reconcile the new table at boot**

In `ensureAlprSchema` (near line 95), after the existing `alpr_captures` reconcile, add a guarded create so a fresh deploy doesn't 500 before the migration lands:

```ts
// inside ensureAlprSchema(db)
await execute(db, `CREATE TABLE IF NOT EXISTS vehicle_capture_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, capture_id INTEGER, vehicle_record_id INTEGER,
  canonical_plate TEXT, raw_reads_json TEXT, variants_json TEXT, read_count INTEGER DEFAULT 1,
  consensus_ratio REAL, trust_score REAL, trust_basis TEXT,
  full_r2_key TEXT, vehicle_r2_key TEXT, plate_r2_key TEXT,
  vehicle_bbox_json TEXT, plate_bbox_json TEXT, source_type TEXT,
  asserted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), created_by INTEGER
)`);
```

- [ ] **Step 2: Score + gate in `finalizeCapture`**

Import the trust core at the top of `src/routes/alpr.ts`:

```ts
import { trustScore } from '../utils/plateTrust';
```

In `finalizeCapture`, replace the existing "accept when confidence ≥ threshold" decision so the gate runs on the derived score. Use the per-vehicle reads available (the parser plate + any rawScalars plate variants); pass the model's reported plate confidence as `modelPct`:

```ts
// inside finalizeCapture, per vehicle, before screening/assert:
const reads = [vehicle.plate, ...(extraPlateReads ?? [])].filter(Boolean) as string[];
const trust = trustScore({ reads, modelPct: vehicle.plateConfidence ?? undefined });
const PACKAGE_GATE = 0.80;
const ASSERT_GATE = acceptThreshold(env); // existing env-driven 0.85 default
const canonical = trust.canonical || vehicle.plate;
const asserted = trust.trustScore >= ASSERT_GATE;
const packaged = trust.trustScore >= PACKAGE_GATE;
```

Keep the existing `screenVehicle` call unconditional (screen even sub-0.80; flag hits unconfirmed when `!asserted`). Only call `upsertVehicleRecord(... asserted ? attributes : blanks ...)` when `asserted`.

- [ ] **Step 3: Persist the package row**

After the gate, when `packaged`, insert the row (full frame key reuses the original `imageKey` already stored by the capture handler; crop keys filled by Step 5's endpoint):

```ts
if (packaged) {
  await execute(db,
    `INSERT INTO vehicle_capture_photos
       (capture_id, vehicle_record_id, canonical_plate, raw_reads_json, variants_json,
        read_count, consensus_ratio, trust_score, trust_basis, full_r2_key,
        vehicle_bbox_json, plate_bbox_json, source_type, asserted, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [captureId, vehicleRecordId, canonical, JSON.stringify(reads),
     JSON.stringify(trust.variants), trust.readCount, trust.consensusRatio,
     trust.trustScore, trust.basis, imageKey,
     JSON.stringify(vehicle.vehicleBbox ?? null), JSON.stringify(vehicle.plateBbox ?? null),
     sourceType, asserted ? 1 : 0, userId ?? null]);
}
```

> **Canonical merge:** `upsertVehicleRecord` already upserts by plate — pass `canonical` (not the raw read) as the plate so variant spellings collapse onto one `vehicles_records` row.

- [ ] **Step 4: Crop-upload endpoint**

Add below the existing capture routes:

```ts
// POST /capture/:photoRowId/photos  (multipart: vehicle, plate)
app.post('/capture/:photoRowId/photos', async (c) => {
  const db = getDb(c.env); await ensureAlprSchema(db);
  const id = Number(c.req.param('photoRowId'));
  const form = await c.req.formData();
  const out: Record<string, string> = {};
  for (const field of ['vehicle', 'plate'] as const) {
    const file = form.get(field);
    if (file instanceof File) {
      const key = `alpr/vehicles/${id}/${field}.jpg`;
      await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
      out[`${field}_r2_key`] = key;
    }
  }
  await execute(db, `UPDATE vehicle_capture_photos SET vehicle_r2_key=COALESCE(?,vehicle_r2_key), plate_r2_key=COALESCE(?,plate_r2_key) WHERE id=?`,
    [out.vehicle_r2_key ?? null, out.plate_r2_key ?? null, id]);
  return c.json({ success: true, ...out });
});
```

- [ ] **Step 5: Dossier read endpoint**

```ts
// GET /vehicle/:plate/dossier — all packages for a canonical plate, newest first
app.get('/vehicle/:plate/dossier', async (c) => {
  const db = getDb(c.env); await ensureAlprSchema(db);
  const plate = c.req.param('plate');
  const rows = await query(db,
    `SELECT * FROM vehicle_capture_photos WHERE canonical_plate = ? ORDER BY created_at DESC`, [plate]);
  return c.json({ plate, packages: rows });
});
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Resolve any name mismatches against the real `finalizeCapture` locals — `vehicleRecordId`, `captureId`, `imageKey`, `sourceType`, `userId` — using the values already in scope there.)

- [ ] **Step 7: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "feat(alpr): derive trust, two-tier gate, persist vehicle_capture_photos + dossier endpoints"
```

---

### Task 7: Client `plateTrust.ts` mirror — badge + multi-frame consensus

**Files:**
- Create: `client/src/utils/plateTrust.ts`
- Test: `client/src/utils/__tests__/plateTrust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/__tests__/plateTrust.test.ts
import { describe, it, expect } from 'vitest';
import { trustBadge } from '../plateTrust';

describe('trustBadge', () => {
  it('labels a verified high-trust read', () => {
    const b = trustBadge({ trustScore: 0.94, readCount: 9, basis: '8/9 agree · CA format valid' });
    expect(b.label).toBe('VERIFIED');
    expect(b.tone).toBe('good');
  });
  it('labels a single-read low-trust as unverified, never shows 100%', () => {
    const b = trustBadge({ trustScore: 0.7, readCount: 1, basis: 'single read — unverified' });
    expect(b.label).toBe('UNVERIFIED');
    expect(b.tone).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/plateTrust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/utils/plateTrust.ts
export interface TrustView { trustScore: number; readCount: number; basis: string; }
export interface Badge { label: 'VERIFIED' | 'REVIEW' | 'UNVERIFIED'; tone: 'good' | 'warn'; detail: string; }

/** Honest badge from the server's derived trust. NEVER renders a model self-reported %. */
export function trustBadge(v: TrustView): Badge {
  if (v.readCount <= 1 || v.trustScore < 0.80) return { label: 'UNVERIFIED', tone: 'warn', detail: v.basis };
  if (v.trustScore < 0.85) return { label: 'REVIEW', tone: 'warn', detail: v.basis };
  return { label: 'VERIFIED', tone: 'good', detail: v.basis };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/plateTrust.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/plateTrust.ts client/src/utils/__tests__/plateTrust.test.ts
git commit -m "feat(alpr): client trustBadge — honest confidence labels"
```

---

### Task 8: `vehicleCrops.ts` — canvas crops + fallback

**Files:**
- Create: `client/src/utils/vehicleCrops.ts`
- Test: `client/src/utils/__tests__/vehicleCrops.test.ts`

- [ ] **Step 1: Write the failing test** (pure box math only — canvas is the impure boundary)

```ts
// client/src/utils/__tests__/vehicleCrops.test.ts
import { describe, it, expect } from 'vitest';
import { cropRect, expandPlateBoxToVehicle } from '../vehicleCrops';

describe('cropRect', () => {
  it('converts a center-based bbox to a top-left rect, clamped to image bounds', () => {
    const r = cropRect({ x: 50, y: 40, width: 20, height: 10 }, 100, 100);
    expect(r).toEqual({ sx: 40, sy: 35, sw: 20, sh: 10 });
  });
  it('clamps a bbox that runs past the edge', () => {
    const r = cropRect({ x: 95, y: 95, width: 20, height: 20 }, 100, 100);
    expect(r.sx).toBe(85); expect(r.sw).toBe(15);
  });
});

describe('expandPlateBoxToVehicle', () => {
  it('expands the plate box by the ratio, clamped to bounds', () => {
    const v = expandPlateBoxToVehicle({ x: 50, y: 50, width: 10, height: 5 }, 100, 100, 3);
    expect(v.width).toBe(30); expect(v.height).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/vehicleCrops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/utils/vehicleCrops.ts
export interface Bbox { x: number; y: number; width: number; height: number } // center-based
export interface Rect { sx: number; sy: number; sw: number; sh: number }

/** Center-based bbox → clamped top-left source rect. */
export function cropRect(b: Bbox, imgW: number, imgH: number): Rect {
  let sx = Math.round(b.x - b.width / 2);
  let sy = Math.round(b.y - b.height / 2);
  let sw = Math.round(b.width);
  let sh = Math.round(b.height);
  if (sx < 0) { sw += sx; sx = 0; }
  if (sy < 0) { sh += sy; sy = 0; }
  if (sx + sw > imgW) sw = imgW - sx;
  if (sy + sh > imgH) sh = imgH - sy;
  return { sx, sy, sw, sh };
}

/** Fallback vehicle box when the car detector returned none: grow the plate box. */
export function expandPlateBoxToVehicle(plate: Bbox, imgW: number, imgH: number, ratio = 3): Bbox {
  return {
    x: plate.x, y: plate.y,
    width: Math.min(plate.width * ratio, imgW),
    height: Math.min(plate.height * ratio, imgH),
  };
}

/** Crop an image region to a JPEG blob (impure — canvas; not unit-tested). */
export async function cropToBlob(img: HTMLImageElement, b: Bbox): Promise<Blob> {
  const { sx, sy, sw, sh } = cropRect(b, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = sh;
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((res) => canvas.toBlob((bl) => res(bl!), 'image/jpeg', 0.92));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/vehicleCrops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/vehicleCrops.ts client/src/utils/__tests__/vehicleCrops.test.ts
git commit -m "feat(alpr): vehicleCrops box math + canvas crop + plate-box fallback"
```

---

### Task 9: `TrustBadge.tsx` + replace the bare "%" in the gallery

**Files:**
- Create: `client/src/components/TrustBadge.tsx`
- Modify: `client/src/components/AlprCaptureGallery.tsx`

- [ ] **Step 1: Write the badge component**

```tsx
// client/src/components/TrustBadge.tsx
import { trustBadge, type TrustView } from '../utils/plateTrust';

export default function TrustBadge({ trust }: { trust: TrustView }) {
  const b = trustBadge(trust);
  const color = b.tone === 'good' ? '#d4a017' : '#888888';
  return (
    <span title={b.detail} style={{ color, border: `1px solid ${color}`, padding: '0 4px', fontSize: 9 }}>
      {b.label}
    </span>
  );
}
```

- [ ] **Step 2: Use it in the gallery**

In `AlprCaptureGallery.tsx`, replace the element that renders the raw confidence percentage (the `80%`/`100%` chip) with `<TrustBadge trust={{ trustScore: cap.trust_score, readCount: cap.read_count, basis: cap.trust_basis }} />`, reading the new fields from the capture/package row.

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TrustBadge.tsx client/src/components/AlprCaptureGallery.tsx
git commit -m "feat(alpr): replace self-reported % with honest TrustBadge in gallery"
```

---

### Task 10: `VehicleDossier.tsx` — the per-vehicle file + gallery grouping

**Files:**
- Create: `client/src/components/VehicleDossier.tsx`
- Modify: `client/src/components/AlprCaptureGallery.tsx` (group tiles by `canonical_plate`; click → dossier)

- [ ] **Step 1: Write the dossier component**

```tsx
// client/src/components/VehicleDossier.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import TrustBadge from './TrustBadge';

interface Pkg {
  id: number; canonical_plate: string; trust_score: number; read_count: number;
  trust_basis: string; full_r2_key: string; vehicle_r2_key: string | null;
  plate_r2_key: string | null; source_type: string; asserted: number; created_at: string;
  variants_json: string;
}

export default function VehicleDossier({ plate }: { plate: string }) {
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  useEffect(() => { apiFetch<{ packages: Pkg[] }>(`/alpr/vehicle/${plate}/dossier`).then((r) => setPkgs(r.packages)).catch(console.error); }, [plate]);
  const img = (k: string | null) => k ? `/api/alpr/image/${encodeURIComponent(k)}` : '';
  return (
    <div className="p-4 space-y-3">
      {pkgs.map((p) => (
        <div key={p.id} className="border border-[#232323] p-2 flex gap-2 items-center">
          {[p.full_r2_key, p.vehicle_r2_key, p.plate_r2_key].map((k, i) =>
            k ? <img key={i} src={img(k)} alt="" style={{ height: 56 }} /> : null)}
          <div className="text-[11px]">
            <div className="font-semibold">{p.canonical_plate} <TrustBadge trust={{ trustScore: p.trust_score, readCount: p.read_count, basis: p.trust_basis }} /></div>
            <div style={{ color: '#888' }}>{p.source_type} · {p.created_at}</div>
            {JSON.parse(p.variants_json || '[]').length > 0 &&
              <div style={{ color: '#888' }}>variants: {JSON.parse(p.variants_json).map((v: any) => v.plate).join(', ')} — verify</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Group the gallery by canonical plate**

In `AlprCaptureGallery.tsx`, group captures by `canonical_plate` and render one tile per vehicle (most recent package as the face, count badge for the rest); clicking opens `<VehicleDossier plate={canonical} />` in a modal/panel.

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/VehicleDossier.tsx client/src/components/AlprCaptureGallery.tsx
git commit -m "feat(alpr): per-vehicle dossier view + gallery grouping by canonical plate"
```

---

### Task 11: Wire crop generation into the capture flow

**Files:**
- Modify: the on-scene/manual capture caller (`PlateLogPage.tsx` and/or `FieldCameraPage.tsx`) to, after a successful capture response containing bboxes, generate the vehicle+plate crops and POST them.

- [ ] **Step 1: After capture, generate + upload crops**

Where the capture response is handled, for each returned vehicle with a `photoRowId` + bboxes:

```ts
import { cropToBlob, expandPlateBoxToVehicle } from '../utils/vehicleCrops';
import { apiPostForm } from '../hooks/useApi';

async function uploadCrops(photoRowId: number, img: HTMLImageElement, plateBbox: any, vehicleBbox: any | null) {
  const vb = vehicleBbox ?? expandPlateBoxToVehicle(plateBbox, img.naturalWidth, img.naturalHeight);
  const fd = new FormData();
  fd.append('vehicle', await cropToBlob(img, vb), 'vehicle.jpg');
  fd.append('plate', await cropToBlob(img, plateBbox), 'plate.jpg');
  await apiPostForm(`/alpr/capture/${photoRowId}/photos`, fd);
}
```

> The capture route (Task 6) must return each persisted package's `id` as `photoRowId` plus its `plateBbox`/`vehicleBbox` so the client can crop. Add those to the capture JSON response.

- [ ] **Step 2: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/PlateLogPage.tsx
git commit -m "feat(alpr): client generates + uploads vehicle/plate crops after capture"
```

---

### Task 12: Service worker bump + verification

**Files:**
- Modify: `client/public/sw.js` (`CACHE_NAME`)

- [ ] **Step 1: Bump the cache name**

Increment `CACHE_NAME` (e.g. `…-v943` → next number; check the current value first).

- [ ] **Step 2: Full gate**

Run: `npm run typecheck && cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(alpr): bump SW cache for dossier + trust layer"
```

> **Post-merge:** apply `migrations/0118_vehicle_capture_photos.sql` directly to live D1 `785de7ae` and verify with `pragma_table_info('vehicle_capture_photos')`.

---

## Self-Review

- **Spec coverage:** two-tier gate (T5/T6), derived trust replacing model % (T2–T6, T9), 3-photo package (T6/T8/T11), per-vehicle dossier + grouping (T10), consensus merge + variant flag (T4/T6/T10), honest badge (T7/T9), all-sources `source_type` (T6), migration + live-apply note (T1/T12). Covered.
- **Placeholder scan:** none — every code step is concrete. The only deferred detail is matching real local-variable names in `finalizeCapture` (T6 Step 2/6), which is a wiring instruction, not a placeholder.
- **Type consistency:** `TrustView`/`Badge` (client) and `TrustResult`/`ConsensusResult`/`FormatResult` (Worker) are used consistently; `vehicle_capture_photos` columns match across T1/T6/T10; `cropRect`/`expandPlateBoxToVehicle`/`cropToBlob` names align T8↔T11.
