# ALPR Fast-Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live field + mobile ALPR scan return plate + state + stolen/watchlist hit in ~1s, with make/model/color enriching automatically in the background.

**Architecture:** Split `POST /api/alpr/capture` into a fast synchronous path (a new lean plate-only Roboflow workflow → detect + crop + OCR → screen → return) and a background enrich path (`ctx.waitUntil` runs the existing heavy attribute workflow and fills the record). Clients downscale the JPEG before upload and re-fetch the capture once to show enriched attributes.

**Tech Stack:** Cloudflare Workers (Hono), Roboflow serverless workflows, D1, R2, React + Vite, vitest.

**Spec:** [docs/superpowers/specs/2026-06-14-alpr-fast-scan-design.md](../specs/2026-06-14-alpr-fast-scan-design.md)

---

## File structure

| File | Responsibility | Create/Modify |
|------|----------------|---------------|
| `src/utils/roboflowAlpr.ts` | Export 2 pure helpers (`cleanPlate`, `firstOcrString`) for reuse | Modify |
| `src/utils/roboflowPlateFast.ts` | Fast plate-only client + pure response parser | Create |
| `src/routes/alpr.ts` | Fast path + `ctx.waitUntil` enrich; `enrich_status`; extended `shapeCapture` | Modify |
| `migrations/0113_alpr_enrich_status.sql` | Add `alpr_captures.enrich_status` | Create |
| `tests/roboflowPlateFast.test.ts` | Unit tests for the fast parser | Create |
| `client/src/utils/downscaleImage.ts` | Downscale a Blob/File before upload (+ pure dims helper) | Create |
| `client/src/utils/__tests__/downscaleImage.test.ts` | Unit test the pure dims math | Create |
| `client/src/pages/mobile/FieldCameraPage.tsx` | Downscale ALPR upload; enrich re-fetch; "Identifying…" chip | Modify |
| `client/src/pages/PlateLogPage.tsx` | Downscale upload; enrich re-fetch | Modify |
| `client/public/sw.js` | Bump `CACHE_NAME` | Modify |

> **Migration prefix note:** the ClearPath Phase A spec also reserves `0113`. This plan ships first, so it takes `0113_alpr_enrich_status.sql`; ClearPath renumbers to `0114` when it lands. If at execution time a `0113_*` already exists, use the next free integer and keep the rest of the task identical.

---

## Task 1: Create the lean plate-only Roboflow workflow

**No code.** Create a new serverless workflow in workspace `rmpg-utah` and record its deployed id.

- [ ] **Step 1: Create the workflow**

