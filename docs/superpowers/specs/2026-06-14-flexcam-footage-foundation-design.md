# FlexCam Footage Foundation — Phase 1 Design

- **Date:** 2026-06-14
- **Status:** Approved design → spec for review
- **Author:** Claude (brainstormed with operator-owner)
- **Scope:** Phase 1 of a 3-phase program. This spec covers ONLY Phase 1.

---

## 1. Background & problem

RMPG runs a ClearPathGPS (GPS-Insight) AI dashcam on one vehicle today
(**PSO Sierra 19**, asset `136022`, ClearPath transport `cpt008761`, serial
`HQNS02501085`). The live integration (`src/routes/clearpathgps.ts`,
`src/utils/clearpathGps.ts`, `src/utils/clearpathSync.ts`) pulls **event-triggered
clips** from `GET /v2.0/media/data` and stores them in R2 (`UPLOADS`, `dashcam/`
prefix) as `dashcam_videos` rows. Every such clip is a short AI event
(Lane Departure, Frontal Collision Warning, …) — the "20-second clips."

The operator wants **full-length trip footage**, the camera recording **24/7
moving and parked**, the ClearPath name removed, and several upgrades.

### Phase 0 discovery findings (live portal, verified 2026-06-14)

Captured by driving `portal.clearpathgps.com` with the operator's admin session:

1. **On-demand retrieval exists** via the "Request Media" flow
   (`/web/dashcams/media-request/step-1?assetId=136022`). Footage is *pulled from
   the camera when it is online* and stored in the portal for 30 days.
2. **The camera already records continuously.** OLDEST AVAILABLE MEDIA = **May 13**
   (≈32 days before today) → the device retains ~30 days of continuous footage on
   its local SD card. **"24/7 moving and parked" already physically happens** — it
   is not a configurable setting and there is nothing to "enable."
3. **🧱 Hard cap: 40 seconds per request.** The Request Duration control offers
   only `20 Seconds` or `40 Seconds`. This — not a default — is the source of the
   "20-second clip" limitation. It is a vendor (UI) cap; whether the backend API
   enforces it is **unknown** (see spike §11).
4. **Async / queued:** a request is only fulfilled when the camera is **online**
   (it was offline at discovery; last comm 01:58 AM). Retrieval is not instant.
5. **No recording-mode levers.** Admin → Dashcams → Edit Camera Settings exposes
   only AI-event toggles (Tailgating / Frontal Collision / Lane Departure), Record
   Audio (ON), Record Driver-Facing (OFF), In-Cab Alerts (OFF), Vehicle Type. No
   clip-length, no continuous/parking toggle, no retention setting.
6. Driver-facing camera is disabled on this unit (Road-Facing only).
7. Account has exactly **1 vehicle / 1 dashcam**.

### Implication

The entire problem reduces to **retrieval**, capped at 40s/request and gated on
the camera being online. "Full trip" footage is reconstructed by requesting many
40s windows and joining them. Once footage is in **our R2**, it is permanently
ours — immune to ClearPath's 30-day purge, throttling, or branding.

---

## 2. Goals (Phase 1)

- Produce **one continuous video for a full trip** (and for any arbitrary time
  window), reconstructed from 40s chunks, stored in our R2.
- **Auto-capture** full footage for trips linked to a dispatched call/incident;
  **on-demand** capture for any other trip / call / window. (Operator chose "Both.")
- A **source-agnostic footage layer** so ClearPath is a swappable adapter, not the
  foundation (a future Howen / self-hosted source drops in with no upstream rewrite).
- **Full-trip ALPR**: run the existing plate pipeline across the pulled footage.
- Surface it under the **FlexCam** name (`/api/flexcam`), ClearPath invisible to users.

## 3. Non-goals (deferred to later phases — DO NOT build in Phase 1)

- Evidence lock, chain-of-custody, court export (trim/redact/watermark) → **Phase 2**.
- Critical-event auto-preserve (panic / use-of-force / incident) → **Phase 2**.
- Map-synced trip playback, full client UI reskin → **Phase 3**.
- Live look-in from dispatch → **Phase 3** (verify vendor support when camera online).
- Changing camera/device config (there is nothing to change — §1.5).
- Migrating to Howen / new hardware (strategic future; the adapter seam makes it cheap later).

---

## 4. Architecture

