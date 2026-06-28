# Dashcam Redaction Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-browser "Redaction Studio" that blurs plates/faces/people in a dashcam clip and exports a court-grade MP4, stored to R2 with a chain-of-custody record.

**Architecture:** Client-heavy. A canvas applies per-frame blur to detected/manual regions; ffmpeg.wasm (single-threaded core, lazy-loaded from CDN) encodes the redacted frames + original audio to MP4. The Worker only persists the finished file + a `video_redactions` custody row. Pure region/blur math is unit-tested; the new `/api/redactions` route gets a Miniflare smoke test.

**Tech Stack:** React 18 + TypeScript + Vite (client), Hono on Cloudflare Workers (API), D1, R2, `@ffmpeg/ffmpeg`/`@ffmpeg/util` (MP4 encode), `@tensorflow-models/blazeface` + existing `@tensorflow-models/coco-ssd` (detection), vitest (+ `@cloudflare/vitest-pool-workers` Miniflare harness).

**Dependency note:** The Worker smoke test (Task 3) reuses the Miniflare harness (`test-workers/`, `vitest.workers.config.mts`, `npm run test:worker`, the `@cloudflare/vitest-pool-workers` devDep) introduced in PR #1283. **Rebase this branch onto `main` after #1283 merges** before running Task 3, or that harness won't exist. All other tasks are independent of #1283.

---

## File Structure

**Worker (`/src/`)**
- Create `migrations/0121_video_redactions.sql` — custody table DDL.
- Create `src/routes/redactions.ts` — `/api/redactions` POST/GET/download + runtime schema reconcile.
- Modify `src/index.ts` — mount the router + auth prefix.
- Create `test-workers/redactions.test.ts` — Miniflare route smoke test (needs #1283 harness).

**Client pure (`/client/src/utils/redaction/`)**
- Create `regions.ts` — `RedactionRegion` model + `activeRegionsAt`/`interpBox`/`mergeSamples`/`iou`/`normBox`/`denormBox` (the brain).
- Create `regions.test.ts` — unit tests.
- Create `blur.ts` — `pixelate` (pure) + `applyRegionEffect` (canvas).
- Create `blur.test.ts` — unit tests for `pixelate`.

**Client I/O (`/client/src/utils/redaction/`)**
- Create `detectFaces.ts` — lazy BlazeFace loader + `detectFaces`.
- Create `scanClip.ts` — seek-and-detect pass → `RedactionRegion[]`.
- Create `renderRedacted.ts` — canvas redact + ffmpeg.wasm MP4 encode.

**Client UI**
- Create `client/src/components/RedactionStudio.tsx` — the editor modal.
- Modify `client/src/components/ForensicDashcamPlayer.tsx` — add a `REDACT` toolbar button that opens it.
- Modify `client/public/sw.js` — bump `CACHE_NAME`.
- Modify `client/package.json` — add `@ffmpeg/ffmpeg`, `@ffmpeg/util`.

---

## Task 1: D1 migration — `video_redactions` custody table

**Files:**
- Create: `migrations/0121_video_redactions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0121_video_redactions.sql — chain-of-custody for in-video redaction exports.
-- Idempotent (CREATE TABLE IF NOT EXISTS). The redactions route also reconciles
-- columns at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE.
CREATE TABLE IF NOT EXISTS video_redactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id INTEGER,
  r2_key          TEXT NOT NULL,
  kinds           TEXT,            -- csv of redaction kinds, e.g. "face,license_plate"
  region_count    INTEGER NOT NULL DEFAULT 0,
  style           TEXT,            -- dominant style: blur | pixelate | box
  regions_json    TEXT,            -- sidecar: the RedactionRegion[] used (re-open/verify)
  redacted_by     INTEGER,
  status          TEXT NOT NULL DEFAULT 'completed',
  requested_at    TEXT,
  completed_at    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_video_redactions_event ON video_redactions (source_event_id);
```

- [ ] **Step 2: Apply locally to verify the DDL parses**

Run: `npm run migrate:local`
Expected: applies without error; `video_redactions` created in the local D1.

- [ ] **Step 3: Commit**

```bash
git add migrations/0121_video_redactions.sql
git commit -m "feat(redaction): video_redactions custody migration (0121)"
```

---

## Task 2: Worker route — `/api/redactions`

**Files:**
- Create: `src/routes/redactions.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the route**

```ts
// src/routes/redactions.ts
// Chain-of-custody store for in-browser video redaction exports. The redacted
// MP4 is produced client-side (canvas + ffmpeg.wasm); this route only persists
// the finished file to R2 and a video_redactions custody row. Mirrors the
// best-effort + runtime-reconcile patterns in src/routes/alpr.ts.
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, execute, query, queryFirst, columnExists } from '../utils/db';

const redactions = new Hono<Env>();

const EXTRA_COLUMNS: Array<[string, string]> = [
  ['regions_json', 'TEXT'], ['kinds', 'TEXT'], ['style', 'TEXT'],
  ['region_count', 'INTEGER'], ['status', 'TEXT'], ['notes', 'TEXT'],
  ['requested_at', 'TEXT'], ['completed_at', 'TEXT'],
];