Use the Roboflow MCP `workflows_create` (workspace `rmpg-utah`) with this spec (the user's "vehicle capture" workflow stripped to detection + crop + OCR — no Gemini, no visualization, no vision-events, no annotated image):

```json
{
  "version": "1.0",
  "inputs": [{ "type": "WorkflowImage", "name": "image" }],
  "steps": [
    { "type": "roboflow_core/roboflow_object_detection_model@v3", "name": "plate_detector",
      "images": "$inputs.image", "model_id": "license-plate-recognition-rxg4e/4",
      "confidence_mode": "custom", "custom_confidence": 0.35 },
    { "type": "roboflow_core/dynamic_crop@v1", "name": "plate_crop",
      "images": "$inputs.image", "predictions": "$steps.plate_detector.predictions" },
    { "type": "roboflow_core/glm_ocr@v1", "name": "plate_ocr",
      "images": "$steps.plate_crop.crops", "task_type": "custom",
      "prompt": "Read the license plate number from this cropped plate image. Return only the plate number text with no punctuation or explanation.",
      "model_version": "glm-ocr" }
  ],
  "outputs": [
    { "type": "JsonField", "name": "license_plate_text", "selector": "$steps.plate_ocr.parsed_output" },
    { "type": "JsonField", "name": "plate_predictions", "selector": "$steps.plate_detector.predictions" }
  ]
}
```

- [ ] **Step 2: Record the id**

Note the returned workflow id (e.g. `rmpg-flex-plate-fast-<digits>`). It becomes `ROBOFLOW_FAST_WORKFLOW_ID` in Task 2. If creation isn't possible at execution time, set the constant to a placeholder and configure `ROBOFLOW_FAST_WORKFLOW_ID` as a Worker var later — the code (Task 4) reads `c.env.ROBOFLOW_FAST_WORKFLOW_ID` first, falling back to the constant.

---

## Task 2: Fast plate-only client (`roboflowPlateFast.ts`)

**Files:**
- Modify: `src/utils/roboflowAlpr.ts` (export 2 helpers)
- Create: `src/utils/roboflowPlateFast.ts`
- Test: `tests/roboflowPlateFast.test.ts`

- [ ] **Step 1: Export the two pure helpers from `roboflowAlpr.ts`**

`cleanPlate` and `firstOcrString` are currently module-private. Add `export` to each (find `function cleanPlate(` ~line 371 and `function firstOcrString(` ~line 545):

```ts
export function cleanPlate(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, '').trim();
}
```
```ts
export function firstOcrString(v: unknown): string | null {
  if (typeof v === 'string') return asStr(v);
  if (Array.isArray(v)) { for (const el of v) { const s = firstOcrString(el); if (s) return s; } }
  return null;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/roboflowPlateFast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFastPlate, fastRunUrl, ROBOFLOW_FAST_WORKFLOW_ID } from '../src/utils/roboflowPlateFast';

describe('parseFastPlate', () => {
  it('extracts a plate from a nested OCR output and cleans it', () => {
    const json = { outputs: [{ license_plate_text: [['8A T 6511']], plate_predictions: { predictions: [
      { x: 1, y: 2, width: 3, height: 4, confidence: 0.9, class: 'plate' },
    ] } }] };
    const r = parseFastPlate(json);
    expect(r.plate).toBe('8AT6511');
    expect(r.predictions.length).toBe(1);
    expect(r.predictions[0].confidence).toBe(0.9);
  });

  it('returns null plate when OCR is empty', () => {
    expect(parseFastPlate({ outputs: [{ license_plate_text: '', plate_predictions: {} }] }).plate).toBeNull();
  });

  it('tolerates a bare-array (SDK-unwrapped) envelope', () => {
    expect(parseFastPlate([{ license_plate_text: 'ABC123' }]).plate).toBe('ABC123');
  });

  it('builds the run url for the fast workflow', () => {
    expect(fastRunUrl()).toContain(`/rmpg-utah/workflows/${ROBOFLOW_FAST_WORKFLOW_ID}`);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run tests/roboflowPlateFast.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/roboflowPlateFast'`.

- [ ] **Step 4: Implement `roboflowPlateFast.ts`**

Create `src/utils/roboflowPlateFast.ts`:

```ts
// ============================================================
// RMPG Flex — Fast plate-only Roboflow client
// ============================================================
// A lean sibling of roboflowAlpr.ts for the FAST scan path: a workflow
// that only detects the plate, crops it, and OCRs it (no Gemini vehicle
// attributes, no visualization, no vision-events). Returns the plate text
// + detections in ~1s so the officer isn't blocked. Vehicle attributes are
// enriched afterward by the heavy workflow (see src/routes/alpr.ts).
// ============================================================

import {
  buildAlprRequest, unwrapOutputs, asDetections, cleanPlate, firstOcrString,
  ROBOFLOW_SERVERLESS_BASE, ROBOFLOW_WORKSPACE,
  RoboflowError, RoboflowConfigError, RoboflowTimeoutError, RoboflowHttpError,
  type RoboflowImageInput, type AlprDetection,
} from './roboflowAlpr';

// Deployed id of the lean plate-only workflow (Task 1). Override at runtime
// with the ROBOFLOW_FAST_WORKFLOW_ID Worker var.
export const ROBOFLOW_FAST_WORKFLOW_ID = 'rmpg-flex-plate-fast';

const FAST_TIMEOUT_MS = 12_000;   // fail fast — never hang the shutter
const FAST_RETRIES = 1;

export interface FastPlateResult {
  plate: string | null;
  state: string | null;     // best-effort; usually filled by enrichment
  predictions: AlprDetection[];
}

export interface RunFastOptions {
  image: RoboflowImageInput;
  apiKey: string;
  apiUrl?: string;
  workflowId?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function fastRunUrl(opts?: { apiUrl?: string; workflowId?: string }): string {
  const base = (opts?.apiUrl || ROBOFLOW_SERVERLESS_BASE).replace(/\/+$/, '');
  const wf = opts?.workflowId || ROBOFLOW_FAST_WORKFLOW_ID;
  return `${base}/${ROBOFLOW_WORKSPACE}/workflows/${wf}`;
}

/** Pure: pull the plate text + detections out of the fast workflow response. */
export function parseFastPlate(json: unknown): FastPlateResult {
  const entry = unwrapOutputs(json)[0] ?? {};
  const plateRaw = firstOcrString((entry as Record<string, unknown>).license_plate_text);
  const predictions: AlprDetection[] = [];
  for (const [name, value] of Object.entries(entry as Record<string, unknown>)) {
    const dets = asDetections(name, value);
    if (dets.length) predictions.push(...dets);
  }
  return { plate: plateRaw ? cleanPlate(plateRaw) : null, state: null, predictions };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retriable = (s: number) => s === 429 || (s >= 500 && s <= 599);

/** Run the lean plate-only workflow against a single image. Typed errors. */
export async function runPlateFast(opts: RunFastOptions): Promise<FastPlateResult> {
  // Reuse the validated request builder; point it at the fast workflow.
  const { body } = buildAlprRequest({
    image: opts.image, apiKey: opts.apiKey, apiUrl: opts.apiUrl,
    workflowId: opts.workflowId || ROBOFLOW_FAST_WORKFLOW_ID,
  });
  const url = fastRunUrl(opts);
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || realSleep;
  const timeoutMs = opts.timeoutMs ?? FAST_TIMEOUT_MS;
  const maxAttempts = (opts.retries ?? FAST_RETRIES) + 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        if (retriable(res.status) && attempt < maxAttempts - 1) {
          lastErr = new RoboflowHttpError(`Roboflow HTTP ${res.status}`, res.status, detail.slice(0, 300));
          continue;
        }
        throw new RoboflowHttpError(`Fast plate run failed (HTTP ${res.status})`, res.status, detail.slice(0, 300));
      }
      return parseFastPlate(await res.json());
    } catch (err) {
      if (err instanceof RoboflowHttpError && !retriable(err.status ?? 0)) throw err;
      if (err instanceof RoboflowConfigError) throw err;
      const aborted = (err as { name?: string })?.name === 'AbortError';
      lastErr = aborted ? new RoboflowTimeoutError(`Fast plate run timed out after ${timeoutMs}ms`) : err;
      if (attempt >= maxAttempts - 1) break;
    } finally { clearTimeout(timer); }
  }
  if (lastErr instanceof RoboflowError) throw lastErr;
  throw new RoboflowError('Fast plate run failed', { detail: lastErr });
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run tests/roboflowPlateFast.test.ts`
Expected: PASS (4 tests). Also run `npx vitest run tests/roboflowAlpr.test.ts` — still green after the exports.

- [ ] **Step 6: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/roboflowAlpr.ts src/utils/roboflowPlateFast.ts tests/roboflowPlateFast.test.ts
git commit -m "feat(alpr): lean plate-only fast client (detect+crop+OCR)"
```

---

## Task 3: Migration — `alpr_captures.enrich_status`

**Files:**
- Create: `migrations/0113_alpr_enrich_status.sql`
- Modify: `src/routes/alpr.ts` (add to `ALPR_EXTRA_COLUMNS`, ~line 73)

- [ ] **Step 1: Write the migration**

Create `migrations/0113_alpr_enrich_status.sql`:

```sql
-- Fast-scan: plate returns immediately; vehicle attributes enrich in the
-- background. enrich_status tracks that lifecycle: pending|done|failed.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-apply failure is acceptable
-- (the route reconciles this column at boot via ensureAlprSchema).
ALTER TABLE alpr_captures ADD COLUMN enrich_status TEXT;
```

- [ ] **Step 2: Add the column to the runtime reconciler**

In `src/routes/alpr.ts`, extend `ALPR_EXTRA_COLUMNS` (~line 73):

```ts
const ALPR_EXTRA_COLUMNS: Array<[string, string]> = [
  ['call_id', 'INTEGER'], ['incident_id', 'INTEGER'], ['field_photo_id', 'INTEGER'],
  ['vehicle_count', 'INTEGER'], ['vehicle_record_ids', 'TEXT'],
  ['enrich_status', 'TEXT'],
];
```

- [ ] **Step 3: Apply locally + verify**

Run: `npm run migrate:local`
Then verify the column exists locally:
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('alpr_captures') WHERE name='enrich_status'"`
Expected: one row `enrich_status`.

> Live apply happens in Task 9 / rollout — deploy's migration step is `continue-on-error`, so `0113` must also be applied directly to live `785de7ae` and confirmed with `pragma_table_info`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0113_alpr_enrich_status.sql src/routes/alpr.ts
git commit -m "feat(alpr): enrich_status column + boot reconcile"
```

---

## Task 4: Refactor `/api/alpr/capture` into fast + background enrich

**Files:**
- Modify: `src/routes/alpr.ts`

This is the core change. No route test harness exists (repo gap); verify via `npm run typecheck` + the manual browser check in Task 9. Show the full code.

- [ ] **Step 1: Import the fast client + add an enrich helper**

At the top of `src/routes/alpr.ts`, add the import:

```ts
import { runPlateFast } from '../utils/roboflowPlateFast';
```

Then add this standalone enrich function near the other helpers (above the route handlers). It re-reads the stored image from R2, runs the heavy attribute workflow, fills the records created in the fast path, and flips `enrich_status`. It is fully isolated — any failure marks `failed`, never throws into `waitUntil`:

```ts
/** Background enrichment: run the full attribute workflow on the stored image.
 *  The PRIMARY plate was already record/linked/sighted/screened/notified in the
 *  fast path — here we only fill its attributes. SECONDARY vehicles (additional
 *  plates the heavy workflow finds) get the FULL treatment so a multi-vehicle
 *  frame is never under-screened (a stolen second plate must still alert). Best
 *  effort — sets enrich_status to 'done' or 'failed', never throws. */
async function enrichCapture(
  env: Env['Bindings'],
  args: {
    captureRowId: number; imageKey: string; params: AlprParameters;
    primaryPlate: string | null; callId: number | null; incidentId: number | null;
    lat: number | null; lng: number | null; locationText: string | null; userId: number;
  },
): Promise<void> {
  const db = getDb(env);
  try {
    const obj = await env.UPLOADS.get(args.imageKey);
    if (!obj) throw new Error(`enrich: image ${args.imageKey} missing from R2`);
    const bytes = new Uint8Array(await obj.arrayBuffer());

    const result = await runAlprVehicleCapture({
      apiKey: env.ROBOFLOW_API_KEY!,
      apiUrl: env.ROBOFLOW_API_URL,
      image: { type: 'base64', value: bytesToBase64(bytes) },
      parameters: args.params,
    });

    for (const v of result.vehicles) {
      if (!v.plate || v.plate.length < 2) continue;
      const screen = await screenVehicle(db, { plate: v.plate });
      const up = await upsertVehicleRecord(db, v, screen.vehicleId);  // enriches blank fields
      const recordId = up?.id ?? screen.vehicleId ?? null;

      // Primary plate already fully handled in the fast path — attributes only.
      if (args.primaryPlate && v.plate === args.primaryPlate) continue;

      // Secondary vehicle: full link + sighting + screening + notify.
      if (recordId && args.callId != null) {
        try {
          await execute(db,
            `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
             VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, args.callId, recordId, args.userId);
        } catch (err: any) { console.error('[alpr] enrich link failed:', err?.message); }
      }
      try {
        const note = `ALPR: ${[v.color, v.make, v.model, v.year].filter(Boolean).join(' ')}`.trim();
        await execute(db,
          `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          v.plate, v.state, recordId, args.locationText, args.lat, args.lng,
          note === 'ALPR:' ? 'ALPR capture' : note, args.userId);
      } catch (err: any) { console.error('[alpr] enrich sighting failed:', err?.message); }
      const critical = screen.hits.filter((h) => h.severity === 'critical');
      if (critical.length) {
        try {
          await execute(db,
            `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
             VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
            `PLATE HIT: ${v.plate}`, critical.map((h) => h.detail).join('; '), recordId, args.userId);
        } catch (err: any) { console.error('[alpr] enrich notify failed:', err?.message); }
      }
    }

    // Persist any annotated image (first image output).
    let annotatedKey: string | null = null;
    const annotated: AlprImageOutput | undefined = result.images[0];
    if (annotated) {
      annotatedKey = `${ALPR_PREFIX}${crypto.randomUUID()}-annot.${annotated.ext}`;
      await env.UPLOADS.put(annotatedKey, Uint8Array.from(atob(annotated.base64), (ch) => ch.charCodeAt(0)),
        { httpMetadata: { contentType: annotated.mimeType } });
    }

    const cap = result.capture;
    const rawJson = JSON.stringify({
      capture: cap, vehicles: result.vehicles, detections: result.detections,
      vehicle_details: result.records.vehicle_details ?? null,
      enhanced_alpr_record: result.records.enhanced_alpr_record ?? null,
    });
    await execute(db,
      `UPDATE alpr_captures SET make=COALESCE(NULLIF(make,''),?), model=COALESCE(NULLIF(model,''),?),
         color=COALESCE(NULLIF(color,''),?), year=COALESCE(year,?), state=COALESCE(NULLIF(state,''),?),
         vehicle_type=COALESCE(NULLIF(vehicle_type,''),?), risk_score=COALESCE(risk_score,?),
         review_status=COALESCE(NULLIF(review_status,''),?), raw_json=?,
         annotated_image_key=COALESCE(annotated_image_key,?), vehicle_count=?, enrich_status='done'
       WHERE id=?`,
      cap.make, cap.model, cap.color, cap.year, cap.state, cap.vehicleType, cap.riskScore,
      cap.reviewStatus, rawJson, annotatedKey, result.vehicles.length, args.captureRowId);
  } catch (err: any) {
    console.error('[alpr] enrich failed:', err?.message);
    try { await execute(db, `UPDATE alpr_captures SET enrich_status='failed' WHERE id=?`, args.captureRowId); }
    catch { /* swallow — background path */ }
  }
}
```

- [ ] **Step 2: Replace the `POST /capture` handler body (fast path)**

Replace everything from `// Run the workflow (typed errors → clean HTTP codes).` through the final `return c.json({ ... })` of `alpr.post('/capture', …)` (currently ~lines 232–348) with the fast path below. It keeps image storage, field-photo attachment, screening, per-plate record/link/sighting/notify, then returns immediately and schedules enrichment:

```ts
  // ── FAST PATH: plate-only read (~1s) ──
  let fast;
  try {
    fast = await runPlateFast({
      apiKey: c.env.ROBOFLOW_API_KEY,
      apiUrl: c.env.ROBOFLOW_API_URL,
      workflowId: c.env.ROBOFLOW_FAST_WORKFLOW_ID,
      image: { type: 'base64', value: bytesToBase64(bytes) },
    });
  } catch (err) {
    if (err instanceof RoboflowConfigError) return c.json({ error: err.message }, 400);
    if (err instanceof RoboflowTimeoutError) return c.json({ error: err.message }, 504);
    if (err instanceof RoboflowHttpError) return c.json({ error: err.message, status: err.status }, 502);
    return c.json({ error: 'ALPR fast scan failed', detail: (err as Error)?.message }, 502);
  }

  // Screen + create/link the plate record now (safety-critical stays in the fast path).
  const vehicleResults: Array<Record<string, unknown>> = [];
  const allHits: Array<{ kind: string; severity: string; detail: string }> = [];
  const vehicleRecordIds: number[] = [];
  let firstSightingId: number | null = null;

  if (fast.plate) {
    const v: AlprVehicle = { plate: fast.plate, state: fast.state, make: null, model: null,
      color: null, year: null, vehicleType: null, plateType: null, confidence: null };
    const screen = await screenVehicle(db, { plate: v.plate });
    const up = await upsertVehicleRecord(db, v, screen.vehicleId);
    const recordId = up?.id ?? screen.vehicleId ?? null;
    if (recordId) vehicleRecordIds.push(recordId);

    if (recordId && callId != null) {
      try {
        await execute(db,
          `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
           VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, callId, recordId, userId);
      } catch (err: any) { console.error('[alpr] call_vehicles link failed:', err?.message); }
    }

    try {
      const sr = await execute(db,
        `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by)
         VALUES (?, ?, ?, ?, ?, ?, 'ALPR capture', ?)`,
        v.plate, v.state, recordId, locationText, lat, lng, userId);
      firstSightingId = Number(sr.meta.last_row_id);
    } catch (err: any) { console.error('[alpr] sighting insert failed:', err?.message); }

    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      try {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
          `PLATE HIT: ${v.plate}`, critical.map((h) => h.detail).join('; '), recordId, userId);
      } catch (err: any) { console.error('[alpr] notify failed:', err?.message); }
    }

    allHits.push(...screen.hits);
    vehicleResults.push({ plate: v.plate, state: v.state, make: null, model: null, year: null,
      color: null, vehicle_type: null, confidence: null, vehicle_record_id: recordId,
      vehicle_record_created: up?.created ?? false, sighting_id: firstSightingId, hits: screen.hits });
  }

  // Capture row with enrich_status='pending'.
  const ins = await execute(db,
    `INSERT INTO alpr_captures
       (sighting_id, capture_id, case_id, plate, state, make, model, color, year, vehicle_type,
        confidence, risk_score, review_status, alerted, image_key, annotated_image_key,
        output_keys, raw_json, lat, lng, location_text, captured_by,
        call_id, incident_id, field_photo_id, vehicle_count, vehicle_record_ids, enrich_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    firstSightingId, captureId, strOrNull(params.case_id), fast.plate, fast.state, null, null, null,
    null, null, null, null, null, allHits.some((h) => h.severity === 'critical') ? 1 : 0, imageKey, null,
    JSON.stringify([]), JSON.stringify({ fast: true, plate: fast.plate, detections: fast.predictions }),
    lat, lng, locationText, userId,
    callId, incidentId, fieldPhotoId, fast.plate ? 1 : 0, JSON.stringify(vehicleRecordIds));
  const captureRowId = Number(ins.meta.last_row_id);

  // Schedule background enrichment (full attribute workflow) — never blocks the response.
  // Pass the primary plate so enrich only fills its attributes (already screened),
  // and the context so SECONDARY vehicles get full link/sighting/screen/notify.
  c.executionCtx.waitUntil(enrichCapture(c.env, {
    captureRowId, imageKey, params, primaryPlate: fast.plate,
    callId, incidentId, lat, lng, locationText, userId,
  }));

  const hits = Array.from(new Map(allHits.map((h) => [h.detail, h])).values());
  return c.json({
    success: true,
    id: captureRowId,
    call_id: callId,
    incident_id: incidentId,
    field_photo_id: fieldPhotoId,
    vehicle_count: fast.plate ? 1 : 0,
    vehicles: vehicleResults,
    capture: { plate: fast.plate, state: fast.state, make: null, model: null, color: null,
      year: null, vehicleType: null, confidence: null, riskScore: null, reviewStatus: null, alerted: false },
    detections: fast.predictions,
    enrich_status: 'pending',
    hits,
    image_url: imageUrlFor(imageKey),
    annotated_image_url: null,
  });
```

> Note: the old single-flow imports (`runAlprVehicleCapture`, `RoboflowConfigError`, etc.) are still used by `enrichCapture`, so keep them. `AlprImageOutput` and `AlprVehicle` are already imported.

- [ ] **Step 3: Extend `shapeCapture` so the enrich re-fetch can read attributes + status**

In `shapeCapture` (~line 408), add `enrich_status` and a normalized `capture` + `vehicles` view so both clients can refresh from `GET /capture/:id`:

```ts
  return {
    ...row,
    alerted: row.alerted === 1 || row.alerted === true,
    enrich_status: row.enrich_status ?? null,
    raw,
    output_keys: outputKeys,
    vehicle_record_ids: recordIds,
    capture: {
      plate: row.plate ?? null, state: row.state ?? null, make: row.make ?? null,
      model: row.model ?? null, color: row.color ?? null, year: row.year ?? null,
      vehicleType: row.vehicle_type ?? null, confidence: row.confidence ?? null,
      riskScore: row.risk_score ?? null, reviewStatus: row.review_status ?? null,
      alerted: row.alerted === 1 || row.alerted === true,
    },
    vehicles: Array.isArray(raw?.vehicles)
      ? raw.vehicles.map((v: any) => ({
          plate: v.plate ?? null, state: v.state ?? null, make: v.make ?? null, model: v.model ?? null,
          color: v.color ?? null, year: v.year ?? null, vehicle_type: v.vehicleType ?? v.vehicle_type ?? null,
          confidence: v.confidence ?? null,
        }))
      : [],
    image_url: imageUrlFor(row.image_key),
    annotated_image_url: imageUrlFor(row.annotated_image_key),
  };
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `c.executionCtx` types complain, confirm the handler is `async (c) =>` on the `Hono<Env>` app — `executionCtx` is provided by the Workers adapter.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "feat(alpr): fast plate path + ctx.waitUntil background enrichment"
```

---

## Task 5: Client downscale utility

**Files:**
- Create: `client/src/utils/downscaleImage.ts`
- Test: `client/src/utils/__tests__/downscaleImage.test.ts`

Canvas APIs aren't reliable in jsdom (known repo constraint), so the pure dims math is unit-tested and the canvas wrapper is defensive (returns the original on any failure).

- [ ] **Step 1: Write the failing test (pure dims math)**

Create `client/src/utils/__tests__/downscaleImage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { downscaleDims } from '../downscaleImage';

describe('downscaleDims', () => {
  it('caps the long edge at maxDim and keeps aspect ratio', () => {
    expect(downscaleDims(4000, 3000, 1280)).toEqual({ w: 1280, h: 960, scaled: true });
  });
  it('handles portrait', () => {
    expect(downscaleDims(3000, 4000, 1280)).toEqual({ w: 960, h: 1280, scaled: true });
  });
  it('never upscales', () => {
    expect(downscaleDims(800, 600, 1280)).toEqual({ w: 800, h: 600, scaled: false });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/downscaleImage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `downscaleImage.ts`**

Create `client/src/utils/downscaleImage.ts`:

```ts
// Downscale a Blob/File before upload so ALPR scans go faster (smaller upload
// + smaller image for the model). Plates are legible far below sensor res, so
// there's no accuracy cost. Any failure returns the original blob unchanged —
// downscaling must never block a scan.

export function downscaleDims(w: number, h: number, maxDim: number): { w: number; h: number; scaled: boolean } {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  if (scale >= 1) return { w, h, scaled: false };
  return { w: Math.round(w * scale), h: Math.round(h * scale), scaled: true };
}

export async function downscaleImage(input: Blob, maxDim = 1280, quality = 0.8): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return input;
    const bmp = await createImageBitmap(input);
    const { w, h, scaled } = downscaleDims(bmp.width, bmp.height, maxDim);
    if (!scaled) { bmp.close?.(); return input; }
    const canvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = (canvas as any).getContext('2d');
    if (!ctx) { bmp.close?.(); return input; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    if ('convertToBlob' in canvas) return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
    return await new Promise<Blob>((res, rej) =>
      (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', quality));
  } catch {
    return input;
  }
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/downscaleImage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/downscaleImage.ts client/src/utils/__tests__/downscaleImage.test.ts
git commit -m "feat(alpr): client downscaleImage util for faster scans"
```

---

## Task 6: FieldCameraPage — downscale + enrich re-fetch

**Files:**
- Modify: `client/src/pages/mobile/FieldCameraPage.tsx`

- [ ] **Step 1: Import + extend the result type**

Add to the imports (line 23 area):

```ts
import { apiPostForm, apiFetch, authedImageUrl } from '../../hooks/useApi';
import { downscaleImage } from '../../utils/downscaleImage';
```

Extend `AlprScanResult` (lines 35-39) with the new fields:

```ts
interface AlprScanResult {
  success: boolean; id: number; call_id: number | null; field_photo_id: number | null;
  vehicle_count: number; vehicles: ScanVehicle[]; hits: ScanHit[];
  enrich_status?: 'pending' | 'done' | 'failed';
  image_url: string | null; annotated_image_url: string | null;
}
```

- [ ] **Step 2: Downscale the ALPR upload + kick off enrich re-fetch**

In `upload()` (lines 252-264), replace the `if (alprMode) { … }` block with:

```ts
      if (alprMode) {
        // Downscale for a fast plate read; the full-res stamped blob still goes
        // to the call's photo gallery via the field_photos row the server makes.
        const alprBlob = await downscaleImage(blob, 1280, 0.8);
        const alprForm = new FormData();
        alprForm.append('photo', alprBlob, 'field-photo.jpg');
        if (gps) { alprForm.append('lat', String(gps.lat)); alprForm.append('lng', String(gps.lng)); }
        if (callId) alprForm.append('call_id', callId);
        if (incidentId) alprForm.append('incident_id', incidentId);
        alprForm.append('capture_reason', 'on_scene_alpr');
        const r = await apiPostForm<AlprScanResult>('/alpr/capture', alprForm);
        setScan(r);
        addToast(
          r.vehicle_count
            ? `ALPR: plate read — identifying vehicle…`
            : 'ALPR: no readable plate — photo saved to call',
          r.hits.some((h) => h.severity === 'critical') ? 'error' : 'success',
        );
        if (r.enrich_status === 'pending') void pollEnrichment(r.id);
      } else {
```

- [ ] **Step 3: Add the bounded enrich poller (define it BEFORE `upload`)**

`upload` calls `pollEnrichment`, so define this `useCallback` **above** the `upload` callback (e.g. right after `discard`, before line 240) and add `pollEnrichment` to `upload`'s dependency array (change `…, incidentId]` to `…, incidentId, pollEnrichment]`):

```ts
  // Background enrichment lands a moment after the fast plate read — re-fetch the
  // capture up to twice to fill make/model/color. Bounded; never loops forever.
  const pollEnrichment = useCallback(async (id: number) => {
    for (let i = 0; i < 2; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      try {
        const cap = await apiFetch<{ enrich_status?: string; vehicles?: ScanVehicle[] }>(`/alpr/capture/${id}`);
        if (cap.vehicles?.length) {
          setScan((prev) => (prev && prev.id === id
            ? { ...prev, vehicles: cap.vehicles!.map((v) => ({ ...v, vehicle_record_id: null, vehicle_record_created: false, hits: [] })), enrich_status: 'done' }
            : prev));
        }
        if (cap.enrich_status === 'done' || cap.enrich_status === 'failed') return;
      } catch { /* transient — try once more */ }
    }
  }, []);
```

- [ ] **Step 4: Show an "Identifying…" chip while pending**

In the scan overlay header (near line 327-329, inside the `{scan && (…)}` block), add after the vehicle-count span:

```tsx
                {scan.enrich_status === 'pending' && (
                  <span className="text-[10px] text-[#888] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Identifying vehicle…
                  </span>
                )}
```

- [ ] **Step 5: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/mobile/FieldCameraPage.tsx
git commit -m "feat(alpr): field camera fast scan + background enrich re-fetch"
```

---

## Task 7: PlateLogPage — downscale + enrich re-fetch

**Files:**
- Modify: `client/src/pages/PlateLogPage.tsx`

- [ ] **Step 1: Import downscale + extend type**

Add to imports (line 10):

```ts
import { apiFetch, apiPostForm, authedImageUrl } from '../hooks/useApi';
import { downscaleImage } from '../utils/downscaleImage';
```

Add `enrich_status` to `AlprResult` (lines 25-30):

```ts
interface AlprResult {
  id: number; sighting_id: number | null; capture: AlprCapture;
  detections: Array<{ class?: string; confidence?: number }>;
  output_keys: string[]; hits: ScreenHit[]; vehicle: Vehicle | null;
  enrich_status?: 'pending' | 'done' | 'failed';
  image_url: string; annotated_image_url: string | null;
}
```

- [ ] **Step 2: Downscale before upload + re-fetch enrichment**

In `onScanFile` (lines 104-114), replace from `const fd = new FormData();` through `loadRecent();` with:

```ts
      const small = await downscaleImage(file, 1280, 0.8);
      const fd = new FormData();
      fd.append('image', small, 'plate.jpg');
      fd.append('capture_reason', 'patrol_alpr');
      if (location.trim()) fd.append('location_label', location.trim());
      if (notes.trim()) fd.append('capture_notes', notes.trim());
      if (coords) { fd.append('gps_latitude', String(coords.lat)); fd.append('gps_longitude', String(coords.lng)); }
      const r = await apiPostForm<AlprResult>('/alpr/capture', fd);
      setScan(r); setResult(null);
      if (r.capture.plate) setPlate(r.capture.plate);
      loadRecent();
      if (r.enrich_status === 'pending') {
        for (let i = 0; i < 2; i++) {
          await new Promise((res) => setTimeout(res, 2500));
          try {
            const cap = await apiFetch<{ enrich_status?: string; capture?: AlprCapture }>(`/alpr/capture/${r.id}`);
            if (cap.capture) setScan((prev) => (prev && prev.id === r.id ? { ...prev, capture: cap.capture!, enrich_status: 'done' } : prev));
            if (cap.enrich_status === 'done' || cap.enrich_status === 'failed') break;
          } catch { /* transient */ }
        }
      }
```

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/PlateLogPage.tsx
git commit -m "feat(alpr): plate-log fast scan + background enrich re-fetch"
```

---

## Task 8: Bump the service-worker cache

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`**

Find the `CACHE_NAME` constant and increment its version number (e.g. `rmpg-flex-vNNN` → `vNNN+1`). Run first to see the current value:
Run: `rg -n "CACHE_NAME\s*=" client/public/sw.js`
Then edit that line to the next version.

- [ ] **Step 2: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for ALPR fast-scan client changes"
```

---

## Task 9: Verify everything + open PR

- [ ] **Step 1: Full gate run**

```bash
npm run typecheck            # worker
npx vitest run               # worker tests (incl. roboflowPlateFast)
cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..
```
Expected: all green. (`unpdf` is installed, so the warrant suites pass too.)

- [ ] **Step 2: Apply migration 0113 to live D1**

Apply `migrations/0113_alpr_enrich_status.sql` directly to live `rmpg-flex` `785de7ae-…` (deploy's migration step is `continue-on-error`). Then confirm:
`SELECT name FROM pragma_table_info('alpr_captures') WHERE name='enrich_status'` → one row.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin claude/exciting-elion-a4c43a
gh pr create --title "ALPR fast-scan: plate-first, enrich-after" \
  --body "Splits /api/alpr/capture into a fast plate-only path (~1s plate + hit screening) and a ctx.waitUntil background enrichment that fills make/model/color. Clients downscale before upload and re-fetch the capture once. New lean Roboflow workflow for the fast path. Migration 0113 (enrich_status) — apply to live 785de7ae. SW bumped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Manual browser verification (WAF blocks curl)**

Open the mobile field camera, turn on "Scan vehicles", capture a plate:
- Plate + any STOLEN/watchlist banner appears in ~1s.
- "Identifying vehicle…" chip shows, then make/model/color fills in within a few seconds.
- In live D1, the `alpr_captures` row transitions `enrich_status` `pending` → `done`.

---

## Notes for the implementer

- **DRY:** the fast client reuses `buildAlprRequest`/`unwrapOutputs`/`asDetections`/`cleanPlate`/`firstOcrString` from `roboflowAlpr.ts` — don't re-implement parsing.
- **Cost:** two Roboflow runs per scan (cheap fast + heavy enrich). Accepted for v1; a follow-up can switch enrichment to the leaner "vehicle capture" workflow.
- **No double-notify:** hit notifications fire only in the fast path; `enrichCapture` never re-screens or re-notifies.
- **Safety:** `enrichCapture` is fully wrapped — a failed enrichment marks `enrich_status='failed'` and can never crash the request or the Worker.
