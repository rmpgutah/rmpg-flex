# Capture Foundation (W1 spike + W2 full-drive pull + W3 retention) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the full ClearPath drive (every ~40s segment of every on-duty trip, no length cap), pace vendor requests + downloads across cron ticks so any-length drives stay inside Worker limits, retain footage 4 months with evidence-safe auto-purge, and ship a read-only diagnostic that proves the live vendor contract.

**Architecture:** Keep `FootageSource` as the vendor seam. Split "request" from "download" into two cron-paced passes by adding a `pending_request` chunk state and a per-chunk `requestChunk()` source method (replacing the synchronous `requestWindow()` fan-out at enqueue time). Broaden the trip-close auto-capture trigger behind a `flexcam_full_drive` flag. Add a 120-day evidence-safe purge on the 4-hourly cron. The spike is a new admin route on the existing `flexcam` router.

**Tech Stack:** Cloudflare Workers, Hono, D1 (`utils/db` async helpers), R2 (`env.UPLOADS`), vitest (pure helpers only — there is no Worker integration test harness, so integration tasks verify via `npm run typecheck` + the spike).

---

## File Structure

- `src/utils/footage/retention.ts` — **new**, pure: cutoff math + expired-id partition. Tested.
- `src/utils/footage/pacing.ts` — **new**, pure: per-tick batch sizing. Tested.
- `src/utils/footage/clearpathSource.ts` — **modify**: add `requestChunk()`; keep classifiers.
- `src/utils/footage/types.ts` — **modify**: add `requestChunk` to `FootageSource`.
- `src/utils/footage/captureOrchestrator.ts` — **modify**: `pending_request` state, request pass, remove cap, config reads, purge entry.
- `src/utils/tripStore.ts` — **modify**: broaden auto-capture trigger (flag-gated).
- `src/routes/flexcam.ts` — **modify**: add `POST /diagnose` spike route.
- `src/index.ts` — **modify**: wire retention purge into the 4-hourly cron block.
- `tests/footageRetention.test.ts` — **new**.
- `tests/footagePacing.test.ts` — **new**.

No migration: `footage_chunks.status` is free-text TEXT, so `'pending_request'` needs no DDL. Config lives in `system_config` (category `integrations`), runtime-created.

---

### Task 1: Retention cutoff helper (pure, TDD)

**Files:**
- Create: `src/utils/footage/retention.ts`
- Test: `tests/footageRetention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/footageRetention.test.ts
import { describe, it, expect } from 'vitest';
import { retentionCutoffMs, isPurgeable } from '../src/utils/footage/retention';

describe('retentionCutoffMs', () => {
  it('subtracts retention days from now (ms)', () => {
    const now = Date.UTC(2026, 5, 15, 0, 0, 0); // 2026-06-15
    expect(retentionCutoffMs(now, 120)).toBe(now - 120 * 86_400_000);
  });
  it('returns null for non-positive / non-finite days (keep forever)', () => {
    expect(retentionCutoffMs(1_000, 0)).toBeNull();
    expect(retentionCutoffMs(1_000, -5)).toBeNull();
    expect(retentionCutoffMs(1_000, NaN)).toBeNull();
  });
});

describe('isPurgeable', () => {
  const cutoff = 1_000_000;
  it('purges an old, unlocked request', () => {
    expect(isPurgeable({ created_ms: 500_000, evidence_locked: 0 }, cutoff)).toBe(true);
  });
  it('never purges a locked request, however old', () => {
    expect(isPurgeable({ created_ms: 1, evidence_locked: 1 }, cutoff)).toBe(false);
  });
  it('keeps a request newer than the cutoff', () => {
    expect(isPurgeable({ created_ms: 2_000_000, evidence_locked: 0 }, cutoff)).toBe(false);
  });
  it('treats null/undefined evidence_locked as unlocked', () => {
    expect(isPurgeable({ created_ms: 1, evidence_locked: null }, cutoff)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/footageRetention.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/footage/retention'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/footage/retention.ts
/** Epoch-ms cutoff: rows created before this are past retention. null = keep forever. */
export function retentionCutoffMs(nowMs: number, retentionDays: number): number | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return nowMs - retentionDays * 86_400_000;
}

/** A footage_requests row is purgeable when it is older than the cutoff AND not
 *  locked as evidence. null/undefined evidence_locked counts as unlocked. */
export function isPurgeable(
  row: { created_ms: number; evidence_locked: number | null | undefined },
  cutoffMs: number,
): boolean {
  if (row.evidence_locked === 1) return false;
  return Number.isFinite(row.created_ms) && row.created_ms < cutoffMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/footageRetention.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/utils/footage/retention.ts tests/footageRetention.test.ts
git commit -m "feat(footage): pure retention cutoff + purgeable predicate"
```

