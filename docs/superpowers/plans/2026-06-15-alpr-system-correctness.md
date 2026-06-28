# ALPR System Correctness & Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every ALPR capture path write honest *derived* trust (never raw model confidence), stop silently-failed confirmations from reporting success, and wire up the dead ClearPath admin features + device→unit mapping.

**Architecture:** The five capture paths share one trust seam (`src/utils/plateTrust.ts` `trustScore()`). Two paths (footage, edge) still leak raw model confidence — route them through the seam. Two confirm handlers (`/accept`, `/verify`) stamp `confirmed` even when the authoritative write threw — gate the status on a `persisted` flag and surface a warning. The ClearPath admin tab is missing buttons for three working endpoints and an inline picker for `unit_id=NULL` devices — add them.

**Tech Stack:** Cloudflare Workers + Hono (`/src`), React 18 + Vite + Tailwind (`/client`), Cloudflare D1, vitest. No DB migration (all columns exist; `review_status` is free-text).

**Spec:** `docs/superpowers/specs/2026-06-15-alpr-system-correctness-design.md`

**Testing reality:** There is no Miniflare/Worker route test suite (per CLAUDE.md — Phase-2 tech debt). So TDD applies to **pure helpers** (`plateTrust`, extracted derive logic). Route + client changes (Pillars 2–4) are verified by `npm run typecheck`, `cd client && npx tsc --noEmit`, `cd client && npx vitest run`, and explicit manual steps. Where logic is testable, it is extracted into a pure function and unit-tested.

**Conventions:**
- Worker tests live in `tests/*.test.ts`, run with `npx vitest run tests/<file>`.
- All D1 calls are `await`ed.
- Commit after each task. Branch is already `claude/unruffled-hoover-21b03c` (isolated worktree off `origin/main`).

---

## Task 1: Footage path writes derived trust (Pillar 1a) — the core accuracy fix

**Files:**
- Modify: `src/utils/footage/footageAlpr.ts:120-141` (`persistVehicle`)
- Test: `tests/footageAlprTrust.test.ts` (create)

**Why:** `persistVehicle` gates `accepted` on raw `v.confidence` (Roboflow `field_confidence.plate`) and stores that raw value in `vehicle_sightings.confidence`. A single weak read self-reporting 0.95 is auto-accepted and displayed as trustworthy. Routing through `trustScore({ reads: [plate], modelPct })` hard-caps a lone read at 0.84 → never auto-accepts, and stores derived trust.

- [ ] **Step 1: Write the failing test**

Create `tests/footageAlprTrust.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveFootageTrust } from '../src/utils/footage/footageAlpr';

describe('deriveFootageTrust', () => {
  it('hard-caps a single read below the 0.85 accept gate even at model 0.99', () => {
    const t = deriveFootageTrust('A12BC', 0.99); // valid UT format, lone read
    expect(t.trustScore).toBeLessThanOrEqual(0.84);
    expect(t.accepted).toBe(false);
  });

  it('treats a malformed lone read as low trust', () => {
    const t = deriveFootageTrust('??', 0.95);
    expect(t.trustScore).toBeLessThan(0.6);
    expect(t.accepted).toBe(false);
  });

  it('passes the raw model pct through to trustScore as a tiebreaker only', () => {
    const hi = deriveFootageTrust('A12BC', 1.0);
    const lo = deriveFootageTrust('A12BC', 0.0);
    expect(hi.trustScore).toBeGreaterThanOrEqual(lo.trustScore); // monotonic, small effect
    expect(hi.trustScore - lo.trustScore).toBeLessThanOrEqual(0.06); // tiebreaker weight 0.05
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/footageAlprTrust.test.ts`
Expected: FAIL — `deriveFootageTrust` is not exported.

- [ ] **Step 3: Add the pure helper + use it in persistVehicle**

In `src/utils/footage/footageAlpr.ts`, add the import (merge into the existing `roboflowAlpr` import is not possible — `trustScore` is in `plateTrust`):

