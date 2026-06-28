# FlexCam Full-Trip Stitching — Design Spec

**Date**: 2026-06-21
**Status**: Approved (brainstormed in-session with operator)
**Owner**: Christopher Zamora (operator-owner)
**Module**: FlexCam (Phase 3 — Stitching)
**Implementation**: single PR

---

## Goal

Make a closed `unit_trip` watchable as **one continuous video** in the FlexCam UI, and exportable as **one signed file** for evidence/court use — without paying the cost of materializing the merged file on every trip.

The camera vendor (ClearPath GPS) returns vanilla MP4 clips capped at 40 seconds. A 30-minute trip is ~45 separate `moov`-bearing MP4 files. Byte-concat is impossible; per-clip playback is what we have today and it is operationally useless for shift review and unworkable for evidence presentation.

## Non-goals

- **In-video redaction at trip level.** The per-clip redaction studio shipped in PR #1278/#1280 stays. Trip-level redaction is a separate Phase 3 item.
- **Map-synced playback.** Listed in `[[project-flexcam-footage-program]]` as deferred Phase 3 — separate design conversation.
- **Audio mux.** Per Phase 2 memo, even the evidence flow was video-only. Same here.
- **HLS / DASH adaptive streaming.** Considered (Approach C) and rejected — produces no single-file artifact for court export, doubles the surface to maintain.
- **Server-side ffmpeg in Worker.** Native ffmpeg unavailable; ffmpeg.wasm hits the worker-loader bug (`@ffmpeg/ffmpeg@0.12.x` hard-codes `type:'module'`). We use `mp4box.js` (pure JS) instead.
- **On-demand recording trigger.** Operator-blocked spike — separate Phase 1 follow-up.
- **Migrating away from the existing chunk endpoints.** All current `/flexcam/footage/:id/*` routes keep their signatures.

## Architecture — three layers, three lifecycles

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              R2 + D1                                    │
│  footage_chunks (per-clip MP4 + sha256)   unit_trips (boundaries)       │
└─────────┬─────────────────────────────────────────────┬─────────────────┘
          │                                             │
          ▼                                             ▼
┌──────────────────────────────────┐         ┌──────────────────────────────────┐
│ (1) MANIFEST LAYER               │         │ (3) MERGE MATERIALIZATION        │
│ GET /trips/:id/manifest          │         │ POST /footage/:id/render (admin) │
│   → concat.ts:buildPlayerManifest│         │   for format='mp4':              │
│   → ordered clips + gaps         │         │     → enqueue FlexCamRemuxDO     │
│ Cheap, always-on, no I/O beyond  │         │     → alarm → concat.ts:         │
│ existing D1 reads.               │         │        remuxMp4ToFmp4 → mp4box.ts│
│                                  │         │ /court-package reads result      │
│                                  │         │ (additive — no contract break).  │
└──────────────┬───────────────────┘         └──────────────┬───────────────────┘
               │                                            │
               ▼                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ (2) SEQUENTIAL PLAYER  (client only)                                    │
│  client/src/components/flexcam/FlexCamTripPlayer.tsx                    │
│  Double-buffered <video> chain + gap-aware TripTimeline                 │
│                                                                         │
│  Receives manifest from (1) for daily playback.                         │
│  Surfaces admin "Build merged file" → triggers (3) via /render.         │
│  Polls /footage/:id while remux_state ∈ {queued, working}.              │
│  Surfaces "Generate court package" → calls /court-package separately.   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Boundaries & rationale

- **(1) Manifest layer** stays pure: a SQL join over `unit_trips × footage_chunks` + a gap-detection pass. No file I/O, no remux. Trip is watchable the moment one chunk is `ready`.
- **(2) Player** owns all timing-sensitive logic (the `<video>` `ended` → next-src swap). Server is unaware of playback state.
- **(3) Materialization** is opt-in and runs in a Durable Object alarm so multi-minute remux jobs never sit in the request path. The DO is keyed `idFromName('rmx-' + requestId)` for idempotency. Existing `GET /continuous` becomes the consumer endpoint — its contract is unchanged.

### Boundary contract — unchanged

