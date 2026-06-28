# Footage ALPR — scan the full drive for plates (W4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Automatically plate-scan captured full-drive footage into the intel plate-log, **server-side and credit-free**, by ALPR'ing each segment's still (ClearPath thumbnail) with the **free Workers AI reader** — instead of the credit-blocked Roboflow path that no-ops on video.

**Architecture:** A pure mapper turns the Workers-AI `CloudflarePlateResult` into the `AlprVehicle` shape that `footageAlpr.ts`'s existing `persistVehicle` (screen → upsert → sighting → hit) already consumes. A new `alprFootageStillCloudflare()` runs the free reader on still bytes and persists. The chunk download path exposes the segment `thumbnailUrl` and feeds the still to that function. Video chunks keep no-opping (no credit burn); the high-coverage client ffmpeg.wasm keyframe tier is a later increment.

**Tech Stack:** Workers/D1/R2, Workers AI (`readPlateCloudflare`, free), vitest (pure mapper). On the same branch/PR #1349.

---

## File Structure
- `src/utils/footage/footageAlpr.ts` — **modify**: add `cloudflarePlateToVehicle` (pure, exported) + `alprFootageStillCloudflare()`.
- `src/utils/footage/types.ts` — **modify**: add `thumbnailUrl?` to `FootageChunkStatus`.
- `src/utils/footage/clearpathSource.ts` — **modify**: populate `thumbnailUrl` in `classifyChunkStatus`.
- `src/utils/footage/captureOrchestrator.ts` — **modify**: in `pollAndDownload`, fetch the thumbnail still and run the free still-ALPR.
- `tests/footageAlprMap.test.ts` — **new**.

---

### Task 1: Pure mapper `cloudflarePlateToVehicle` (TDD)

**Files:** Modify `src/utils/footage/footageAlpr.ts`; Test `tests/footageAlprMap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/footageAlprMap.test.ts
import { describe, it, expect } from 'vitest';
import { cloudflarePlateToVehicle } from '../src/utils/footage/footageAlpr';
import type { CloudflarePlateResult } from '../src/utils/cloudflarePlate';

const base: CloudflarePlateResult = {
  plate: 'ABC123', state: 'UT', make: 'Toyota', model: 'Camry', color: 'white', year: 2019,
  plateType: 'passenger', bodyStyle: 'sedan', condition: 'clean', damageSummary: null,
  confidence: 0.91, model_id: 'workers-ai', ms: 12,
};

describe('cloudflarePlateToVehicle', () => {
  it('maps plate/attrs and uses bodyStyle as vehicleType', () => {
    const v = cloudflarePlateToVehicle(base);
    expect(v.plate).toBe('ABC123');
    expect(v.state).toBe('UT');
    expect(v.vehicleType).toBe('sedan');
    expect(v.confidence).toBe(0.91);
    expect(v.confidences.plate).toBe(0.91);
    expect(v.damageObserved).toBeNull();        // no damage summary
    expect(v.damageAreas).toEqual([]);
  });
  it('flags damageObserved when a damage summary is present', () => {
    const v = cloudflarePlateToVehicle({ ...base, damageSummary: 'dented front bumper' });
    expect(v.damageObserved).toBe(true);
    expect(v.damageSummary).toBe('dented front bumper');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run tests/footageAlprMap.test.ts`).

- [ ] **Step 3: Implement** — add to `footageAlpr.ts` (import the type at top, add the exported mapper). Top import:

```ts
import { readPlateCloudflare, type CloudflarePlateResult } from '../cloudflarePlate';
```

Mapper (place above `alprFootageChunk`):

```ts
/** Map the free Workers-AI plate read onto the AlprVehicle shape persistVehicle
 *  consumes. Pure (exported for tests). */
export function cloudflarePlateToVehicle(r: CloudflarePlateResult): AlprVehicle {
  return {
    plate: r.plate, state: r.state, make: r.make, model: r.model, color: r.color, year: r.year,
    vehicleType: r.bodyStyle, plateType: r.plateType, confidence: r.confidence,
    condition: r.condition, damageObserved: r.damageSummary ? true : null, damageSummary: r.damageSummary,
    damageAreas: [], aftermarket: null,
    confidences: r.confidence != null ? { plate: r.confidence } : {},
  };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add src/utils/footage/footageAlpr.ts tests/footageAlprMap.test.ts && git commit -m "feat(footage): pure Workers-AI plate-read → AlprVehicle mapper"`

---

### Task 2: `alprFootageStillCloudflare` (free still ALPR)

**Files:** Modify `src/utils/footage/footageAlpr.ts`

- [ ] **Step 1: Add the function** (reuses the existing `persistVehicle` + `ensureSightingColumns` in this file):