```ts
import { trustScore } from '../plateTrust';
```

Add the exported helper above `persistVehicle` (after `upsertVehicleByPlate`, ~line 116):

```ts
/** Derive honest trust for one footage read. A footage chunk yields a single
 *  Roboflow read per vehicle, so trustScore hard-caps it below the accept gate
 *  (no corroboration). Never gate/store the raw model self-report. */
export function deriveFootageTrust(plate: string | null, modelPct: number | null | undefined) {
  const t = trustScore({ reads: plate ? [plate] : [], modelPct: modelPct ?? undefined });
  return { trustScore: t.trustScore, accepted: !!plate && t.trustScore >= ALPR_ACCEPT_CONFIDENCE };
}
```

Replace `persistVehicle` body lines 125 and 140 (the raw-confidence sites). Change line 125 from:

```ts
  const accepted = (v.confidence ?? 0) >= ALPR_ACCEPT_CONFIDENCE;
```

to:

```ts
  const { trustScore: derivedTrust, accepted } = deriveFootageTrust(plate, v.confidence);
```

Change the sighting INSERT's confidence param (line 140) from `v.confidence` to `derivedTrust`:

```ts
      `FlexCam footage ${deviceId ?? ''}`.trim() + (accepted ? '' : ' (unconfirmed <0.85)'),
      derivedTrust);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/footageAlprTrust.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/footage/footageAlpr.ts tests/footageAlprTrust.test.ts
git commit -m "fix(alpr): footage path writes derived trust, not raw model confidence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Edge ingest sighting writes derived trust (Pillar 1b)

**Files:**
- Modify: `src/routes/alpr.ts:1091`

**Why:** The edge handler computes `trust.trustScore` at line 1062 and uses it for the `vehicle_capture_photos` package, but writes raw `rec.plate_confidence` into the sighting at line 1091 — the sighting diverges from the package and from every other path.

- [ ] **Step 1: Change the sighting confidence param**

In `src/routes/alpr.ts`, line 1091, change:

```ts
      typeof rec.plate_confidence === 'number' ? rec.plate_confidence : null);
```

to:

```ts
      trust.trustScore);
```

(`trust` is in scope from line 1062.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "fix(alpr): edge sighting stores derived trust, matching the package row

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: No silent success on /accept and /verify (Pillar 2a)

**Files:**
- Modify: `src/routes/alpr.ts` `/capture/:id/accept` (~749-792) and `/capture/:id/verify` (~858-883)
- Test: `tests/alprReviewStatus.test.ts` (create — pure helper)

**Why:** Both handlers wrap the authoritative write in try/catch that only logs, then unconditionally stamp `accepted=1, review_status='confirmed'`. A thrown write leaves a "confirmed" capture with no `vehicles_records`/`vehicle_sightings`/`call_vehicles` row. Fix: track a `persisted` flag, stamp `'confirmed_unlinked'` on failure, audit it, and return a warning.

- [ ] **Step 1: Write the failing test for the pure status helper**

Create `tests/alprReviewStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { confirmReviewStatus, confirmWarning } from '../src/utils/alprReview';