```
                       ┌─────────────────────────────────────────┐
 trip-end (call-linked) │  captureOrchestrator                    │
 + POST /flexcam/request├─►  splitWindow(from,to,maxChunkSeconds)  │
                        │    → enqueue footage_requests + chunks   │
                        └───────────────┬─────────────────────────┘
                                        │ (cron, every minute)
                        ┌───────────────▼─────────────────────────┐
   FootageSource (iface)│  poll pending chunks via adapter         │
   ── clearpathSource ──┤  available → stream S3 body → R2         │
   ── (future: howen)   │  all chunks down → request = complete    │
                        │  outside-channel chunk → ALPR pipeline   │
                        └───────────────┬─────────────────────────┘
                                        │
            GET /flexcam/footage/:id ───┘  manifest (ordered chunks)
              → instant seamless playback (player plays chunks back-to-back)
              → "render continuous file" → single MP4 in R2 (byte-concat or ffmpeg -c copy)
```

### 4.1 The `FootageSource` interface — the key seam

`src/utils/footage/types.ts`:

```ts
export interface FootageRequestHandle {
  vendorId: string;        // vendor's media/request id for this chunk
  fromTs: number; toTs: number; channel: string;
}
export interface FootageChunkStatus {
  state: 'requested' | 'available' | 'missing' | 'error';
  accessUrl?: string;      // pre-signed download URL when available
  contentType?: string;
}
export interface FootageSource {
  readonly id: string;               // 'clearpathgps'
  readonly maxChunkSeconds: number;  // 40 for ClearPath (or larger if cap bends)
  /** Request footage for a window; the adapter chunks internally to maxChunkSeconds. */
  requestWindow(assetId: number, fromTs: number, toTs: number, channels: string[]): Promise<FootageRequestHandle[]>;
  /** Poll fulfillment for a previously requested chunk. */
  pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus>;
}
```

Everything upstream (orchestrator, route, ALPR, playback) talks ONLY to this
interface. ClearPath specifics live entirely inside `clearpathSource.ts`.

### 4.2 Components (all new, additive — existing clearpath code untouched)

- `src/utils/footage/types.ts` — interface + shared types.
- `src/utils/footage/splitWindow.ts` — **pure**: `(from,to,maxSeconds) → chunk[]`.
  Unit-tested. Also `orderChunks`, `detectGaps` (pure).
- `src/utils/footage/clearpathSource.ts` — adapter. Reuses `getApiConfig()` from
  `clearpathGps.ts` for the token/client; adds a `POST` helper for the
  request-media endpoint (contract captured in the spike, §11) and reuses the
  existing `GET /v2.0/media/data` poll to detect availability.
- `src/utils/footage/captureOrchestrator.ts` — enqueue + cron-driven poll/download
  loop; bounded work per tick; KV cooldown on 429 (reuse `clearpathSync` pattern).
- `src/utils/footage/concat.ts` — **pure-ish**: build manifest; produce single file
  (byte-concat path; see §7).
- `src/routes/flexcam.ts` — `/api/flexcam` route (auth required, mounted in `index.ts`).

**Minimal client surface (Phase 1 — functional, not the rich UX):**
- A basic **FlexCam** page/section: list footage requests (status + gaps), an
  on-demand "Request footage" form (unit + time window), a sequential-chunk
  **player** (manifest playback), and a "Download/Render continuous file" action
  (drives the §7 single-file production, incl. client-side `ffmpeg.wasm` when the
  format requires remux). The **rich** map-synced review UX is **Phase 3**.

---

## 5. Data model (2 new tables)

Reuses `cpg_device_mappings` (camera↔unit), R2 binding `UPLOADS`, prefix
`flexcam/trips/`. Created idempotently at boot (`ensureFlexcamSchema`) AND added as
a migration; **apply directly to live D1 `785de7ae` after merge** (deploy apply is
`continue-on-error`).