- `GET /flexcam/footage/:id/continuous` (`flexcam.ts:118-129`) — `202` with `{merged_status, hint}` pending / `200` + MP4 when `merged_status='ready'`. DO becomes the producer.
- `POST /flexcam/footage/:id/court-package` (`flexcam.ts:202-228`) — synchronous response unchanged. Today it returns `{manifest, payloadHash, ...signed}`. We ADD optional `merged_sha256` + `merged_url` to the manifest when `merged_status='ready'`. Behavior is purely additive — no breaking change for existing callers.
- All chunk-streaming endpoints, evidence lock, custody log, signed PDF — untouched.

### Boundary contract — extended

- `POST /flexcam/render/:id` (`flexcam.ts:131-143`) — **currently calls `concatToR2(...'mp4')` which returns `'unsupported'` per `concat.ts:33`**. We change this: for `format='mp4'`, the route now `enqueue()`s `FlexCamRemuxDO` and returns `202 {remux_state:'queued', merged_status:'queued'}`. For `format='ts'|'fmp4'` (dormant since Phase 1), behavior is unchanged. Admin-only trigger is preserved.

### Boundary contract — new

- `GET /flexcam/trips/:tripId/manifest?channel=front` — new player-oriented manifest endpoint (auth: required, same role gate as other FlexCam routes). Distinct from the existing `concat.ts:buildManifest()` which is request-id keyed and chunk-oriented.
- `FlexCamRemuxDO` — new DO class. Requires wrangler migration tag `v5-flexcamremux`, appended to the prefix chain per the comment block in `wrangler.toml` before each `[[migrations]]` entry (current tags: `v1`, `v1-pdftools`, `v2-voicehub`, `v3-alerthub`, `v4-deepresearch`).
- `<FlexCamTripPlayer>` + a new `/flexcam/trip/:tripId` route surfaced from `FlexCamPage.tsx` and the trip card on the unit roster.

---

## Components

### Server-side

| File | Purpose | Est. LOC |
|---|---|---|
| `src/routes/flexcam.ts` (edit) | Add `GET /trips/:tripId/manifest` handler. Change `/render/:id` MP4 path from `concatToR2(...'mp4')` to DO enqueue. Enrich `/court-package` manifest with `merged_sha256`/`merged_url` when ready. | +80 |
| `src/utils/footage/concat.ts` (edit) | **Extend the existing file** — add `buildPlayerManifest(tripId, channel, chunks)` (richer shape than the existing chunk-level `buildManifest`). Add `remuxMp4ToFmp4(env, mergedKey, chunks) → 'ready'\|'failed'` for the DO to call. The existing `concatToR2(...'ts'\|'fmp4')` streaming path stays; the `'mp4'` branch now delegates to a "queued, run in DO" return code rather than `'unsupported'`. | +220 (file grows from 54 → ~270) |
| `src/durable-objects/FlexCamRemuxDO.ts` (new) | One DO per `request_id`. Public: `enqueue()`, `status()`. Alarm calls `remuxMp4ToFmp4()` with bounded retries. State in DO storage + mirrored to `footage_requests.remux_state`. | ~150 |
| `src/utils/footage/mp4box.ts` (new) | Thin wrapper over `mp4box.js` — pure-ish, mocked in tests. Splits from `concat.ts` to keep the lib boundary clean and let `concat.ts` stay deps-free. | ~120 |
| `wrangler.toml` (edit) | Append `[[durable_objects.bindings]]` for `FLEXCAM_REMUX` + `[[migrations]] tag = "v5-flexcamremux"`. | +12 |

**Why extend `concat.ts` instead of creating `remux.ts`** — `concat.ts:buildManifest()` already exists and is referenced by `flexcam.ts:136`. Creating a parallel `tripManifest.ts` + `remux.ts` would duplicate intent and split the "how do we assemble trip footage" knowledge across three files. Single home keeps related concerns together; the mp4box library wrapper lives in its own file (`mp4box.ts`) to keep the dependency boundary explicit.

### Schema (one migration)

| File | Adds |
|---|---|
| `migrations/<NNNN>_flexcam_remux_state.sql` | To `footage_requests`: `remux_state TEXT` (`queued`/`working`/`ready`/`failed`), `remux_started_at INTEGER`, `remux_finished_at INTEGER`, `remux_error TEXT`, `remux_attempts INTEGER DEFAULT 0`, `merged_sha256 TEXT`. Idempotent `ADD COLUMN` per CLAUDE.md gotcha #5. Backfill: `UPDATE footage_requests SET remux_state='ready' WHERE merged_status='ready'`. |