describe('confirmReviewStatus', () => {
  it('confirmed when the authoritative write persisted', () => {
    expect(confirmReviewStatus(true)).toBe('confirmed');
  });
  it('confirmed_unlinked when persistence failed', () => {
    expect(confirmReviewStatus(false)).toBe('confirmed_unlinked');
  });
  it('warning only on failure', () => {
    expect(confirmWarning(true)).toBeUndefined();
    expect(confirmWarning(false)).toMatch(/not (be )?created|not saved|retry/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/alprReviewStatus.test.ts`
Expected: FAIL — module `../src/utils/alprReview` not found.

- [ ] **Step 3: Create the pure helper**

Create `src/utils/alprReview.ts`:

```ts
/** Status + warning for a human-confirm action, given whether the authoritative
 *  vehicle record/sighting actually persisted. Keeps the "confirmed" promise
 *  honest: a failed write becomes 'confirmed_unlinked' (free-text — no migration)
 *  so it is visibly distinct from a real confirmation. */
export function confirmReviewStatus(persisted: boolean): 'confirmed' | 'confirmed_unlinked' {
  return persisted ? 'confirmed' : 'confirmed_unlinked';
}

export function confirmWarning(persisted: boolean): string | undefined {
  return persisted ? undefined : 'Vehicle record was not created — review and retry.';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/alprReviewStatus.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into /verify (confirm branch)**

In `src/routes/alpr.ts`, add to the imports near the other util imports:

```ts
import { confirmReviewStatus, confirmWarning } from '../utils/alprReview';
```

In the `/capture/:id/verify` handler, replace the confirm branch (currently lines ~858-883):

```ts
  } else if (action === 'confirm' && plate) {
    let persisted = true;
    try {
      const keep = (col: string, key: keyof typeof values) =>
        key in values ? (values as any)[key] : (plateChanged ? null : (row[col] ?? null));
      const v: AlprVehicle = {
        plate,
        state: keep('state', 'state'),
        make: keep('make', 'make'),
        model: keep('model', 'model'),
        color: keep('color', 'color'),
        year: keep('year', 'year'),
        vehicleType: keep('vehicle_type', 'vehicle_type'),
        plateType: null, confidence: plateChanged ? null : (row.plate_confidence ?? null),
        condition: keep('condition', 'condition'), damageObserved: null,
        damageSummary: keep('damage_summary', 'damage_summary'), damageAreas: [],
        aftermarket: null, confidences: {},
      };
      hits = await persistConfirmedVehicle(db, row, v, userId, 'ALPR (verified)');
    } catch (err: any) {
      persisted = false;
      console.error('[alpr] verify relink failed:', err?.message);
    }
    await execute(db,
      `UPDATE alpr_captures SET accepted=1, review_status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
      confirmReviewStatus(persisted), userId, id);
    if (!persisted) verifyWarning = confirmWarning(false);
  } else if (action === 'save') {
```

Declare `verifyWarning` near the top of the handler (after `let hits...`, ~line 852):

```ts
  let verifyWarning: string | undefined;
```

Then update the final response (the `return c.json({ success: true, hits, ...shapeCapture(updated) })` at ~line 900) to include the warning:

```ts
  return c.json({ success: true, hits, ...(verifyWarning ? { warning: verifyWarning } : {}), ...shapeCapture(updated) });
```

- [ ] **Step 6: Wire into /accept**

In the `/capture/:id/accept` handler, wrap the existing relink try/catch (lines ~749-784) so it records failure, then gate the final UPDATE. Replace the `catch` at ~line 783 and the UPDATE at ~786-789:

Change the relink block opening so a `persisted` flag exists. Before the `if (plate) {` at ~749 add:

```ts
  let persisted = true;
```

Change the relink `catch` (~783) from:

```ts
    } catch (err: any) { console.error('[alpr] accept relink failed:', err?.message); }
```

to:

```ts
    } catch (err: any) { persisted = false; console.error('[alpr] accept relink failed:', err?.message); }
```

Change the final UPDATE (~786-789) from `review_status='confirmed'` to the gated status:

```ts
  await execute(db,
    `UPDATE alpr_captures SET accepted=1, review_status=?, plate=COALESCE(?, plate),
       reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    confirmReviewStatus(persisted), corrected, userId, id);
```

Add an audit row + warning before the response (replace the `return c.json({ success: true, hits, ...shapeCapture(updated) })` at ~791):

```ts
  if (!persisted) {
    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'ALPR_ACCEPT_UNLINKED', 'alpr_capture', ?, 'authoritative write failed', datetime('now'))`,
        userId, id);
    } catch { /* best-effort */ }
  }
  const updated = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  return c.json({ success: true, hits, ...(persisted ? {} : { warning: confirmWarning(false) }), ...shapeCapture(updated) });
```

(If `/accept` already has the `const updated = ...` line, do not duplicate it — keep one.)

- [ ] **Step 7: Run worker tests + typecheck**

Run: `npx vitest run tests/alprReviewStatus.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Check nothing relies on `review_status='confirmed'` exactly**

Run: `grep -rn "review_status.*=.*'confirmed'\|'confirmed'" src/routes/alpr.ts src/routes/drivingEvents.ts src/utils/ client/src | grep -iv confirmed_unlinked`
Expected: review/filter queries should treat `confirmed_unlinked` appropriately. If any query filters `review_status = 'confirmed'` to mean "reviewed", widen it to `review_status IN ('confirmed','confirmed_unlinked')` or `review_status LIKE 'confirmed%'`. Note findings in the commit body.

- [ ] **Step 9: Commit**

```bash
git add src/routes/alpr.ts src/utils/alprReview.ts tests/alprReviewStatus.test.ts
git commit -m "fix(alpr): /accept + /verify no longer report success on failed authoritative write

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: /capture surfaces image + field-photo failures (Pillar 2b)

**Files:**
- Modify: `src/routes/alpr.ts` `/capture` response (~589-628)

**Why:** `/capture` returns `success: finalized` but never tells the client that the R2 image store (`imageStored=false`, ~520) or the `field_photos` link (~533) failed — so a photo silently missing from the call gallery looks like success.

- [ ] **Step 1: Track field-photo link success**

In the `attachToCall` block (~526-534), the existing code sets `fieldPhotoId`. Add a boolean. After the block, compute:

```ts
  const fieldPhotoLinked = !attachToCall || fieldPhotoId != null;
```

- [ ] **Step 2: Add warnings to the response**

In the `/capture` `return c.json({ ... })` (~589), add these fields alongside `success`:

```ts
    image_stored: imageStored,
    field_photo_linked: fieldPhotoLinked,
    warnings: [
      ...(imageStored ? [] : ['Image upload failed — capture saved without a stored photo.']),
      ...(fieldPhotoLinked ? [] : ['Photo could not be attached to the call gallery.']),
    ],
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "fix(alpr): /capture response surfaces image + field-photo write failures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Client surfaces ALPR warnings (Pillar 2c)

**Files:**
- Modify: `client/src/pages/PlateLogPage.tsx` `reviewAction` (~134-160) and scan result handling (~221-240)
- Test: `cd client && npx vitest run` (regression only) + `npx tsc --noEmit`

**Why:** The review-queue accept/verify and the on-scene scan now return `warning` / `warnings[]`. Show them instead of a green confirmation when present.

- [ ] **Step 1: Read warning from reviewAction response**

In `reviewAction` (~134), the call already does `apiFetch<{ hits?: ... }>(...)`. Widen the type and surface the warning. Change the type to include `warning?: string` and after the call:

```ts
      const res = await apiFetch<{ hits?: Array<{ severity: string; detail: string }>; warning?: string }>(
        `/alpr/captures/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      if (res.warning) {
        // surface failure instead of a silent success (use the page's existing toast/message channel)
        setReviewMsg?.(res.warning);
      }
```

If the page has no `setReviewMsg`, reuse whatever message/toast state the file already uses (grep `useState` for a string message setter near the review queue; e.g. `setMsg`). Place the warning text in that channel with a distinct amber style if the component supports a variant. Do NOT invent a toast library — match the file's existing pattern.

- [ ] **Step 2: Read warnings[] from the scan result**

In the scan handler (~221, `apiPostForm<AlprResult>('/alpr/capture', fd)`), extend `AlprResult` with `warnings?: string[]` and, after a successful scan, if `r.warnings?.length` show them in the same message channel.

- [ ] **Step 3: Typecheck + client tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no type errors; existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/PlateLogPage.tsx
git commit -m "fix(alpr): surface capture/confirm warnings in the plate log UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Admin tab — wire the three dead one-click endpoints (Pillar 3a)

**Files:**
- Modify: `client/src/pages/admin/AdminClearPathGpsTab.tsx` (handlers near `handleSyncNow` ~418; buttons near the sync button ~992)

**Why:** `/clearpathgps/auto-map-devices`, `/enable-media`, and `/scan-alpr-now` are implemented server-side but never called from the UI.

- [ ] **Step 1: Add the three handlers**

Near `handleSyncNow` (~418), following its exact pattern (it uses `apiFetch` + a busy/message state — match whichever it uses):

```ts
  const handleAutoMap = async () => {
    try {
      const r = await apiFetch<{ success: boolean; mapped: number; candidates: number; error?: string }>(
        '/clearpathgps/auto-map-devices', { method: 'POST' });
      // reuse the existing status/message channel handleSyncNow writes to
      await loadStatus?.(); await loadMappings?.();
      setSyncMsg?.(r.error ? r.error : `Auto-mapped ${r.mapped} of ${r.candidates} dashcam device(s).`);
    } catch (e) { setSyncMsg?.('Auto-map failed.'); }
  };

  const handleEnableMedia = async () => {
    try {
      const r = await apiFetch<{ success: boolean; mapped: number; error?: string }>(
        '/clearpathgps/enable-media', { method: 'POST' });
      await loadStatus?.(); await loadMediaStatus?.();
      setSyncMsg?.(r.error ? r.error : 'Dashcam ALPR media sync enabled.');
    } catch (e) { setSyncMsg?.('Enable media failed.'); }
  };

  const handleScanAlprNow = async () => {
    try {
      const r = await apiFetch<{ scanned: number; captured: number; note?: string; error?: string }>(
        '/clearpathgps/scan-alpr-now', { method: 'POST' });
      setSyncMsg?.(r.error ? r.error : `Scanned ${r.scanned}, captured ${r.captured}.${r.note ? ' ' + r.note : ''}`);
    } catch (e) { setSyncMsg?.('ALPR scan failed.'); }
  };
```

Match the real state setters/loaders the file already defines (grep the file for `setSyncMsg`/`loadStatus`/`loadMediaStatus`/`fetchMediaStatus` and use the real names; the `?.` above is a placeholder for "use the existing one").

- [ ] **Step 2: Add the three buttons**

Next to the existing "Sync Now" button (~992), add three buttons styled identically (copy the existing button's className):

```tsx
<button type="button" onClick={handleAutoMap} className={/* same as Sync Now */}>Auto-map devices</button>
<button type="button" onClick={handleEnableMedia} className={/* same */}>Enable dashcam ALPR</button>
<button type="button" onClick={handleScanAlprNow} className={/* same */}>Scan ALPR now</button>
```

- [ ] **Step 3: Typecheck + client tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/AdminClearPathGpsTab.tsx
git commit -m "feat(clearpath): wire auto-map / enable-media / scan-alpr-now admin buttons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Relink endpoint for past NULL-unit events (Pillar 3b — server)

**Files:**
- Modify: `src/routes/clearpathgps.ts` (add `POST /mappings/:id/relink` after the existing mappings routes ~290)
- Test: none (route; verified by typecheck + manual). The bounded UPDATE is straightforward.

**Why:** When a device is finally mapped to a unit, its existing `dashcam_events` (and the unit join on captures) still carry `unit_id=NULL`. A relink stamps the now-known `unit_id` onto that device's past NULL-unit rows so history attaches.

- [ ] **Step 1: Add the route**

In `src/routes/clearpathgps.ts`, after `cpg.delete('/mappings/:id', ...)` (~286-290):

```ts
// Backfill unit_id onto a device's existing NULL-unit dashcam_events after the
// admin maps it to a unit. Idempotent, bounded to the one device.
cpg.post('/mappings/:id/relink', adminOnly, async (c) => {
  const db = getDb(c.env);
  const m = await queryFirst<{ cpg_device_id: string; unit_id: number | null }>(
    db, 'SELECT cpg_device_id, unit_id FROM cpg_device_mappings WHERE id = ?', c.req.param('id'));
  if (!m) return c.json({ error: 'Mapping not found' }, 404);
  if (m.unit_id == null) return c.json({ error: 'Map this device to a unit first' }, 400);
  let events = 0;
  try {
    const r = await execute(db,
      `UPDATE dashcam_events SET unit_id = ? WHERE cpg_device_id = ? AND unit_id IS NULL`,
      m.unit_id, m.cpg_device_id);
    events = r.meta.changes ?? 0;
  } catch { /* table may be absent on a fresh env */ }
  return c.json({ success: true, relinked_events: events });
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/clearpathgps.ts
git commit -m "feat(clearpath): POST /mappings/:id/relink backfills unit_id onto past events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Admin tab — unmapped-device chip + inline unit picker + relink (Pillar 3b — client)

**Files:**
- Modify: `client/src/pages/admin/AdminClearPathGpsTab.tsx` (mappings render ~765-790; reuse the existing picker pattern at ~836-852 and `availableUnits` at ~489)

**Why:** `PSO Sierra 19` shows `unit_id=NULL` (rendered as "Unit #null" at ~771). The tab already fetches `/dispatch/units` (~179) and has a unit-`<select>` pattern for new device mapping — reuse it inline on any mapping whose `unit_id` is null, plus a "Link past events" action calling Task 7's endpoint.

- [ ] **Step 1: Add a bind+relink handler**

Near the other mapping handlers, add (use the real loader names from the file):

```ts
  const handleBindUnit = async (mappingRow: CpgMapping, unitId: number) => {
    await apiFetch('/clearpathgps/mappings', {
      method: 'POST',
      body: JSON.stringify({
        cpg_device_id: mappingRow.cpg_device_id,
        cpg_display_name: mappingRow.cpg_display_name,
        cpg_serial_number: mappingRow.cpg_serial_number,
        unit_id: unitId,
      }),
    });
    await loadMappings?.();
  };

  const handleRelinkPast = async (mappingId: number) => {
    const r = await apiFetch<{ relinked_events: number }>(
      `/clearpathgps/mappings/${mappingId}/relink`, { method: 'POST' });
    setSyncMsg?.(`Linked ${r.relinked_events} past event(s) to the unit.`);
  };
```

- [ ] **Step 2: Render the chip + picker for NULL-unit mappings**

In the mappings list render (~765-790), where it shows `{m.call_sign || `Unit #${m.unit_id}`}`, branch on `m.unit_id == null`:

```tsx
{m.unit_id == null ? (
  <span className="inline-flex items-center gap-2">
    <span className="px-1.5 py-[1px] text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
      Not linked to a unit
    </span>
    <select
      className={/* match the existing unit <select> className at ~852 */}
      defaultValue=""
      onChange={(e) => e.target.value && handleBindUnit(m, Number(e.target.value))}
    >
      <option value="" disabled>Assign unit…</option>
      {availableUnits.map((u) => (
        <option key={u.id} value={u.id}>{u.call_sign} {u.officer_name ? `(${u.officer_name})` : ''}</option>
      ))}
    </select>
  </span>
) : (
  <span className="text-brand-400 font-mono font-medium">
    {m.call_sign || `Unit #${m.unit_id}`}
    <button type="button" className="ml-2 text-[10px] underline opacity-70" onClick={() => handleRelinkPast(m.id)}>
      Link past events
    </button>
  </span>
)}
```

Confirm `CpgMapping` includes `cpg_display_name`, `cpg_serial_number`, `id`; if a field is missing on the type, add it to the interface (the server returns `m.*`).

- [ ] **Step 3: Typecheck + client tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/AdminClearPathGpsTab.tsx
git commit -m "feat(clearpath): inline unit picker + relink for unmapped dashcam devices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Visibility check — dashcam ALPR reads reach dispatch (Pillar 4)

**Files:**
- Inspect: `src/routes/drivingEvents.ts` (`/plate-history` ~175) and the client page that consumes it.
- Modify only if a gap is found.

**Why:** Confirm dashcam-sourced plate reads surface to officers/dispatch (not just admin) via the existing `/api/driving-events/plate-history` surface.

- [ ] **Step 1: Trace the surface**

Run: `grep -rn "plate-history\|plate_history\|driving-events" client/src | head`
Read the consuming page. Confirm it lists `vehicle_sightings`/`alpr_captures` reads including dashcam-sourced ones (the dashcam path writes `alpr_captures` with `capture_id LIKE 'cpg_dashcam:%'` and `vehicle_sightings`).

- [ ] **Step 2: Decide**

If dashcam reads already appear, write a one-line note in the task's commit and make NO code change (YAGNI). If they are filtered out (e.g. the query requires a `call_id`), add an OR clause to include dashcam-sourced reads. Show the exact query change in the commit if made.

- [ ] **Step 3: Typecheck (only if changed) + commit**

```bash
git commit -am "chore(alpr): verify dashcam reads surface in driving-events plate history

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Use an empty-tree-safe message if no code changed: `git commit --allow-empty -m "..."` is NOT needed — instead append the finding to the Task 10 PR body if there was no change.)

---

## Task 10: Service worker bump, full verification, PR

**Files:**
- Modify: `client/public/sw.js` (`CACHE_NAME`)

- [ ] **Step 1: Bump the service worker cache name**

Run: `grep -n "CACHE_NAME" client/public/sw.js`
Increment the version (e.g. `v98x` → next integer). Show the diff.

- [ ] **Step 2: Full gate — worker**

Run: `npm run typecheck && npx vitest run`
Expected: all pass.

- [ ] **Step 3: Full gate — client**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all pass; build succeeds.

- [ ] **Step 4: Commit the SW bump**

```bash
git add client/public/sw.js
git commit -m "chore: bump service worker cache for ALPR correctness release

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin claude/unruffled-hoover-21b03c
gh pr create --title "ALPR system correctness: honest confidence, no silent confirms, ClearPath wiring" \
  --body "$(cat <<'EOF'
## Summary
Makes the ALPR system accurate and fully wired across every capture path (Spec 1 of 2; FlexCam revival is Spec 2).

- **Honest confidence everywhere:** footage + edge paths now write derived `trustScore` (lone reads hard-cap at 0.84), never raw model self-report. Unit-tested invariant.
- **No silent success:** `/accept` + `/verify` stamp `confirmed_unlinked` + return a warning + audit row when the authoritative write fails; `/capture` surfaces image/field-photo failures.
- **ClearPath wiring:** admin buttons for auto-map / enable-media / scan-alpr-now; inline unit picker for `unit_id=NULL` devices; `POST /mappings/:id/relink` backfills past events.

## Testing
- `npm run typecheck` + `npx vitest run` (worker)
- `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
- No DB migration (all columns exist; `review_status` free-text).

## Notes
- Three agent-reported "CRITICAL" findings were false (the `/alpr/image/*` route, the `driving-events` mount, and `/:id/stream` all exist) and were not "fixed".
- Device→unit live binding deferred to the new admin picker per operator choice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Report the PR URL to the user.**

---

## Self-review notes (author)
- **Spec coverage:** Pillar 1 → Tasks 1–2; Pillar 2 → Tasks 3–5; Pillar 3 → Tasks 6–8; Pillar 4 → Task 9; delivery → Task 10. All spec sections covered.
- **`confirmed_unlinked` consistency:** Task 3 Step 8 explicitly checks for `review_status='confirmed'` exact-match queries that would now miss unlinked rows.
- **Type consistency:** `deriveFootageTrust` (Task 1) returns `{trustScore, accepted}`; `confirmReviewStatus`/`confirmWarning` (Task 3) are the only new exports consumed by routes. Client handlers reuse existing state setters (named placeholders flagged to resolve against the real file).
- **No migration:** verified — every column already exists on live D1.