```sql
CREATE TABLE IF NOT EXISTS footage_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'clearpathgps',
  asset_id INTEGER NOT NULL,
  cpg_device_id TEXT,
  unit_id INTEGER,
  trip_id TEXT,                 -- unit_trips / nav_trip_log id when from a trip
  call_id INTEGER,              -- linked CFS call when applicable
  from_ts INTEGER NOT NULL,     -- epoch ms (window start)
  to_ts INTEGER NOT NULL,       -- epoch ms (window end)
  reason TEXT NOT NULL,         -- 'trip_auto' | 'on_demand' | 'critical_event'
  status TEXT NOT NULL DEFAULT 'queued', -- queued|fulfilling|complete|partial|failed
  chunk_count INTEGER DEFAULT 0,
  chunks_done INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  merged_r2_key TEXT,           -- single continuous file once rendered
  merged_status TEXT,           -- null|pending|ready|unsupported
  title TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_req_status ON footage_requests(status);
CREATE INDEX IF NOT EXISTS idx_footage_req_trip ON footage_requests(trip_id);
CREATE INDEX IF NOT EXISTS idx_footage_req_call ON footage_requests(call_id);

CREATE TABLE IF NOT EXISTS footage_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,         -- 0-based order within the request
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'outside',
  vendor_media_id TEXT,
  r2_key TEXT,
  content_type TEXT,
  bytes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested', -- requested|available|downloaded|missing|error
  alpr_status TEXT DEFAULT 'pending',       -- pending|done|skipped
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_chunks_req ON footage_chunks(request_id, seq);
CREATE INDEX IF NOT EXISTS idx_footage_chunks_status ON footage_chunks(status);
```

The **ordered set of `footage_chunks` for a request IS the trip**. `merged_r2_key`
holds the single continuous file once produced.

---

## 6. Capture flow (async, offline-tolerant)

1. **Enqueue** (`captureOrchestrator.enqueue`): given `(assetId, from, to, reason,
   trip_id?, call_id?)`, call `splitWindow(from,to,source.maxChunkSeconds)` →
   insert one `footage_requests` row + N `footage_chunks` rows (`status=requested`),
   then `source.requestWindow(...)` to fire the vendor requests, storing each
   `vendor_media_id`. Idempotent: re-enqueueing the same window is a no-op.
2. **Poll** (per-minute cron, reuse `* * * * *` trigger; throttled): for each
   request not `complete|failed`, `source.pollChunk` each `requested` chunk. On
   `available`, stream the pre-signed S3 body straight into R2 (no buffering — same
   pattern as `clearpathSync.storeClip`) under
   `flexcam/trips/<asset>/<request_id>/<seq>_<channel>.<ext>`, set chunk
   `downloaded`, increment `chunks_done`/`bytes`.
3. **Missing-gap honesty:** a chunk the camera never has (offline during that
   window, or beyond retention) → `missing` after K poll attempts. Request becomes
   `partial`, not `complete` — gaps are surfaced, never silently hidden.
4. **Completion:** when every chunk is `downloaded` → request `complete`; when all
   are `downloaded|missing` and at least one `missing` → `partial`.
5. **ALPR:** each `downloaded` outside-channel chunk → existing pipeline
   (`clearpathAlpr` / `roboflowAlpr`), `alpr_status=done`.
6. **Bounds:** max chunks downloaded per cron tick (e.g. 40, reuse
   `MAX_CLIPS_PER_RUN`); per-request chunk cap (default 90 = 60 min, configurable);
   KV rate-limit cooldown on 429.

---

## 7. Stitching into ONE continuous video

Two layers; the operator gets a genuine single file plus instant playback.

- **Instant playback (always):** `GET /flexcam/footage/:id` returns the ordered
  chunk manifest; the client player plays chunks back-to-back seamlessly. No
  processing, available the moment chunks land.
- **The single continuous file (`merged_r2_key`):**
  - **Format probe (spike §11):** inspect a downloaded chunk's container.
  - **If MPEG-TS or fragmented-MP4:** the Worker concatenates chunk bodies into a
    **single R2 object** by streaming them in order (TS appends directly; fMP4 =
    one init segment + ordered media fragments). Cheap, no transcode, no quality
    loss, Workers-native. This is the **preferred** path.
  - **If standard MP4:** chunks must be **remuxed** (`ffmpeg -c copy` — rewrap, no
    re-encode). Workers can't run ffmpeg, so produce the merged file with
    **client-side `ffmpeg.wasm`** on first "render/export," then upload the result
    to R2 (`merged_status: pending → ready`) so it is computed **once** per trip.
    (A Cloudflare Container running ffmpeg is a noted future server-side
    optimization, deferred due to the known Workers-Builds container deploy
    conflict — see `wrangler.toml` PDF-container note.)
  - `merged_status='unsupported'` only if a trip can't be merged (e.g. mixed
    incompatible codecs); playback still works via the manifest.

---

## 8. Triggers (the "Both" model)