async function ensureSchema(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS video_redactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_event_id INTEGER, r2_key TEXT NOT NULL,
    kinds TEXT, region_count INTEGER NOT NULL DEFAULT 0, style TEXT, regions_json TEXT,
    redacted_by INTEGER, status TEXT NOT NULL DEFAULT 'completed', requested_at TEXT,
    completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [name, type] of EXTRA_COLUMNS) {
    if (!(await columnExists(db, 'video_redactions', name))) {
      try { await execute(db, `ALTER TABLE video_redactions ADD COLUMN ${name} ${type}`); }
      catch { /* race / already present */ }
    }
  }
}

// POST /api/redactions — multipart: `video` (MP4 blob) + `metadata` (JSON string).
redactions.post('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number) ?? null;
  await ensureSchema(db);

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data with a `video` file' }, 400); }

  const fileEntry = form.get('video');
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File) : null;
  if (!file) return c.json({ error: 'Missing redacted video (field: video)' }, 400);

  let meta: any = {};
  try { meta = JSON.parse(String(form.get('metadata') ?? '{}')); } catch { /* tolerate */ }

  const r2Key = `redactions/${crypto.randomUUID()}.mp4`;
  try {
    await c.env.UPLOADS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: 'video/mp4' } });
  } catch (err: any) {
    return c.json({ error: `storage failed: ${err?.message ?? 'unknown'}` }, 502);
  }

  const kinds: string = Array.isArray(meta.kinds) ? meta.kinds.join(',') : (typeof meta.kinds === 'string' ? meta.kinds : '');
  const res = await execute(db,
    `INSERT INTO video_redactions
       (source_event_id, r2_key, kinds, region_count, style, regions_json, redacted_by,
        status, requested_at, completed_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), ?)`,
    Number(meta.event_id) || null, r2Key, kinds, Number(meta.region_count) || 0,
    typeof meta.style === 'string' ? meta.style : null,
    typeof meta.regions_json === 'string' ? meta.regions_json : (meta.regions ? JSON.stringify(meta.regions) : null),
    userId, meta.requested_at ?? null, typeof meta.notes === 'string' ? meta.notes : null);

  return c.json({ success: true, id: Number(res.meta.last_row_id), r2_key: r2Key,
    download_url: `/api/redactions/${Number(res.meta.last_row_id)}/download` });
});

// GET /api/redactions?event_id= — custody records (newest first).
redactions.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const eventId = c.req.query('event_id');
  const rows = eventId
    ? await query<any>(db, `SELECT id, source_event_id, r2_key, kinds, region_count, style, redacted_by, status, created_at FROM video_redactions WHERE source_event_id = ? ORDER BY id DESC LIMIT 100`, Number(eventId))
    : await query<any>(db, `SELECT id, source_event_id, r2_key, kinds, region_count, style, redacted_by, status, created_at FROM video_redactions ORDER BY id DESC LIMIT 100`);
  return c.json({ redactions: rows });
});