```ts
/** Free Workers-AI ALPR on a still (e.g. a segment thumbnail). Reads the most
 *  prominent plate, maps it, and persists via the same path as the Roboflow flow
 *  (screen → upsert → sighting → hit). Best-effort; never throws. No-op when the
 *  AI binding is absent or no plate is read. */
export async function alprFootageStillCloudflare(
  env: Bindings, db: DB, chunkId: number, stillBytes: Uint8Array, deviceId: string | null,
): Promise<void> {
  if (!(env as { AI?: unknown }).AI || !stillBytes.length) return;
  let result: CloudflarePlateResult | null = null;
  try { result = await readPlateCloudflare(env as { AI: Ai }, stillBytes, 'image/jpeg'); }
  catch (e) { console.error('[flexcam-alpr] workers-ai read failed:', (e as Error)?.message); return; }
  if (!result?.plate) return;
  await ensureSightingColumns(db);
  const locationText = `FlexCam ${deviceId ?? ''}`.trim() || 'FlexCam footage';
  await persistVehicle(db, cloudflarePlateToVehicle(result), deviceId, locationText);
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS. (If `Ai` type is unresolved, it's the Workers-AI global from `@cloudflare/workers-types`, already used by `cloudflarePlate.ts`.)
- [ ] **Step 3: Commit** `git add src/utils/footage/footageAlpr.ts && git commit -m "feat(footage): free Workers-AI still ALPR for footage segments"`

---

### Task 3: Expose + scan the segment thumbnail

**Files:** Modify `src/utils/footage/types.ts`, `clearpathSource.ts`, `captureOrchestrator.ts`

- [ ] **Step 1: Add `thumbnailUrl` to `FootageChunkStatus`** (`types.ts`):

```ts
export interface FootageChunkStatus {
  state: 'requested' | 'available' | 'missing' | 'error';
  accessUrl?: string;
  contentType?: string;
  thumbnailUrl?: string;     // per-segment still for free footage ALPR
}
```

- [ ] **Step 2: Populate it in `classifyChunkStatus`** (`clearpathSource.ts`) — in the `available` branch, add `thumbnailUrl`:

```ts
  if (accessUrl && (status === 'AVAILABLE' || status === 'READY')) {
    return { state: 'available', accessUrl, contentType: obj?.contentType ? String(obj.contentType) : undefined,
      thumbnailUrl: obj?.thumbnailUrl ? String(obj.thumbnailUrl) : undefined };
  }
```

- [ ] **Step 3: Scan the thumbnail in `pollAndDownload`** (`captureOrchestrator.ts`) — replace the existing `if (alpr === 'pending')` ALPR block with one that prefers the free still path when a thumbnail exists:

```ts
        if (alpr === 'pending') {
          try {
            if (st.thumbnailUrl) {
              const tr = await fetch(st.thumbnailUrl, { signal: AbortSignal.timeout(30_000) });
              if (tr.ok) {
                const bytes = new Uint8Array(await tr.arrayBuffer());
                const { alprFootageStillCloudflare } = await import('./footageAlpr');
                await alprFootageStillCloudflare(env, db, ch.id, bytes, ch.cpg_device_id);
              }
            } else {
              const { alprFootageChunk } = await import('./footageAlpr');
              await alprFootageChunk(env, db, ch.id, key, ch.cpg_device_id); // image chunks only; no-ops on video
            }
            await execute(db, `UPDATE footage_chunks SET alpr_status='done' WHERE id=?`, ch.id);
          } catch (e) { console.error('[flexcam-alpr] failed:', (e as Error).message); }
        }
```

- [ ] **Step 4:** `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git add src/utils/footage/types.ts src/utils/footage/clearpathSource.ts src/utils/footage/captureOrchestrator.ts && git commit -m "feat(flexcam): scan each segment's thumbnail via free Workers-AI ALPR"`

---

### Task 4: Verify + push

- [ ] **Step 1:** `npm run typecheck && npx vitest run` → all PASS.
- [ ] **Step 2:** `git push` (grows PR #1349).

---

## Self-Review
- **Spec coverage (W4):** automatic server-side footage ALPR via the per-segment still → Tasks 2-3, credit-free (Workers AI). Persistence reuses the existing `footageAlpr` path. Client ffmpeg.wasm high-coverage keyframe tier = explicitly deferred (next increment), not dropped.
- **Placeholders:** none.
- **Type consistency:** `cloudflarePlateToVehicle` (Task 1) → `alprFootageStillCloudflare` (Task 2) → wired in `pollAndDownload` (Task 3). `thumbnailUrl` added to `FootageChunkStatus` (Task 3.1) before it's read (3.2/3.3). `st` is already the `FootageChunkStatus` in scope at the ALPR block.