- **Auto (call-linked trips):** hook the existing trip-end detection. Trips live in
  `unit_trips` (`/api/dispatch/trips`, `tripEngine`) and `nav_trip_log`
  (`/api/nav/trip/*`). On a trip ending **that is linked to a dispatched
  call/incident**, enqueue a `footage_requests` row (`reason='trip_auto'`) for the
  trip `[start,end]` window on that unit's mapped asset. Routine (non-call) trips
  are NOT auto-captured (cost control).
- **On-demand:** `POST /api/flexcam/request { unit_id|asset_id, from, to,
  trip_id?, call_id?, title? }` (`reason='on_demand'`) — for any trip, call, or
  arbitrary window. Role-gated (officer+).

---

## 9. API surface (`/api/flexcam`, auth required)

- `POST /request` — enqueue a capture (on-demand). Body validated; 400 on bad window.
- `GET /footage` — list requests (filters `?trip_id= &call_id= &unit_id= &status=`).
- `GET /footage/:id` — request detail + ordered chunk manifest (stream URLs + gaps).
- `GET /footage/:id/chunk/:seq/stream` — range-supporting R2 playback of a chunk.
- `GET /footage/:id/continuous` — stream/redirect to `merged_r2_key`; triggers
  render if `merged_status` is null and format supports Worker byte-concat.
- `GET /status` — config + queue health (pending requests, chunks, last poll, cooldown).
- `POST /render/:id` — (idempotent) produce the single continuous file.

Mounted in `src/index.ts` with `app.use('/api/flexcam', authMiddleware)`.

---

## 10. Naming / de-brand

- Product name **FlexCam**; new route prefix **`/api/flexcam`** sits ALONGSIDE the
  existing `/api/clearpathgps` admin tab (which stays for connection management).
- New UI surfaces created in Phase 1 use "FlexCam" / "Dashcam" wording only; the
  ClearPath adapter is internal. Full client reskin is **Phase 3**.
- Honest limit: the physical device and vendor portal keep ClearPath branding (not
  API-changeable). Auto-pulling into our R2 + FlexCam UI makes ClearPath invisible
  to RMPG users — the real win.

---

## 11. Discovery spike (FIRST implementation task)

The on-demand `POST` endpoint/payload is not yet captured. Before building
`clearpathSource.requestWindow`, run a ~15-minute spike:

1. In the operator's portal session, submit ONE real "Request Media" (camera
   offline → it queues, minimal cost) and read the `POST` from the network tab:
   **endpoint, payload fields (assetId / start / duration / cameras), response
   shape, and how fulfillment/`accessUrl` is signaled.**
2. **Cap probe:** replay the same `POST` with `duration=600` (10 min). If the
   backend honors it → set `maxChunkSeconds` high (full trips in 1–2 requests). If
   it rejects/clamps → `maxChunkSeconds=40` and chunk. Either way the adapter works.
3. **Format probe:** download one fulfilled chunk; inspect container (TS / fMP4 /
   MP4) to pick the §7 merge path.

Document findings inline in the adapter; update this spec's §7 decision.

---

## 12. Testing

- **Pure unit tests (vitest):** `splitWindow` (exact/partial/zero/over-cap windows),
  `orderChunks`, `detectGaps`, manifest builder, byte-concat key ordering.
- **Route smoke test:** `POST /request` validation + `GET /status` shape.
- Worker typecheck + client typecheck/build per CI. Bump `client/public/sw.js`
  `CACHE_NAME` on any client change.

---

## 13. Guardrails / cost

- Auto-capture **off by default**; enabled via a `system_config` flag.
- Per-request chunk cap (default 90); per-tick download cap; KV 429 cooldown.
- Only **call-linked** trips auto-capture; routine patrol is on-demand only.
- Single camera today → volume is tiny; guardrails matter mainly for fleet growth.

---

## 14. Risks / open questions

- **Camera offline reliability:** requests queue until the camera reconnects; a
  chronically-offline camera yields `partial` trips. Surfaced honestly via gap
  detection; not solvable in software.
- **Vendor rate limits / ToS:** bulk 40s requests may hit undocumented limits;
  cooldown + caps mitigate. Cap-bypass (§11.2), if it works, drastically reduces
  request count.
- **Cellular data cost:** pulling full trips = real cellular upload from the
  vehicle; bounded by the call-linked-only auto policy.
- **MP4 merge on Workers:** if chunks are standard MP4, the single-file render
  relies on client-side ffmpeg.wasm (heavy for long trips). Worker byte-concat is
  preferred and depends on the format probe.