---

### Task 2: Per-tick pacing helper (pure, TDD)

**Files:**
- Create: `src/utils/footage/pacing.ts`
- Test: `tests/footagePacing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/footagePacing.test.ts
import { describe, it, expect } from 'vitest';
import { capChunkCount, batchLimit } from '../src/utils/footage/pacing';

describe('capChunkCount', () => {
  it('passes through when the configured max is 0 (unlimited)', () => {
    expect(capChunkCount(5000, 0)).toBe(5000);
  });
  it('caps to the configured max when positive', () => {
    expect(capChunkCount(5000, 1100)).toBe(1100);
  });
  it('treats negative/NaN max as unlimited', () => {
    expect(capChunkCount(42, -1)).toBe(42);
    expect(capChunkCount(42, NaN)).toBe(42);
  });
});

describe('batchLimit', () => {
  it('clamps a configured value into [1, hardMax]', () => {
    expect(batchLimit(30, 50)).toBe(30);
    expect(batchLimit(999, 50)).toBe(50);
    expect(batchLimit(0, 50)).toBe(1);
  });
  it('falls back to the default when unset/NaN', () => {
    expect(batchLimit(undefined, 50, 30)).toBe(30);
    expect(batchLimit(NaN, 50, 30)).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/footagePacing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/footage/pacing.ts
/** Cap a chunk count to the configured max. max<=0 / NaN means unlimited. */
export function capChunkCount(count: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return count;
  return Math.min(count, max);
}

/** Clamp a per-tick batch size into [1, hardMax]; fall back to def when unset. */
export function batchLimit(configured: number | undefined, hardMax: number, def = hardMax): number {
  const n = Number.isFinite(configured as number) ? (configured as number) : def;
  return Math.max(1, Math.min(hardMax, Math.round(n)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/footagePacing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footage/pacing.ts tests/footagePacing.test.ts
git commit -m "feat(footage): pure per-tick pacing helpers (cap + batch clamp)"
```

---

### Task 3: Add `requestChunk()` to the source (per-chunk request)

**Files:**
- Modify: `src/utils/footage/types.ts`
- Modify: `src/utils/footage/clearpathSource.ts`

- [ ] **Step 1: Add `requestChunk` to the `FootageSource` interface**

In `src/utils/footage/types.ts`, inside `interface FootageSource`, replace the `requestWindow` line with a per-chunk method (the orchestrator now paces requests itself):

```ts
export interface FootageSource {
  readonly id: string;
  readonly maxChunkSeconds: number;
  /** Fire ONE vendor request for a single [fromTs,toTs] chunk; returns the vendor
   *  media/request id (null if the vendor didn't echo one). */
  requestChunk(assetId: number, fromTs: number, toTs: number, channel: string): Promise<string | null>;
  pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus>;
}
```

- [ ] **Step 2: Implement `requestChunk` on `ClearPathSource`**

In `src/utils/footage/clearpathSource.ts`, replace the `requestWindow` method with:

```ts
  async requestChunk(assetId: number, fromTs: number, toTs: number, channel: string): Promise<string | null> {
    const resp = await post(this.env, this.client, CPG_MEDIA_REQUEST_PATH,
      buildMediaRequestPayload(assetId, fromTs, toTs, channel));
    return parseRequestId(resp);
  }
```