// GET /api/redactions/:id/download — stream the redacted MP4 from R2.
redactions.get('/:id/download', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const row = await queryFirst<{ r2_key: string }>(db, `SELECT r2_key FROM video_redactions WHERE id = ?`, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.UPLOADS.get(row.r2_key);
  if (!obj) return c.json({ error: 'File missing from storage' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="redacted-${c.req.param('id')}.mp4"` } });
});

export default redactions;
```

- [ ] **Step 2: Mount the router in `src/index.ts`**

Find where other routers are mounted (e.g. `app.route('/api/alpr', alprRouter)` and the matching `app.use('/api/alpr', authMiddleware)`). Add alongside them:

```ts
import redactionsRouter from './routes/redactions';
// ... with the other app.use auth prefixes:
app.use('/api/redactions/*', authMiddleware);
// ... with the other app.route mounts:
app.route('/api/redactions', redactionsRouter);
```

(Match the EXACT auth-middleware + readOnlyRoleGuard pattern used by `/api/alpr` in this file — copy that prefix's two lines and rename to `/api/redactions`.)

- [ ] **Step 3: Worker typecheck**

Run: `npm run typecheck`
Expected: passes (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/routes/redactions.ts src/index.ts
git commit -m "feat(redaction): /api/redactions custody route"
```

---

## Task 3: Worker smoke test (Miniflare) — requires #1283 harness on main

**Files:**
- Create: `test-workers/redactions.test.ts`
- Modify: `test-workers/entry.ts` (mount the redactions router too)

> Rebase this branch onto `main` AFTER #1283 merges so `test-workers/`, `vitest.workers.config.mts`, and the `test:worker` script exist.

- [ ] **Step 1: Add the redactions router to the test entry**

In `test-workers/entry.ts`, alongside the existing `app.route('/api/alpr', alpr)`:

```ts
import redactions from '../src/routes/redactions';
app.route('/api/redactions', redactions);
```

- [ ] **Step 2: Write the failing smoke test**

```ts
// test-workers/redactions.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from './entry';

describe('POST /api/redactions — stores the redacted MP4 + custody row', () => {
  it('persists the file to R2 and a custody record, then lists + downloads it', async () => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'redacted.mp4');
    fd.append('metadata', JSON.stringify({ event_id: 42, kinds: ['face', 'license_plate'], region_count: 3, style: 'blur' }));

    const res = await app.request('/api/redactions', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; download_url: string };
    expect(body.id).toBeGreaterThan(0);

    const list = await app.request('/api/redactions?event_id=42', {}, env as unknown as Record<string, unknown>);
    const listBody = await list.json() as { redactions: Array<{ id: number; kinds: string; region_count: number }> };
    expect(listBody.redactions[0].kinds).toContain('face');
    expect(listBody.redactions[0].region_count).toBe(3);

    const dl = await app.request(body.download_url, {}, env as unknown as Record<string, unknown>);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('video/mp4');
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `npm run test:worker`
Expected: PASS (2 test files now — alprCapture + redactions).

- [ ] **Step 4: Commit**

```bash
git add test-workers/redactions.test.ts test-workers/entry.ts
git commit -m "test(redaction): Miniflare smoke test for /api/redactions"
```

---

## Task 4: Pure region model — `regions.ts`

**Files:**
- Create: `client/src/utils/redaction/regions.ts`
- Test: `client/src/utils/redaction/regions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/redaction/regions.test.ts
import { describe, it, expect } from 'vitest';
import { iou, interpBox, activeRegionsAt, mergeSamples, type RedactionRegion, type DetectorSample } from './regions';

const region = (over: Partial<RedactionRegion>): RedactionRegion => ({
  id: 'r', kind: 'plate', keyframes: [{ t: 0, box: [0, 0, 0.2, 0.2] }], tStart: 0, tEnd: 1,
  style: 'blur', strength: 12, source: 'auto', enabled: true, ...over,
});

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint', () => {
    expect(iou([0, 0, 1, 1], [0, 0, 1, 1])).toBeCloseTo(1);
    expect(iou([0, 0, 0.1, 0.1], [0.9, 0.9, 0.1, 0.1])).toBe(0);
  });
});

describe('interpBox', () => {
  it('linearly interpolates between surrounding keyframes', () => {
    const r = region({ keyframes: [{ t: 0, box: [0, 0, 0.2, 0.2] }, { t: 2, box: [0.4, 0, 0.2, 0.2] }], tStart: 0, tEnd: 2 });
    expect(interpBox(r, 1)[0]).toBeCloseTo(0.2);
  });
  it('clamps to the nearest keyframe outside the span', () => {
    const r = region({ keyframes: [{ t: 1, box: [0.5, 0, 0.2, 0.2] }], tStart: 1, tEnd: 1 });
    expect(interpBox(r, 0)[0]).toBeCloseTo(0.5);
    expect(interpBox(r, 9)[0]).toBeCloseTo(0.5);
  });
});

describe('activeRegionsAt', () => {
  it('returns only enabled regions whose span covers t', () => {
    const rs = [region({ id: 'a', tStart: 0, tEnd: 1 }), region({ id: 'b', tStart: 2, tEnd: 3 }), region({ id: 'c', tStart: 0, tEnd: 5, enabled: false })];
    expect(activeRegionsAt(rs, 0.5).map((r) => r.id)).toEqual(['a']);
    expect(activeRegionsAt(rs, 2.5).map((r) => r.id)).toEqual(['b']);
  });
});

describe('mergeSamples', () => {
  it('groups overlapping consecutive same-kind samples into one keyframed region', () => {
    const s: DetectorSample[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], t: 0 },
      { kind: 'face', box: [0.12, 0.1, 0.1, 0.1], t: 0.25 },
      { kind: 'face', box: [0.8, 0.8, 0.1, 0.1], t: 0.25 }, // different object
    ];
    const out = mergeSamples(s, { scanInterval: 0.25 });
    expect(out.length).toBe(2);
    const tracked = out.find((r) => r.keyframes.length === 2)!;
    expect(tracked.tStart).toBeCloseTo(0);
    expect(tracked.tEnd).toBeCloseTo(0.25);
  });

  it('pads a lone sample by the scan interval', () => {
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 1 }], { scanInterval: 0.25 });
    expect(out[0].tStart).toBeCloseTo(0.875);
    expect(out[0].tEnd).toBeCloseTo(1.125);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/utils/redaction/regions.test.ts`
Expected: FAIL — cannot resolve `./regions`.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/redaction/regions.ts
// Pure region model for the Redaction Studio. A region carries KEYFRAMED boxes
// (so a moving plate/face stays covered) over [tStart,tEnd]. Everything here is
// deterministic + unit-tested; canvas/ffmpeg consume it.

/** [x, y, w, h] in fractional 0..1 frame coordinates. */
export type NormBox = [number, number, number, number];
export interface Keyframe { t: number; box: NormBox }
export type RedactionKind = 'plate' | 'face' | 'person' | 'manual';
export type RedactionStyle = 'blur' | 'pixelate' | 'box';

export interface RedactionRegion {
  id: string;
  kind: RedactionKind;
  keyframes: Keyframe[];     // sorted by t, length >= 1
  tStart: number;
  tEnd: number;
  style: RedactionStyle;
  strength: number;          // blur px radius / pixelate block size
  source: 'auto' | 'manual';
  enabled: boolean;
}

export interface DetectorSample { kind: RedactionKind; box: NormBox; t: number }

/** Intersection-over-union of two fractional boxes. */
export function iou(a: NormBox, b: NormBox): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3], bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy, uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni <= 0 ? 0 : inter / uni;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Interpolate a region's box at time t (clamps outside the keyframe range). */
export function interpBox(region: RedactionRegion, t: number): NormBox {
  const k = region.keyframes;
  if (k.length === 1 || t <= k[0].t) return k[0].box;
  if (t >= k[k.length - 1].t) return k[k.length - 1].box;
  let i = 0; while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return [lerp(a.box[0], b.box[0], f), lerp(a.box[1], b.box[1], f), lerp(a.box[2], b.box[2], f), lerp(a.box[3], b.box[3], f)];
}

/** Enabled regions whose [tStart,tEnd] covers t. */
export function activeRegionsAt(regions: RedactionRegion[], t: number): RedactionRegion[] {
  return regions.filter((r) => r.enabled && t >= r.tStart && t <= r.tEnd);
}

let _seq = 0;
const nextId = () => `auto_${Date.now().toString(36)}_${_seq++}`;

export interface MergeOpts { scanInterval?: number; iouThresh?: number; defaultStyle?: RedactionStyle; strength?: number }

/** Group temporally-consecutive, spatially-overlapping same-kind samples into
 *  keyframed regions. A lone sample is padded by ±scanInterval/2. */
export function mergeSamples(samples: DetectorSample[], opts: MergeOpts = {}): RedactionRegion[] {
  const scanInterval = opts.scanInterval ?? 0.25;
  const iouThresh = opts.iouThresh ?? 0.2;
  const style = opts.defaultStyle ?? 'blur';
  const strength = opts.strength ?? 12;
  const sorted = [...samples].sort((a, b) => a.t - b.t);

  interface Open { region: RedactionRegion; lastT: number; lastBox: NormBox }
  const open: Open[] = [];
  const done: RedactionRegion[] = [];

  for (const s of sorted) {
    let best: Open | null = null, bestIou = iouThresh;
    for (const o of open) {
      if (o.region.kind !== s.kind) continue;
      if (s.t - o.lastT > scanInterval * 2.5) continue;
      const ov = iou(o.lastBox, s.box);
      if (ov >= bestIou) { bestIou = ov; best = o; }
    }
    if (best) {
      best.region.keyframes.push({ t: s.t, box: s.box });
      best.region.tEnd = s.t; best.lastT = s.t; best.lastBox = s.box;
    } else {
      const region: RedactionRegion = {
        id: nextId(), kind: s.kind, keyframes: [{ t: s.t, box: s.box }],
        tStart: s.t, tEnd: s.t, style, strength, source: 'auto', enabled: true,
      };
      open.push({ region, lastT: s.t, lastBox: s.box });
    }
  }
  for (const o of open) {
    const r = o.region;
    if (r.keyframes.length === 1) { r.tStart = r.tStart - scanInterval / 2; r.tEnd = r.tEnd + scanInterval / 2; }
    done.push(r);
  }
  return done;
}

/** Fractional box → natural px (and back). */
export const denormBox = (b: NormBox, w: number, h: number): NormBox => [b[0] * w, b[1] * h, b[2] * w, b[3] * h];
export const normBox = (b: NormBox, w: number, h: number): NormBox => [b[0] / w, b[1] / h, b[2] / w, b[3] / h];
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/utils/redaction/regions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/redaction/regions.ts client/src/utils/redaction/regions.test.ts
git commit -m "feat(redaction): pure region model (keyframed boxes, merge, interp)"
```

---

## Task 5: Pure pixelate + canvas effects — `blur.ts`

**Files:**
- Create: `client/src/utils/redaction/blur.ts`
- Test: `client/src/utils/redaction/blur.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/redaction/blur.test.ts
import { describe, it, expect } from 'vitest';
import { pixelate } from './blur';

describe('pixelate', () => {
  it('replaces each block with its average so all pixels in a block match', () => {
    // 2x2 image, block=2 → one block, every pixel becomes the mean.
    const px = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
    pixelate(px, 2, 2, 2);
    const mean = Math.round((0 + 100 + 100 + 200) / 4);
    for (let i = 0; i < 16; i += 4) expect(px[i]).toBe(mean);
  });
  it('preserves alpha and never throws on block larger than the image', () => {
    const px = new Uint8ClampedArray([10, 20, 30, 128]);
    expect(() => pixelate(px, 1, 1, 8)).not.toThrow();
    expect(px[3]).toBe(128);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/utils/redaction/blur.test.ts`
Expected: FAIL — cannot resolve `./blur`.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/redaction/blur.ts
// Canvas region effects for redaction. `pixelate` (pure mosaic math) is unit-
// tested; `applyRegionEffect` rasterizes onto a 2D context (browser only).
import type { NormBox, RedactionStyle } from './regions';

/** Mosaic an RGBA buffer in place: each block×block cell becomes its mean. */
export function pixelate(px: Uint8ClampedArray, w: number, h: number, block: number): void {
  const b = Math.max(1, Math.floor(block));
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      let r = 0, g = 0, bl = 0, n = 0;
      const yEnd = Math.min(h, by + b), xEnd = Math.min(w, bx + b);
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const o = (y * w + x) * 4; r += px[o]; g += px[o + 1]; bl += px[o + 2]; n++;
      }
      if (!n) continue;
      const ar = Math.round(r / n), ag = Math.round(g / n), ab = Math.round(bl / n);
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const o = (y * w + x) * 4; px[o] = ar; px[o + 1] = ag; px[o + 2] = ab;
      }
    }
  }
}

/** Apply a redaction effect to a denormalized px box on a 2D context. */
export function applyRegionEffect(
  ctx: CanvasRenderingContext2D, boxPx: NormBox, style: RedactionStyle, strength: number,
): void {
  const [x, y, w, h] = boxPx.map((v) => Math.round(v)) as NormBox;
  if (w < 1 || h < 1) return;
  if (style === 'box') { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); return; }
  if (style === 'blur') {
    // Re-draw the region through a blur filter onto itself.
    ctx.save();
    ctx.filter = `blur(${Math.max(2, Math.round(strength))}px)`;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
    ctx.restore();
    return;
  }
  // pixelate
  const img = ctx.getImageData(x, y, w, h);
  pixelate(img.data, w, h, Math.max(4, Math.round(strength)));
  ctx.putImageData(img, x, y);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/utils/redaction/blur.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/redaction/blur.ts client/src/utils/redaction/blur.test.ts
git commit -m "feat(redaction): pixelate (pure) + canvas region effects"
```

---

## Task 6: Face detector — `detectFaces.ts`

**Files:**
- Create: `client/src/utils/redaction/detectFaces.ts`

> No unit test — model load + inference is browser-only (mirrors `aiVehicleTracking.ts`, which is also untested). Correctness verified via the live clip in Task 11.

- [ ] **Step 1: Write the loader + detector**

```ts
// client/src/utils/redaction/detectFaces.ts
// Lazy BlazeFace loader on the SAME tfjs runtime coco-ssd already pulls in
// (aiVehicleTracking.ts loads @tensorflow/tfjs first), so no second engine. Used
// by the redaction scan to find bystander faces. Degrades to [] on any failure.
import type { NormBox } from './regions';

const TFJS_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';
const BLAZEFACE_URL = 'https://esm.sh/@tensorflow-models/blazeface@0.1.0?deps=@tensorflow/tfjs-core@4.22.0';

let modelPromise: Promise<unknown | null> | null = null;

export function loadFaceDetector(): Promise<unknown | null> {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const tf: any = await import(/* @vite-ignore */ TFJS_URL);
        await tf.ready();
        const blazeface: any = await import(/* @vite-ignore */ BLAZEFACE_URL);
        return await blazeface.load();
      } catch (e) {
        console.warn('[redaction] face model load failed', e);
        return null;
      }
    })();
  }
  return modelPromise;
}

/** Detect faces in the current video frame → fractional boxes (padded 25% so the
 *  whole face/hairline is covered). [] on any issue. */
export async function detectFaces(model: unknown, video: HTMLVideoElement): Promise<NormBox[]> {
  const m = model as { estimateFaces?: (v: HTMLVideoElement, returnTensors: boolean) => Promise<Array<{ topLeft: [number, number]; bottomRight: [number, number] }>> };
  if (!m?.estimateFaces || video.readyState < 2 || !video.videoWidth) return [];
  try {
    const W = video.videoWidth, H = video.videoHeight;
    const faces = await m.estimateFaces(video, false);
    return faces.map((f) => {
      const [x1, y1] = f.topLeft, [x2, y2] = f.bottomRight;
      const w = x2 - x1, h = y2 - y1, padX = w * 0.25, padY = h * 0.25;
      const nx = Math.max(0, x1 - padX), ny = Math.max(0, y1 - padY);
      const nw = Math.min(W - nx, w + padX * 2), nh = Math.min(H - ny, h + padY * 2);
      return [nx / W, ny / H, nw / W, nh / H] as NormBox;
    });
  } catch { return []; }
}
```

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/redaction/detectFaces.ts
git commit -m "feat(redaction): lazy BlazeFace face detector"
```

---

## Task 7: Clip scan pass — `scanClip.ts`

**Files:**
- Create: `client/src/utils/redaction/scanClip.ts`

> No unit test — seek/decode loop is browser-only. The pure aggregation it relies on (`mergeSamples`) is already tested in Task 4.

- [ ] **Step 1: Write the scan**

```ts
// client/src/utils/redaction/scanClip.ts
// Seek through a clip at a fixed cadence, run vehicle/plate (coco-ssd) + face
// (blazeface) detection at each sample, and merge the samples into keyframed
// RedactionRegions. Reuses the existing detector + plateRegion geometry.
import { loadVehicleDetector, detectVehicles } from '../aiVehicleTracking';
import { plateRegion, clampBox } from '../drivingPrediction';
import { loadFaceDetector, detectFaces } from './detectFaces';
import { mergeSamples, normBox, type DetectorSample, type RedactionRegion, type NormBox } from './regions';

export interface ScanOpts { intervalSec?: number; includePeople?: boolean; onProgress?: (frac: number) => void }

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, (video.duration || t) - 0.01);
  });
}

export async function scanClip(video: HTMLVideoElement, opts: ScanOpts = {}): Promise<RedactionRegion[]> {
  const interval = opts.intervalSec ?? 0.25;
  const W = video.videoWidth, H = video.videoHeight;
  const duration = video.duration || 0;
  if (!W || !H || !duration) return [];

  const [vehModel, faceModel] = await Promise.all([loadVehicleDetector(), loadFaceDetector()]);
  const wasPaused = video.paused; video.pause();
  const samples: DetectorSample[] = [];

  let t = 0;
  for (; t <= duration; t += interval) {
    await seekTo(video, t);
    if (vehModel) {
      const dets = await detectVehicles(vehModel, video, 16);
      for (const d of dets) {
        if (d.cls === 'person') {
          if (opts.includePeople) samples.push({ kind: 'person', box: normBox(d.bbox as NormBox, W, H), t });
        } else {
          const pr = clampBox(plateRegion(d.bbox as NormBox), W, H);
          samples.push({ kind: 'plate', box: normBox(pr as NormBox, W, H), t });
        }
      }
    }
    if (faceModel) {
      const faces = await detectFaces(faceModel, video);
      for (const f of faces) samples.push({ kind: 'face', box: f, t });
    }
    opts.onProgress?.(Math.min(1, t / duration));
  }
  if (!wasPaused) video.play().catch(() => {});
  return mergeSamples(samples, { scanInterval: interval });
}
```

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes (confirm `detectVehicles`/`plateRegion`/`clampBox` signatures match; adjust the `as NormBox` casts if the existing `Box` type differs — both are `[number,number,number,number]`).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/redaction/scanClip.ts
git commit -m "feat(redaction): clip scan pass → keyframed regions"
```

---

## Task 8: Render + MP4 encode — `renderRedacted.ts`

**Files:**
- Create: `client/src/utils/redaction/renderRedacted.ts`
- Modify: `client/package.json` (add deps)

> No unit test — canvas/ffmpeg are browser-only. Verified on a live clip in Task 11.

- [ ] **Step 1: Add ffmpeg deps**

Run: `cd client && npm install @ffmpeg/ffmpeg@^0.12.10 @ffmpeg/util@^0.12.1 --no-audit --no-fund`
Expected: added to `client/package.json` dependencies + lockfile.

- [ ] **Step 2: Write the renderer**

```ts
// client/src/utils/redaction/renderRedacted.ts
// Produce a redacted MP4 entirely in-browser: seek each frame, draw it, blur the
// active regions, burn the evidence stamp, then feed the frame PNGs + original
// audio to the SINGLE-THREADED ffmpeg.wasm core (no SharedArrayBuffer / COOP-COEP
// needed). Slow but frame-accurate; clips are short (≤~40s).
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';

// Single-threaded core from a CDN (lazy — never in the app bundle).
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

export interface RenderOpts {
  fps?: number;                       // output frame rate (default 12)
  stamp?: string[];                   // burned-in evidence lines (top of frame)
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, (video.duration || t) - 0.001);
  });
}

function drawStamp(ctx: CanvasRenderingContext2D, lines: string[], W: number, H: number): void {
  if (!lines.length) return;
  const fs = Math.max(11, Math.round(H * 0.022));
  const stripH = fs * (lines.length + 0.6) + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, H - stripH, W, stripH);
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px sans-serif`;
    ctx.fillStyle = i === 0 ? '#d4a017' : '#e5e5e5';
    ctx.fillText(l, 10, H - stripH + 6 + i * fs * 1.18);
  });
}

export async function renderRedacted(
  video: HTMLVideoElement, regions: RedactionRegion[], opts: RenderOpts = {},
): Promise<Blob> {
  const fps = opts.fps ?? 12;
  const W = video.videoWidth, H = video.videoHeight;
  const duration = video.duration || 0;
  if (!W || !H || !duration) throw new Error('Clip not ready (no dimensions/duration).');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  const wasPaused = video.paused; video.pause();
  const total = Math.max(1, Math.floor(duration * fps));
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new Error('Redaction cancelled.');
    const t = i / fps;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, W, H);
    for (const r of activeRegionsAt(regions, t)) {
      applyRegionEffect(ctx, denormBox(interpBox(r, t), W, H), r.style, r.strength);
    }
    drawStamp(ctx, opts.stamp ?? [], W, H);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), 'image/png'));
    await ffmpeg.writeFile(`f${String(i).padStart(5, '0')}.png`, await fetchFile(blob));
    opts.onProgress?.(i / total, 'frames');
  }
  if (!wasPaused) video.play().catch(() => {});

  opts.onProgress?.(0, 'encode');
  // Encode frames → H.264 MP4. (Audio mux is Phase 2; original-audio extraction
  // needs the source bytes, which the on-demand stream doesn't expose to JS.)
  await ffmpeg.exec([
    '-framerate', String(fps), '-i', 'f%05d.png',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', 'out.mp4',
  ]);
  const data = await ffmpeg.readFile('out.mp4');
  opts.onProgress?.(1, 'encode');
  return new Blob([data as Uint8Array], { type: 'video/mp4' });
}
```

> **Spec deviation (note for reviewer):** original-audio muxing is downgraded to Phase 2 here — the redacted MP4 is video-only. Reason: the player streams the source on-demand and never exposes the raw bytes/audio to JS, so re-muxing the original audio would require a separate fetch of the source file. Flag in the PR; if audio is required for MVP, add a task to fetch the source via the existing `/stream` endpoint and `-i source.mp4 -map 1:a` in the ffmpeg call.

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/redaction/renderRedacted.ts client/package.json client/package-lock.json
git commit -m "feat(redaction): canvas redact + ffmpeg.wasm MP4 encode"
```