**Migration number is the next free integer at implementation time**, not hard-coded. Local high-water at design time is `0141`; the open PR [#1539](https://github.com/rmpgutah/rmpg-flex/pull/1539) adds `0142`. So this PR is `0142` if authored on current main, `0143` if rebased after #1539 merges. The implementer runs `ls migrations/ | tail -3` at start of work and picks the next free integer. Duplicate prefixes have happened before per `migrations/README.md` and are tolerated, but we avoid them when possible.

**⚠️ Post-merge action**: apply the migration directly to live D1 `785de7ae` and verify with `pragma_table_info('footage_requests')`. Deploy step is `continue-on-error` per CLAUDE.md.

### Client-side

| File | Purpose | Est. LOC |
|---|---|---|
| `client/src/hooks/useFlexCamManifest.ts` (new) | `useFlexCamManifest(tripId, channel)`. Polls every 10s while `stillDownloading > 0`. | ~80 |
| `client/src/components/flexcam/FlexCamTripPlayer.tsx` (new) | Seamless player: active + buffer `<video>`, swap on `ended`, gap pill overlay. | ~250 |
| `client/src/components/flexcam/TripTimeline.tsx` (new) | Custom scrubber. Clip blocks + gap blocks. Click-to-seek resolves `(clipIndex, offsetMs)`. | ~140 |
| `client/src/components/flexcam/ChannelSwitcher.tsx` (new) | Dashcam ↔ interior toggle. | ~50 |
| `client/src/pages/flexcam/TripPlaybackPage.tsx` (new) | Route `/flexcam/trip/:tripId`. Composes player + court-package button + remux status pill. | ~180 |
| `client/src/pages/FlexCamPage.tsx` (edit) | "Play whole trip" link on each trip-grouped request. | +15 |
| `client/public/sw.js` (edit) | **None — `CACHE_NAME` is now templated as `rmpg-flex-<sha>` at build time** (`sw.js:1282`). The old "bump CACHE_NAME manually" gotcha in CLAUDE.md is stale; verify before editing. If still required after verification, edit accordingly. | 0 |

### Dependencies added

- `mp4box.js` — pure JS, ~250 KB compressed. Used in DO only (not main Worker hot path). Bundle-size precondition: verify the DO build stays under the Worker size limit before implementation; if not, fall back to client-side remux for export too.

---

## Data flow

### Flow 1 — Trip closes → manifest is ready (existing producers, new consumer)

```
unit_trips → status='closed' UPDATE       (existing — src/utils/tripStore.ts:116)
   ↓
enqueueFootage({ reason: 'trip_auto',     (existing — tripStore.ts:148-156
                  channels: ['outside'] })   imports captureOrchestrator)
   ↓
footage_requests + N footage_chunks rows  (existing — captureOrchestrator.ts)
   ↓
cron pulls ClearPath → R2                 (existing — pollAndDownload via cron)
   ↓
footage_chunks[i].status = 'downloaded'   (existing — note: 'downloaded', not 'ready';
                                                see flexcam.ts:135, concat.ts ChunkFull)
   ↓
GET /api/flexcam/trips/:tripId/manifest?channel=outside   (NEW; default channel = 'outside')
   ← TripManifest
```

**Channel naming note**: the existing schema uses `'outside'` (per `tripStore.ts:155`), not `'front'`. The manifest endpoint accepts the existing channel names verbatim. The earlier draft of this spec wrote `'front' | 'interior'` — the actual values are vendor-defined and pass through.

**Status enum note**: `footage_chunks.status='downloaded'` is the "ready to play" value (per `concat.ts:17` filter and `flexcam.ts:135` SELECT). The manifest filter uses `status='downloaded'`.

Manifest is valid the moment one chunk is ready. Client polls every 10s while `stillDownloading > 0`, stops on completion.

**Manifest response shape** (canonical — exported from `src/utils/footage/concat.ts`; imported by `useFlexCamManifest.ts` via shared types):

```ts
// Lives in src/utils/footage/concat.ts alongside the existing Manifest type.
// Distinct because the existing Manifest is per-request_id and chunk-oriented;
// this one is per-trip and player-oriented.
export type TripPlayerManifest = {
  tripId: number;
  channel: string;                        // echoed from query param; vendor-defined ('outside', etc.)
  totalDurationMs: number;                // sum of clip durations only; gaps not counted
  stillDownloading: number;               // count of chunks with status != 'downloaded'
  clips: PlayerClip[];                    // ordered by from_ts ascending
  gaps: PlayerGap[];                      // ordered by start_ts ascending
};

export type PlayerClip = {
  seq: number;                            // footage_chunks.seq
  fromTs: number;                         // epoch ms
  toTs: number;                           // epoch ms
  durationMs: number;                     // toTs - fromTs
  url: string;                            // proxied endpoint /flexcam/footage/:id/chunk/:seq/stream
  sha256: string | null;                  // from footage_chunks.sha256; computed lazily on lock
  bytes: number;                          // from footage_chunks.bytes
};

export type PlayerGap = {
  startTs: number;                        // epoch ms (= prev clip's toTs)
  endTs: number;                          // epoch ms (= next clip's fromTs)
  durationMs: number;                     // endTs - startTs; threshold > 500ms
};
```

**Reuse**: gap detection delegates to the existing `detectGaps()` in `splitWindow.ts`. The new builder is `concat.ts:buildPlayerManifest(trip, channel, chunks)` — composes the existing primitives, doesn't reimplement them.

**Gap-detection rule** (already implemented in `splitWindow.ts:detectGaps`): any boundary between consecutive `downloaded` chunks where `next.from_ts - prev.to_ts > 500ms` produces a `PlayerGap`. Boundaries ≤ 500ms are treated as contiguous (camera clock drift tolerance). If `splitWindow.ts` uses a different threshold today, we adopt its value rather than introduce a second one.

### Flow 2 — User plays a trip (all client work)

```
User clicks "Play whole trip" → /flexcam/trip/:tripId
   ↓
useFlexCamManifest(tripId, channel)
   ↓
<FlexCamTripPlayer>
   ├─ <video #active src={clips[0].url}>           (playing)
   ├─ <video #buffer src={clips[1].url} hidden>    (pre-loaded)
   │
   on active.ended → swap roles, advance index, pre-load clips[i+2]
   on gap reached → render "GAP — Xs" pill, jump to next clip start
   on timeline click → resolve (clip, offsetMs); swap active.src; set currentTime
```

Double-buffering keeps the boundary < 50ms in Chrome/Safari — visually seamless.

### Flow 3 — Lock as evidence → merge → court package (DO path)

The existing flow today:
1. `POST /flexcam/footage/:id/lock` — sets `evidence_locked=1`, assigns evidence number, logs `'locked'` to custody.
2. `POST /flexcam/footage/:id/court-package` — synchronously builds `buildCourtManifest({request, chunks, links, custody})`, computes per-chunk sha256s on the fly, signs via `pdfSign.ts:signTriple()`, returns `{manifest, payloadHash, ...signed}`. Today the manifest has per-chunk hashes only — no merged file.

The new path adds an optional materialization step between lock and export, triggered via the existing `/render/:id` admin endpoint:

```
POST /flexcam/footage/:id/lock                      (existing)
   ↓
POST /flexcam/footage/:id/render                    (existing handler, NEW BEHAVIOR for MP4)
   ├─ format='mp4' → instead of returning 'unsupported':
   │      env.FLEXCAM_REMUX.idFromName('rmx-' + id).enqueue()
   │      UPDATE footage_requests SET remux_state='queued', merged_status='queued',
   │                                   remux_started_at=NOW()
   │      return 202 { remux_state: 'queued' }
   └─ format='ts'|'fmp4' → existing concatToR2 path (unchanged)
         ↓
FlexCamRemuxDO.enqueue()                            (NEW)
   ├─ DO storage: { state: 'queued', requestId, attempts: 0 }
   └─ schedule alarm in 1s
         ↓
FlexCamRemuxDO.alarm()                              (NEW)
   ├─ UPDATE remux_state='working'
   ├─ SELECT chunks WHERE request_id=? AND status='downloaded' ORDER BY seq  (snapshot)
   ├─ call concat.ts:remuxMp4ToFmp4(env, mergedKey, chunks)
   │     → wraps mp4box.ts (the lib boundary)
   │     → streams from R2, demuxes per chunk, writes fMP4
   │     → R2 multipart upload (mergedKey = 'flexcam/trips/merged/{id}.mp4')
   │     → streaming sha256 (single pass)
   ├─ on success:
   │     UPDATE merged_sha256=?, merged_r2_key=?, merged_status='ready',
   │            remux_state='ready', remux_finished_at=NOW()
   │     logCustody({action: 'remux_complete'})
   └─ on failure: attempts++; alarm at 2^attempts s; after 3 → remux_state='failed'
                  logCustody({action: 'remux_failed', detail: errorText})
         ↓
Client polls GET /flexcam/footage/:id every 5s while remux_state ∈ {queued,working}
   ↓ when remux_state='ready':
GET /flexcam/footage/:id/continuous → 200 + MP4    (existing — DO output via merged_r2_key)
   ↓ (optional, separate call)
POST /flexcam/footage/:id/court-package            (existing, NEW additive enrichment)
   → manifest now includes { merged_sha256, merged_url } when merged_status='ready'
   → otherwise manifest is identical to today (per-chunk hashes only)
   → 200 always (no contract break)
```

**No contract break on `/court-package`**: the response shape is purely additive. Old clients ignore the new fields; new clients render the merged-file row. Courts get a single-file artifact when one exists; the per-chunk attestation is always present.

**Snapshot invariant**: the DO reads its chunk list once at job start. New chunks arriving after `/render` is called do NOT appear in the merged file. The lock pinned what was preserved at that moment.

**Custody action vocabulary**: `footage_custody_log.action` is a free-text column (`flexcam.ts:38`). Existing values: `'locked'`, `'viewed'`, `'exported'`, `'delete_attempt'`. New values introduced by this PR: `'remux_queued'`, `'remux_complete'`, `'remux_failed'`. These are appended, not enumerated — no schema change.

---

## Error handling

### Server / Durable Object

| Failure | Response | Recovery |
|---|---|---|
| `remux_state` column missing on live D1 | `503 {code:'schema_drift', hint:'apply flexcam_remux_state migration'}` (mirrors ALPR `columnExists()` pattern) | Operator applies the migration directly to live `785de7ae` |
| Concurrent `POST /render/:id` for same id | Idempotent — same `idFromName('rmx-' + id)` resolves to the same DO instance. Second `enqueue()` is a no-op when state is already `'working'`; returns current state | None |
| Single chunk corrupt / mp4box parse failure | `<10%` of chunks → skip, log to custody. `≥10%` → fail with `'integrity_threshold_exceeded'` | Admin reviews custody; re-trigger via `POST /flexcam/render/:id` |
| R2 chunk fetch transient failure | 3× retry, 1s/2s/4s backoff inside chunk loop | Auto |
| R2 multipart upload failure mid-stream | Abort upload to free R2 space; `remux_state='failed'`, `remux_error='r2_upload:<reason>'` | DO retries up to attempt cap |
| DO alarm exception (uncaught) | Cloudflare auto-retries the alarm (platform contract) | Auto |
| Terminal failure after 3 attempts | `remux_state='failed'`, `remux_error=<human>`, custody `'remux_failed'`. Chunks intact in R2 | Admin re-triggers via `POST /flexcam/render/:id`; clears failure state |
| `mp4box.js` import failure (DO cold-start) | DO catches → `remux_state='failed'`, `remux_error='dependency_load'` | Re-trigger; if persistent, check Worker logs |

### Server / route handlers

| Endpoint | Failure | Response |
|---|---|---|
| `GET /trips/:tripId/manifest` | Trip not in user's org | `403` |
| `GET /trips/:tripId/manifest` | Trip doesn't exist | `404` |
| `GET /trips/:tripId/manifest` | Trip exists, zero ready chunks | `200 { clips: [], stillDownloading: N }` — client shows "no footage available yet" |
| `POST /court-package` | Request not locked | `409 {error:'Lock this footage as evidence before generating a court package'}` (existing, `flexcam.ts:208`) |
| `POST /court-package` | Always (when locked) | `200 {manifest, payloadHash, ...signed}` — manifest *additively* includes `merged_sha256` + `merged_url` when `merged_status='ready'`, omits them otherwise. **Status never changes based on remux state** — keeps existing contract for old clients |
| `POST /render/:id` | Not admin | `403` (existing `requireRole('admin')`) |
| `POST /render/:id` | No `downloaded` chunks | `409 {error:'No downloaded chunks'}` (existing, `flexcam.ts:137`) |
| `POST /render/:id` with `format='mp4'` | New / no prior remux | `202 {remux_state:'queued', merged_status:'queued'}` — enqueues DO |
| `POST /render/:id` with `format='mp4'` | Remux working | `202 {remux_state:'working', started_at}` — idempotent |
| `POST /render/:id` with `format='mp4'` | Remux ready | `200 {remux_state:'ready', merged_status:'ready', merged_r2_key}` |
| `POST /render/:id` with `format='mp4'` | Remux terminal failure | `200 {remux_state:'failed', error}` — admin clicks again to clear + retry |
| `POST /render/:id` with `format='ts'\|'fmp4'` | Existing path (unchanged) | `200 {merged_status:'ready'\|'unsupported'}` (existing) |

### Client

| Failure | Behavior |
|---|---|
| Manifest fetch fails (network / 5xx) | Player shows error + "Retry" button; auto-retry once after 5s |
| Single clip 404 / network error during playback | Skip to next clip, mark unplayable in timeline (red block), continue. **Never silently freeze** |
| Single clip plays but decoder rejects | Same — skip + mark. Console log includes `seq` |
| Network loss mid-playback | Native `<video>` pauses; resume button appears; retry-fetches active clip on click |
| User leaves page while remux is working | Job continues server-side; re-entry shows current `remux_state` |
| Stale player code in service worker | Mitigated by the `rmpg-flex-<sha>` template substitution at build time (`sw.js:1282`). No manual bump needed in this PR; CLAUDE.md gotcha #6 is stale on this point. |

### Decision: 10% corruption threshold

A few corrupt segments in a 45-clip trip should NOT kill the whole evidence package — the rest is still court-valid, and the custody log records exactly which segments were skipped. If half the trip is corrupt, the merged file becomes misleading evidence. **10%** is the threshold. (Can be tightened to 0% or relaxed to 25% post-deployment; configurable via a `flexcam_corruption_threshold` row in `system_config` is a Phase 2 add.)

### Cross-cutting

- **Auth**: `/manifest` reuses existing `/api/flexcam` auth middleware (JWT, same role gate). Court-package already requires admin.
- **Audit**: every remux state transition writes to `footage_custody_log` (existing from migration 0119). No new audit surface.
- **No silent failures**: every failure mode either surfaces in UI, logs with recoverable diagnostic, or is idempotently retryable. No empty catches. Per `[[pr-review-toolkit:silent-failure-hunter]]` discipline.

---

## Testing

### Server-side unit tests (vitest)

| File | Coverage |
|---|---|
| `tests/footage/concat.test.ts` (extend existing if present, else new) | Tests for the new `buildPlayerManifest()`: empty chunks, contiguous, boundary gap >500ms, multi-channel filter, out-of-order DB → sorted by seq, mixed status → only `'downloaded'` in `clips`, rest in `stillDownloading`. ~12 cases |
| `tests/footage/remuxMp4ToFmp4.test.ts` | Tests for the new `remuxMp4ToFmp4()` in concat.ts. Pure chunk-ordering. Streaming sha256 vs `crypto.subtle`. Corruption threshold (mp4box.ts mocked). One real-fixture test: 2-clip ~30 KB mini-trip under `tests/fixtures/footage/` → output parses as valid fMP4 via a non-mocked mp4box pass |
| `tests/footage/mp4box.test.ts` | The thin lib wrapper. Mostly type-narrowing + error-translation tests; the heavy lifting is the real-fixture test above |
| `tests/footage/flexcamRemuxDO.test.ts` | DO via Miniflare. enqueue sets state + schedules alarm. alarm reads chunks, calls remux (mocked), updates D1. Failure: attempts++, retry alarm with backoff. Terminal: state='failed'. Re-enqueue while 'working' → no-op |
| `tests/footage/flexcamRoute.test.ts` (extend) | Manifest endpoint: auth (401/403), not found (404), empty (200), happy path. Court-package state machine: queued → working → ready via mocked DO |

### Client-side tests (vitest + RTL)

| File | Coverage |
|---|---|
| `client/src/hooks/useFlexCamManifest.test.tsx` | Initial load. Polling while `stillDownloading > 0`. Stops on zero. Error state. |
| `client/src/components/flexcam/TripTimeline.test.tsx` | Pure layout math. Clip + gap blocks at correct percentages. Click → `(clipIndex, offsetMs)` across single-clip, multi-clip, gap-spanning hit-tests |
| `client/src/components/flexcam/FlexCamTripPlayer.test.tsx` | Renders timeline + active video. `ended` → swap. Gap → pill + advance. Click on timeline → src swap + seek. Empty manifest → "no footage". Clip 404 → mark unplayable + advance |

### TDD discipline

Per `[[superpowers:test-driven-development]]` and the Phase 2 commit pattern (PR #1261). Each pure helper gets tests first, then implementation. DO and route handlers get contract tests written first.

### Manual / live verification (after deploy)

| Step | Expected |
|---|---|
| Trigger a real trip on a FlexCam-mapped unit, close it | `unit_trips` row closes; `enqueueFootage` creates request + chunks; cron pulls chunks to R2 |
| `GET /api/flexcam/trips/:tripId/manifest` from browser | JSON with clips, gaps, totals; `stillDownloading: 0` once cron finishes |
| Open `/flexcam/trip/:tripId` | Player loads first clip; on `ended`, jumps to next within ~50ms; gaps visible |
| "Lock as evidence" | `evidence_locked=1`, evidence_number assigned, custody row `'locked'` |
| Click "Build merged file" (admin) → `POST /render/:id` (format=mp4) | `202 {remux_state:'queued'}`; UI shows "Remux: queued → working → ready" pill (~30s–2min) |
| Download merged MP4 from `GET /continuous` once `merged_status='ready'` | Plays in QuickTime, VLC, Chrome, Safari without re-encoding |
| Click "Generate court package" → `POST /court-package` | `200`; manifest includes per-chunk sha256s AND `merged_sha256`/`merged_url`; Ed25519 signature valid |
| `footage_custody_log` for the request | Rows in order: `locked`, `remux_queued`, `remux_complete`, `exported` |

Per `[[superpowers:verification-before-completion]]`, PR is not "ready" until all of the above pass. Live verification is operator-gated on a real unit; steps go in the PR description.

### What's NOT tested (and why)

- **`mp4box.js` itself** — third-party with its own tests.
- **Cloudflare DO alarm semantics** — platform contract; trusted.
- **Real ClearPath endpoint** — operator-blocked spike, separate concern.
- **30-min trip / 45-segment performance** — covered by manual live verification, not unit. If real-world remux blows the DO CPU budget, follow-up moves it to a queue + worker pattern.

### CI gates that must pass

- `npm run typecheck` (Worker)
- `cd client && npx tsc --noEmit`
- `cd client && npx vitest run`
- `cd client && npx vite build`

Plus locally: `npx vitest run tests/footage/` for the new server suite.

---

## Phasing & PR shape

Single PR. The work is small enough not to warrant a stack:

1. **Migration + schema reconciler** — next-free integer prefix + `columnExists()` guard in `flexcam.ts`.
2. **Extend `concat.ts` + new `mp4box.ts` + tests first** — `buildPlayerManifest()` and `remuxMp4ToFmp4()` get unit tests before implementation. `mp4box.ts` is mocked at the `remuxMp4ToFmp4` boundary; the real fixture test exercises the lib end-to-end on a tiny 2-clip sample.
3. **Manifest route + route tests** — green before client code.
4. **`/render` MP4 branch change + DO + DO tests** — Miniflare integration with the route.
5. **`/court-package` additive enrichment** — read `merged_status`; add `merged_sha256`/`merged_url` to the manifest when ready. One-line behavioral change + manifest-builder test.
6. **Client components, hook, page** — bottom-up: hook → timeline → switcher → player → page.
7. **Wrangler migration + DO binding** — last, so the prefix chain is unambiguous.
8. **SW** — no manual bump required (templated `<sha>` substitution). Verify at implementation time.
9. **PR description** with the manual verification checklist above.

---

## Out of scope / deferred

Listed so we don't drift:

- **Client-side "Download as single file"** — the optional 4th layer using mp4box.js in-browser. Can be added later if operator demand exists. Skipped now to keep the surface tight.
- **Multi-channel merged export** (front + interior in one file) — exporter picks `front` only by default. Multi-channel is a `?channels=front,interior` param for a follow-up.
- **`flexcam_corruption_threshold` config row** — hard-coded at 10% for now; config row in Phase 2.
- **Map-synced playback** — separate FlexCam Phase 3 item per `[[project-flexcam-footage-program]]`.
- **In-video redaction at trip level** — per-clip is shipped; trip-level is its own design.
- **Audio mux** — Phase 2 evidence flow was video-only; same here.

## Retirement (companion concern — not in this PR)

The original session prompt also asked to retire outdated modules. That work is **deferred to a companion PR** authored separately to keep this one focused. Targets identified:

- **D1 `8893480a` (abandoned `rmpg-flex-db`)** — code references are comments only; binding is gone. Cleanup = scrub stale comments in `src/routes/offline.ts:73`, `TRIAGE.md:9`, `wrangler.toml:38`, `migrations/0037_offline_sync_table_backports.sql:5`, `CLAUDE.md:18`, then operator deletes the DB from the Cloudflare dashboard.
- **Genuinely dead client surfaces / server stubs** — requires a separate grep-driven audit (e.g. `stubs.ts`, unmounted Records sub-pages). `FirecrawlTab.tsx` is **not** dead — `CrmPage.tsx` imports it.

Companion PR is a one-session follow-up after this one merges.

---

## Risks & open questions

| Risk | Mitigation |
|---|---|
| `mp4box.js` Worker bundle size pushes us over the Worker size limit | Pre-implementation precondition: measure with a stub build before writing remux logic. If over budget, push remux client-side via the 4th-layer fallback and reconsider scope. |
| ClearPath occasionally emits non-standard MP4 boxes that mp4box.js can't parse | First implementation surfaces parse errors per chunk and tolerates ≤10%. If empirically common, write a small box-normalizer pass. |
| DO storage cap (1 MB) — we store small state objects, but bug could blow it | Keep DO storage to a single `{state, requestId, attempts, lastError}` blob. No chunk-level state in DO; that lives in D1. |
| Two playback modes (manifest player + single-file MP4) is twice the UX surface | Single-file is admin/court only; daily users see only the manifest player. UX risk is bounded. |

## References

- `[[project-flexcam-footage-program]]` — Phase 1/2 history + deferred items
- `[[project-dashcam-redaction-studio]]` — why `@ffmpeg/ffmpeg@0.12.x` is broken in this repo (worker-loader bug)
- `wrangler.toml` — DO migration prefix-chain comments at lines 177, 191-194, 199-202; current tags: `v1`, `v1-pdftools`, `v2-voicehub`, `v3-alerthub`, `v4-deepresearch`
- `CLAUDE.md` gotcha #5 (live D1 drift). Note: gotcha #6 (manual SW `CACHE_NAME` bump) is **stale** — `sw.js:1282-1283` is now stamped at build time by the `stamp-sw-version` Vite plugin
- `migrations/0118_flexcam_footage.sql`, `0119_flexcam_evidence.sql` — current schema
- `src/utils/footage/clearpathSource.ts:8` — `MAX_CHUNK_SECONDS = 40`
- `src/utils/footage/captureOrchestrator.ts:81` — `enqueueFootage()` entry point
- `src/utils/tripStore.ts:88-156` — trip close lifecycle + auto-capture trigger (`reason: 'trip_auto'`)
- `src/utils/footage/concat.ts` — existing `buildManifest()` + `concatToR2()` (54 lines today; this PR extends to ~270 lines)
- `src/utils/footage/splitWindow.ts` — existing `detectGaps()` we reuse
- `src/routes/flexcam.ts:118-228` — existing `/continuous`, `/render`, `/court-package`, lock endpoints
- `src/utils/pdfSign.ts:signTriple()` — Ed25519 signer reused by `/court-package`