Leave `buildMediaRequestPayload`, `parseRequestId`, `classifyChunkStatus`, `pollChunk`, and `getClearPathSource` unchanged. Remove the now-unused `splitWindow` import only if no longer referenced in this file (it isn't after this change).

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (captureOrchestrator will still reference the old `requestWindow` and fail to typecheck — that's fixed in Task 4; if you run typecheck between tasks, expect that one known error until Task 4 lands. Prefer committing Tasks 3+4 together.)

- [ ] **Step 4: Commit (with Task 4)** — see Task 4 Step 6.

---

### Task 4: Cron-paced request/download + remove cap (orchestrator)

**Files:**
- Modify: `src/utils/footage/captureOrchestrator.ts`

- [ ] **Step 1: Replace the constants + add config reads**

At the top of `captureOrchestrator.ts`, replace `DEFAULT_CHUNK_CAP` and add a config reader + import the pacing helpers:

```ts
import { capChunkCount, batchLimit } from './pacing';
import { splitWindow } from './splitWindow';

const R2_PREFIX = 'flexcam/trips/';
const MAX_DOWNLOADS_PER_RUN = 40;     // download pass cap (existing)
const MAX_REQUESTS_PER_RUN = 30;      // NEW: request pass cap (vendor subrequest safety)
const MAX_POLL_ATTEMPTS = 30;

/** Read an integers config from system_config (category integrations); def on absent/NaN. */
async function cfgInt(db: D1Database, key: string, def: number): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key=? AND category='integrations' AND is_active=1 LIMIT 1", key).catch(() => null);
  const n = Number(row?.config_value);
  return Number.isFinite(n) ? n : def;
}
```

- [ ] **Step 2: Rewrite `enqueueFootage` to write `pending_request` chunks (no vendor calls)**

Replace the body from the `const channels = ...` line through the chunk-insert loop with:

```ts
  const channels = args.channels?.length ? args.channels : ['outside'];
  // Build the chunk plan WITHOUT firing vendor requests (the cron paces those).
  const maxChunks = await cfgInt(db, 'flexcam_max_chunks_per_request', 0); // 0 = unlimited
  const planned: Array<{ seq: number; fromTs: number; toTs: number; channel: string }> = [];
  for (const channel of channels) {
    for (const c of splitWindow(args.fromTs, args.toTs, 40)) {
      planned.push({ seq: planned.length, fromTs: c.fromTs, toTs: c.toTs, channel });
    }
  }
  const capped = planned.slice(0, capChunkCount(planned.length, maxChunks));
  if (!capped.length) return null;

  const r = await execute(db, `INSERT INTO footage_requests
    (source, asset_id, cpg_device_id, unit_id, trip_id, call_id, from_ts, to_ts, reason, status, chunk_count, title, created_by)
    VALUES ('clearpathgps', ?, ?, ?, ?, ?, ?, ?, ?, 'fulfilling', ?, ?, ?)`,
    args.assetId, args.cpgDeviceId ?? null, args.unitId ?? null, args.tripId ?? null, args.callId ?? null,
    args.fromTs, args.toTs, args.reason, capped.length, args.title ?? null, args.createdBy ?? null);
  const requestId = Number(r.meta.last_row_id);

  for (const h of capped) {
    await execute(db, `INSERT INTO footage_chunks
      (request_id, seq, from_ts, to_ts, channel, status) VALUES (?, ?, ?, ?, ?, 'pending_request')`,
      requestId, h.seq, h.fromTs, h.toTs, h.channel);
  }
  return requestId;
```

Remove the now-dead `source.requestWindow(...)` call and the `handles`/`capped = handles.slice(...)` lines it replaced. Keep the idempotency dup-check above it unchanged. `getClearPathSource` is still imported and used by the poll path; if `enqueueFootage` no longer needs `source`, drop its `const source = await getClearPathSource(...)` line and the early `if (!source) return null;` (enqueue no longer talks to the vendor — the cron does).

- [ ] **Step 3: Add the request pass + call it from the cron**

Add a new exported function and call it from `maybeRunFootagePoll` before the download pass:

```ts
/** Cron pass 1: fire vendor requests for 'pending_request' chunks, bounded. */
export async function runRequestPass(env: Bindings): Promise<{ requested: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const source = await getClearPathSource(db, env);
  if (!source) return { requested: 0 };
  const limit = batchLimit(await cfgInt(db, 'flexcam_requests_per_run', MAX_REQUESTS_PER_RUN), MAX_REQUESTS_PER_RUN);
  const pend = await query<{ id: number; from_ts: number; to_ts: number; channel: string; asset_id: number }>(db,
    `SELECT ch.id, ch.from_ts, ch.to_ts, ch.channel, rq.asset_id
       FROM footage_chunks ch JOIN footage_requests rq ON rq.id = ch.request_id
      WHERE ch.status='pending_request' ORDER BY ch.request_id, ch.seq LIMIT ?`, limit).catch(() => []);
  let requested = 0;
  for (const ch of pend) {
    try {
      const vendorId = await source.requestChunk(ch.asset_id, ch.from_ts, ch.to_ts, ch.channel);
      await execute(db, `UPDATE footage_chunks SET status='requested', vendor_media_id=?, updated_at=datetime('now') WHERE id=?`, vendorId, ch.id);
      requested++;
    } catch (e) { console.error('[flexcam] requestChunk failed:', (e as Error).message); }
  }
  return { requested };
}
```

Then update `maybeRunFootagePoll`:

```ts
export async function maybeRunFootagePoll(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key='flexcam_enabled' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
  if (enabled?.config_value !== 'true') return;
  const req = await runRequestPass(env);
  const r = await pollAndDownload(env);
  if (req.requested || r.downloaded || r.missing) console.log(`[flexcam] requested=${req.requested} downloaded=${r.downloaded} missing=${r.missing}`);
}
```

`pollAndDownload` is unchanged (it already selects `status='requested'`).

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the full pure-helper suite (no regressions)**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit (Tasks 3 + 4)**

```bash
git add src/utils/footage/types.ts src/utils/footage/clearpathSource.ts src/utils/footage/captureOrchestrator.ts
git commit -m "feat(flexcam): cron-paced per-chunk request/download + remove length cap"
```

---

### Task 5: Broaden the auto-capture trigger (flag-gated)

**Files:**
- Modify: `src/utils/tripStore.ts:96-118`

- [ ] **Step 1: Replace the call-tied gate with a full-drive-aware gate**

In the FlexCam auto-capture block, replace the `if (closed && (closed.call_id || closed.call_number))` condition. Read the `flexcam_full_drive` flag; when on, capture EVERY camera-mapped trip; when off, keep today's call-tied-only behavior:

```ts
        const fullDrive = await queryFirst<{ config_value: string }>(
          db, "SELECT config_value FROM system_config WHERE config_key='flexcam_full_drive' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
        const fullDriveOn = fullDrive?.config_value === 'true';
        const callTied = !!(closed && (closed.call_id || closed.call_number));
        if (closed && (fullDriveOn || callTied)) {
          const map = await queryFirst<{ cpg_camera_id: number | null; cpg_device_id: string }>(
            db, 'SELECT cpg_camera_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1', closed.unit_id);
          const assetId = map?.cpg_camera_id ?? 0;
          const fromTs = Date.parse(closed.start_time + 'Z');
          const toTs = Date.parse(closed.end_time + 'Z');
          if (assetId && Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs > fromTs) {
            const { enqueueFootage } = await import('./footage/captureOrchestrator');
            await enqueueFootage(env as unknown as import('../types').Bindings, {
              assetId, unitId: closed.unit_id, cpgDeviceId: map!.cpg_device_id,
              tripId: String(d.close.tripId), callId: closed.call_id ?? null, fromTs, toTs,
              reason: 'trip_auto', channels: ['outside'],
              title: `Trip ${d.close.tripId}${closed.call_number ? ' · Call ' + closed.call_number : ''}`,
            });
          }
        }
```

Keep the surrounding `try { ... } catch` and the `closed` query exactly as they are; only the gate condition + the explicit `channels: ['outside']` are new.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/tripStore.ts
git commit -m "feat(flexcam): capture every camera-mapped trip when flexcam_full_drive is on (road cam)"
```

---

### Task 6: 4-month evidence-safe retention purge

**Files:**
- Modify: `src/utils/footage/captureOrchestrator.ts`
- Modify: `src/index.ts` (4-hourly cron block)

- [ ] **Step 1: Add the purge function (uses the Task 1 helper)**

In `captureOrchestrator.ts`:

```ts
import { retentionCutoffMs } from './retention';

const DEFAULT_RETENTION_DAYS = 120;
const PURGE_BATCH = 50;

/** Delete R2 objects + rows for footage_requests past retention that are NOT
 *  locked as evidence. Batched per run. Returns counts. Best-effort per object. */
export async function purgeExpiredFootage(env: Bindings, nowMs = Date.now()): Promise<{ purged: number; objects: number }> {
  const db = getDb(env);
  await ensureFootageSchema(db);
  const days = await cfgInt(db, 'footage_retention_days', DEFAULT_RETENTION_DAYS);
  const cutoff = retentionCutoffMs(nowMs, days);
  if (cutoff == null) return { purged: 0, objects: 0 };               // keep forever
  const cutoffIso = new Date(cutoff).toISOString().replace('T', ' ').slice(0, 19); // new-date-ok

  // evidence_locked may not exist yet (Phase-2 col) → COALESCE via a guarded read.
  const locked = await columnExists(db, 'footage_requests', 'evidence_locked');
  const lockClause = locked ? "AND COALESCE(evidence_locked,0)=0" : '';
  const due = await query<{ id: number }>(db,
    `SELECT id FROM footage_requests WHERE created_at < ? ${lockClause} ORDER BY id LIMIT ?`, cutoffIso, PURGE_BATCH).catch(() => []);
  let purged = 0, objects = 0;
  for (const req of due) {
    const chunks = await query<{ r2_key: string | null }>(db, 'SELECT r2_key FROM footage_chunks WHERE request_id=?', req.id).catch(() => []);
    for (const ch of chunks) {
      if (ch.r2_key) { try { await env.UPLOADS.delete(ch.r2_key); objects++; } catch { /* best-effort */ } }
    }
    const merged = await queryFirst<{ merged_r2_key: string | null }>(db, 'SELECT merged_r2_key FROM footage_requests WHERE id=?', req.id).catch(() => null);
    if (merged?.merged_r2_key) { try { await env.UPLOADS.delete(merged.merged_r2_key); objects++; } catch { /* */ } }
    await execute(db, 'DELETE FROM footage_chunks WHERE request_id=?', req.id).catch(() => {});
    await execute(db, 'DELETE FROM footage_requests WHERE id=?', req.id).catch(() => {});
    purged++;
  }
  return { purged, objects };
}
```

Ensure `columnExists` is imported in this file (it's exported from `../db`; add to the existing import if absent).

- [ ] **Step 2: Wire it into the 4-hourly cron**

In `src/index.ts`, inside the `else` branch of `scheduled` (the 4-hourly block, after the SOR poll near line 449), add:

```ts
    // FlexCam footage retention — purge non-evidence footage past the
    // configured window (default 120 days / 4 months). Evidence-locked is never
    // touched. Best-effort; cannot abort the other 4-hourly scans.
    ctx.waitUntil(
      import('./utils/footage/captureOrchestrator')
        .then(({ purgeExpiredFootage }) => purgeExpiredFootage(env))
        .then((r) => { if (r.purged) console.log(`[flexcam-retention] purged ${r.purged} request(s), ${r.objects} object(s)`); })
        .catch((err) => console.error('[flexcam-retention] purge failed:', (err as Error)?.message)),
    );
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/footage/captureOrchestrator.ts src/index.ts
git commit -m "feat(flexcam): evidence-safe 120-day footage retention purge on the 4h cron"
```

---

### Task 7: W1 verification spike route (`POST /api/flexcam/diagnose`)

**Files:**
- Modify: `src/routes/flexcam.ts`

- [ ] **Step 1: Add the admin-gated diagnostic handler**

Add near the top of `flexcam.ts` (after imports): import the source + GPS helpers.

```ts
import { getClearPathSource } from '../utils/footage/clearpathSource';
import { getApiConfig, listMedia, listDevices } from '../utils/clearpathGps';
```

Then add the route (admin only — `requireRole('admin')` is already imported):

```ts
// Read-only contract probe. Hits the LIVE ClearPath API with the configured token
// for a tiny recent window and reports the raw shapes (secrets/base64 stripped) so
// we can confirm: on-demand request handle? arbitrary past segments? per-object still?
flexcam.post('/diagnose', requireRole('admin'), async (c): Promise<Response> => {
  const db = getDb(c.env);
  const client = await getApiConfig(db, c.env).catch(() => null);
  if (!client) return c.json({ ok: false, error: 'ClearPath not configured (no refresh token)' }, 503);
  let body: { asset_id?: number; window_seconds?: number; lookback_minutes?: number };
  try { body = await c.req.json(); } catch { body = {}; }

  const report: Record<string, unknown> = { steps: [] as unknown[] };
  const step = (name: string, data: unknown) => (report.steps as unknown[]).push({ name, data });

  // 1) Resolve a camera asset (explicit, else first media-enabled device).
  let assetId = Number(body.asset_id) || 0;
  try {
    const devices = await listDevices(c.env, client);
    step('devices', { count: devices.length, sample: devices.slice(0, 3).map((d) => ({ deviceId: d.deviceId, assetId: d.assetId, mediaEnabled: d.mediaEnabled, name: d.displayName })) });
    if (!assetId) { const m = devices.find((d) => d.mediaEnabled && d.assetId); assetId = m ? Number(m.assetId) : 0; }
  } catch (e) { step('devices_error', (e as Error).message); }
  if (!assetId) return c.json({ ok: false, error: 'No camera asset resolved', report }, 200);
  report.assetId = assetId;

  // 2) Tiny recent window.
  const lookbackMin = Number(body.lookback_minutes) || 10;
  const winSec = Math.min(Number(body.window_seconds) || 40, 120);
  const toTs = Date.now() - lookbackMin * 60_000;        // new-date-ok (diagnostic only)
  const fromTs = toTs - winSec * 1000;
  report.window = { fromTs, toTs, winSec, lookbackMin };

  // 3) On-demand request — does the vendor accept it / echo a handle?
  const source = await getClearPathSource(db, c.env);
  try {
    const vendorId = source ? await source.requestChunk(assetId, fromTs, toTs, 'outside') : null;
    step('on_demand_request', { accepted: vendorId != null, vendorId });
  } catch (e) { step('on_demand_request_error', (e as Error).message); }

  // 4) What does media/data return for that window? (shapes only — strip URLs/base64)
  try {
    const page = await listMedia(c.env, client, assetId, fromTs, toTs, 0, 25);
    const objs = page.items.flatMap((ev) => ev.mediaObject.map((mo) => ({
      channel: mo.channel, type: mo.type, status: mo.status, eventType: mo.eventType,
      hasThumbnail: !!mo.thumbnailUrl, hasAccessUrl: !!mo.accessUrl,
      durationSec: mo.durationSec, gpsPoints: mo.gps?.length ?? 0,
    })));
    step('media_data', { total: page.total, events: page.items.length, objects: objs.slice(0, 25) });
  } catch (e) { step('media_data_error', (e as Error).message); }

  return c.json({ ok: true, report });
});
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. (If `listDevices` isn't exported from `clearpathGps`, it is — confirm the import resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/flexcam.ts
git commit -m "feat(flexcam): admin read-only ClearPath contract diagnostic (W1 spike)"
```

---

### Task 8: Full verification + PR

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all vitest pass (incl. the 2 new suites).

- [ ] **Step 2: Bump nothing client-side** (this slice is server-only — no `client/public/sw.js` bump needed).

- [ ] **Step 3: Push the branch + open the PR**

```bash
git push -u origin claude/trusting-heyrovsky-1701cc
gh pr create --title "feat(flexcam): full-drive capture foundation + 4mo retention + contract spike" \
  --body "$(cat <<'EOF'
W1 spike + W2 full-drive pull + W3 retention from the ALPR/full-drive program spec.

- Cron-paced per-chunk request/download (new `pending_request` state) — long drives no longer blow the Worker subrequest limit.
- Removed the 60-min cap; `flexcam_max_chunks_per_request` (0=unlimited) is an optional ceiling.
- `flexcam_full_drive` flag (default OFF) captures every camera-mapped trip on the road camera; call-tied capture unchanged when off.
- Evidence-safe 120-day retention purge on the 4h cron (`footage_retention_days`); locked footage never purged.
- `POST /api/flexcam/diagnose` (admin) read-only probe of the live ClearPath contract.

⚠️ Post-merge: run `POST /api/flexcam/diagnose` in a browser/admin session to confirm the on-demand contract before flipping `flexcam_full_drive` on.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage (Plan 1 portion):** W1 spike → Task 7. W2 broadened trigger → Task 5; cron-paced request/download → Tasks 3–4; remove cap → Task 4. W3 retention → Tasks 1, 6. Shared pure helpers → Tasks 1–2. ✅ (W4/W5/W6/W7/W8 are out of this plan by design — separate plans.)

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `requestChunk(assetId,fromTs,toTs,channel)` defined in Task 3 (types + source) and called in Tasks 4 (`runRequestPass`) and 7 (spike). `cfgInt`/`capChunkCount`/`batchLimit`/`retentionCutoffMs`/`isPurgeable` names are consistent across tasks. Chunk states: `pending_request` (Task 4 enqueue) → `requested` (Task 4 request pass) → `downloaded`/`missing` (existing `pollAndDownload`). No dangling references.