---

## Task 9: Redaction Studio UI — `RedactionStudio.tsx`

**Files:**
- Create: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/RedactionStudio.tsx
// Modal editor: scan a clip for plates/faces/people, let the operator toggle
// categories / draw-resize-delete boxes / pick style+strength, then render a
// redacted MP4 (canvas + ffmpeg.wasm), upload it to /api/redactions with a
// custody record, and download it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, ScanSearch, ShieldOff, Download, Square, Trash2 } from 'lucide-react';
import { apiPostForm, authedImageUrl } from '../hooks/useApi';
import { scanClip } from '../utils/redaction/scanClip';
import { renderRedacted } from '../utils/redaction/renderRedacted';
import { activeRegionsAt, interpBox, type RedactionRegion, type RedactionKind, type RedactionStyle } from '../utils/redaction/regions';

const KIND_COLOR: Record<RedactionKind, string> = { plate: '#22d3ee', face: '#f472b6', person: '#a3e635', manual: '#d4a017' };

export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [t, setT] = useState(0);
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [scan, setScan] = useState<{ busy: boolean; frac: number }>({ busy: false, frac: 0 });
  const [render, setRender] = useState<{ busy: boolean; frac: number; phase: string } | null>(null);
  const [style, setStyle] = useState<RedactionStyle>('blur');
  const [strength, setStrength] = useState(14);
  const [err, setErr] = useState<string | null>(null);

  const natW = nat?.w || 1280, natH = nat?.h || 720;

  const runScan = async () => {
    const v = videoRef.current; if (!v) return;
    setScan({ busy: true, frac: 0 }); setErr(null);
    try {
      const found = await scanClip(v, { intervalSec: 0.25, includePeople: false, onProgress: (f) => setScan({ busy: true, frac: f }) });
      setRegions(found.map((r) => ({ ...r, style, strength })));
    } catch (e: any) { setErr(e?.message || 'Scan failed'); }
    setScan({ busy: false, frac: 1 });
  };

  // Toggle every region of a kind on/off.
  const toggleKind = (kind: RedactionKind, on: boolean) =>
    setRegions((rs) => rs.map((r) => (r.kind === kind ? { ...r, enabled: on } : r)));

  const addManual = () => {
    const v = videoRef.current; if (!v) return;
    const at = v.currentTime;
    setRegions((rs) => [...rs, {
      id: `manual_${Date.now()}`, kind: 'manual', keyframes: [{ t: at, box: [0.4, 0.4, 0.2, 0.2] }],
      tStart: Math.max(0, at - 1), tEnd: at + 1, style, strength, source: 'manual', enabled: true,
    }]);
  };

  const removeRegion = (id: string) => setRegions((rs) => rs.filter((r) => r.id !== id));

  const exportRedacted = async () => {
    const v = videoRef.current; if (!v) return;
    setRender({ busy: true, frac: 0, phase: 'frames' }); setErr(null);
    try {
      const blob = await renderRedacted(v, regions, {
        fps: 12, stamp: stampLines,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      });
      // Upload custody copy.
      const kinds = Array.from(new Set(regions.filter((r) => r.enabled).map((r) => (r.kind === 'plate' ? 'license_plate' : r.kind))));
      const fd = new FormData();
      fd.append('video', blob, `redacted-${eventId}.mp4`);
      fd.append('metadata', JSON.stringify({ event_id: eventId, kinds, region_count: regions.filter((r) => r.enabled).length, style, regions: regions }));
      await apiPostForm('/redactions', fd).catch(() => {});
      // Download to the operator.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `redacted-${eventId}.mp4`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e: any) { setErr(e?.message || 'Export failed'); }
    setRender(null);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of regions) c[r.kind] = (c[r.kind] || 0) + 1;
    return c;
  }, [regions]);

  const visible = activeRegionsAt(regions, t);

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col tactical-dark" role="dialog" aria-label="Redaction studio">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#232323] shrink-0">
        <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-[#d4a017]">
          <ShieldOff className="w-4 h-4" /> REDACTION STUDIO — EVENT #{eventId}
        </span>
        <button onClick={onClose} className="text-rmpg-400 hover:text-white p-1" aria-label="Close redaction studio"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_300px] overflow-hidden">
        <div className="relative bg-black flex items-center justify-center overflow-hidden">
          <div className="relative inline-flex max-h-full max-w-full">
            <video ref={videoRef} src={authedImageUrl(streamUrl)} controls preload="auto" playsInline
              onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} className="block max-h-full max-w-full" />
            {nat && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                {visible.map((r) => {
                  const [x, y, w, h] = interpBox(r, t).map((v, i) => v * (i % 2 === 0 ? natW : natH));
                  return <rect key={r.id} x={x} y={y} width={w} height={h} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
            )}
          </div>
        </div>

        <div className="border-l border-[#232323] overflow-auto p-3 space-y-3 text-[11px] text-rmpg-200">
          <button onClick={runScan} disabled={scan.busy} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1400] disabled:opacity-60">
            {scan.busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning… {Math.round(scan.frac * 100)}%</> : <><ScanSearch className="w-3.5 h-3.5" /> Auto-detect plates + faces</>}
          </button>

          {(['plate', 'face', 'person', 'manual'] as RedactionKind[]).map((k) => counts[k] ? (
            <label key={k} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block" style={{ background: KIND_COLOR[k] }} /> Blur all {k}s <span className="text-rmpg-500">({counts[k]})</span></span>
              <input type="checkbox" defaultChecked onChange={(e) => toggleKind(k, e.target.checked)} />
            </label>
          ) : null)}

          <div className="border-t border-[#232323] pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span>Style</span>
              <select value={style} onChange={(e) => { const s = e.target.value as RedactionStyle; setStyle(s); setRegions((rs) => rs.map((r) => ({ ...r, style: s }))); }} className="bg-black border border-[#232323] px-1 py-0.5">
                <option value="blur">Blur</option><option value="pixelate">Pixelate</option><option value="box">Black box</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Strength</span>
              <input type="range" min={4} max={40} value={strength} onChange={(e) => { const v = Number(e.target.value); setStrength(v); setRegions((rs) => rs.map((r) => ({ ...r, strength: v }))); }} />
            </div>
            <button onClick={addManual} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-[#232323] hover:border-[#d4a017]"><Square className="w-3.5 h-3.5" /> Add manual box (at playhead)</button>
          </div>

          <div className="border-t border-[#232323] pt-2 max-h-40 overflow-auto space-y-1">
            {regions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: KIND_COLOR[r.kind] }}>{r.kind} · {r.tStart.toFixed(1)}–{r.tEnd.toFixed(1)}s</span>
                <button onClick={() => removeRegion(r.id)} aria-label="Delete region" className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {!regions.length && <div className="text-rmpg-500 italic">No regions yet — run auto-detect or add a box.</div>}
          </div>

          <button onClick={exportRedacted} disabled={!!render || !regions.length} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-green-700 text-green-300 bg-green-950/30 hover:bg-green-900/40 disabled:opacity-60">
            {render ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {render.phase === 'encode' ? 'Encoding MP4…' : `Rendering… ${Math.round(render.frac * 100)}%`}</> : <><Download className="w-3.5 h-3.5" /> Export redacted MP4</>}
          </button>
          {render && <div className="text-[9px] text-rmpg-500">Runs in your browser — keep this tab open. Short clips take a minute or two.</div>}
          {err && <div className="text-[10px] text-red-400">{err}</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes. (If `apiPostForm` import path differs, match `ForensicDashcamPlayer.tsx`'s import.)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(redaction): Redaction Studio editor modal"
```

---

## Task 10: Wire the REDACT button into the forensic player

**Files:**
- Modify: `client/src/components/ForensicDashcamPlayer.tsx`

- [ ] **Step 1: Import + state**

Near the other imports:
```tsx
import RedactionStudio from './RedactionStudio';
import { ShieldOff } from 'lucide-react';
```
Near the other `useState` declarations (after `dossier`):
```tsx
const [redactOpen, setRedactOpen] = useState(false);
```

- [ ] **Step 2: Add the toolbar button**

In the tactical toolbar (the `{media?.has_video && (<> … </>)}` block, next to the REPORT button), add:
```tsx
<button onClick={() => setRedactOpen(true)} title="Redact & export for disclosure"
  className="text-[10px] font-semibold px-1.5 py-1 border border-[#232323] text-rmpg-300 hover:border-[#d4a017] flex items-center gap-1" aria-label="Open redaction studio">
  <ShieldOff className="w-3.5 h-3.5" /> REDACT
</button>
```

- [ ] **Step 3: Render the modal**

Just before the final closing `</div>` of the component (next to `{dossier && <PlateDossier … />}`):
```tsx
{redactOpen && media?.stream_url && (
  <RedactionStudio
    eventId={eventId}
    streamUrl={media.stream_url}
    stampLines={evidenceStampLines(evidenceMeta())}
    onClose={() => setRedactOpen(false)}
  />
)}
```

- [ ] **Step 4: Client typecheck + tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: typecheck passes; all client tests pass (incl. the new regions/blur tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ForensicDashcamPlayer.tsx
git commit -m "feat(redaction): REDACT button opens the Redaction Studio"
```

---

## Task 11: Service-worker bump + full verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump the cache**

In `client/public/sw.js`, change the `CACHE_NAME` constant to the next free `rmpg-flex-v<N>` (check the current value first with `grep "const CACHE_NAME" client/public/sw.js` and increment; pick a number ahead of any open PR's value).

- [ ] **Step 2: Full client verification**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: typecheck clean; all tests pass; build succeeds.

- [ ] **Step 3: Worker verification**

Run: `npm run typecheck && npm test`
Expected: worker typecheck clean; node worker suite passes.

- [ ] **Step 4: Manual live check (after deploy)**

Open a driving event with a video clip in the forensic player → click **REDACT** → **Auto-detect** → confirm boxes appear on plates/faces → **Export redacted MP4** → confirm the downloaded MP4 has the regions blurred and the stamp burned in, and that `GET /api/redactions?event_id=<id>` shows the custody row. (Browser-only; not automatable here.)

- [ ] **Step 5: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(redaction): bump service worker cache"
```

---

## Self-Review notes

- **Spec coverage:** scan (T7) ✓, faces/BlazeFace (T6) ✓, regions brain (T4) ✓, blur styles (T5) ✓, ffmpeg MP4 (T8) ✓, UI + manual adjust (T9) ✓, player hook (T10) ✓, R2 + custody route + migration (T1–T2) ✓, worker smoke test reusing #1283 harness (T3) ✓, audit/custody record ✓ (custody via route; per-frame stamp via T8).
- **Known spec deviation:** original-audio mux downgraded to Phase 2 (documented in T8 — the on-demand stream doesn't expose source bytes to JS). MVP exports video-only redacted MP4.
- **Deferred per spec (not in plan):** audio bleep, smoothed tracking beyond keyframe interp, re-open saved redaction, batch jobs, WebCodecs path.
- **Cross-task type consistency:** `RedactionRegion` (keyframes/tStart/tEnd/style/strength/kind/source/enabled), `NormBox`, `DetectorSample` defined once in T4 and used unchanged in T5/T7/T8/T9; `pixelate(px,w,h,block)` and `applyRegionEffect(ctx,boxPx,style,strength)` consistent T5→T8; route field names (`event_id`,`kinds`,`region_count`,`style`,`regions`) consistent T2↔T9.
