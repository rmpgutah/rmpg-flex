# ALPR + Full-Drive Capture Program — Design

**Date:** 2026-06-15
**Status:** Approved (design); spec pending user review
**Scope decision:** Attempt all 5 workstreams this session. W2/W4 are built to the
best-guess vendor contract now and repaired after the operator runs the W1 spike.

## Goal

Two operator goals, one program:

1. **ALPR — scan and capture data faster and more accurately.** Make full-drive
   footage actually get plate-scanned (today it no-ops on video), and sharpen the
   live "while driving" patrol scanner.
2. **ClearPath GPS — capture the full drive.** Request every ~40-second segment of
   travel, download all of it, and retain it for 4 months (auto-purge non-evidence
   at 120 days; locked evidence never purged).

### Operator-confirmed parameters
- **ClearPath pull:** verify the on-demand contract with a live spike *before*
  trusting the pull pipeline.
- **Drive scope:** every on-duty trip, all camera-equipped vehicles, **road camera
  only**. Cabin camera pulled only on critical events (existing `autoPreserve`).
- **ALPR priority:** both — scan full-drive footage for plates **and** sharpen the
  live patrol scan.
- **Retention:** guarantee 4 months, then auto-purge routine footage at **120 days**;
  `evidence_locked` footage is never purged.

## Current state (verified on disk 2026-06-15)

- **Footage pipeline exists and is sound.** `FootageSource` (`src/utils/footage/types.ts`)
  is the vendor seam: `requestWindow()` splits a window into ≤40s chunks → fires vendor
  requests → `pollChunk()` watches availability → the per-minute cron downloads each
  into R2 (`flexcam/trips/`). Evidence lock/custody/court-package already built
  (`src/routes/flexcam.ts`, `src/utils/footage/evidence.ts`).
- **Trigger is too narrow.** `src/utils/tripStore.ts:100` only auto-captures trips
  tied to a dispatched call (`closed.call_id || closed.call_number`).
- **Length capped at 60 min.** `captureOrchestrator.ts` `DEFAULT_CHUNK_CAP = 90` (×40s).
- **`requestWindow()` fires all vendor POSTs synchronously at enqueue time** — fine for
  90 chunks, fatal for a 12h shift (~1,080 subrequests in one invocation).
- **Footage ALPR no-ops on video.** `footageAlpr.ts` bails on non-image chunks — a
  Worker has no ffmpeg/canvas to decode an MP4 frame. The persistence machinery
  (screen → upsert `vehicles_records` → `vehicle_sightings` → hit `notifications`)
  is wired and waiting for *image* input.
- **No footage retention.** Radio recordings purge on a schedule (`purgeOldRecordings`);
  dashcam/FlexCam R2 objects are neither guaranteed-kept nor purged.
- **On-demand endpoint `/v2.0/media/request` is UNVERIFIED.** `clearpathSource.ts:6`:
  "Confirm against Task 0 spike findings before production use." Only auto-uploaded
  *event* clips have ever been observed — arbitrary past-segment retrieval is unproven.
- **Cron:** `wrangler.toml` `crons = ["0 */4 * * *", "* * * * *"]`. Footage poll runs
  on the per-minute tick (`maybeRunFootagePoll`), gated by `flexcam_enabled`.

## Workstreams

### W1 — Verification Spike (ships first; operator triggers)
- **Route:** `POST /api/flexcam/diagnose`, admin-gated, read-only.
- **Behavior:** resolve the ClearPath client → list camera asset(s) → attempt
  `POST /v2.0/media/request` for a tiny recent window (one 40s slice ~10 min ago) →
  poll `/v2.0/media/data` for that window → report **raw response shapes** with secrets
  and base64 stripped.
- **Must answer:**
  1. Does on-demand `media/request` return a usable handle (requestId), an error, or 404?
  2. Does `media/data` return arbitrary past segments, or only event clips?
  3. Is there a per-object **still image** (`thumbnailUrl`/snapshot)? → decides W4 auto-tier.
  4. Any rate-limit / quota signals.
- **Safety:** tiny window only; writes nothing to D1 except an optional diagnostic log.

### W2 — Full-drive pull
- **Trigger broadening** (`tripStore.ts`): fire `enqueueFootage` for **every non-noise
  closed trip** that maps to a camera (the noise discard already runs before this),
  `channels: ['outside']`, `reason: 'trip_auto'`. Gated behind new config flag
  **`flexcam_full_drive`** (default off until spike confirms). Call-tied capture remains
  a subset and keeps working when the flag is off.
- **Cron-paced request/download** (`captureOrchestrator.ts`): introduce chunk state
  **`pending_request`**. `enqueueFootage` no longer fires vendor calls — it writes the
  request row + chunk rows in `pending_request`. The per-minute cron runs two bounded
  passes: (1) fire ≤`MAX_REQUESTS_PER_RUN` (≈30) vendor requests for `pending_request`
  chunks → set `vendor_media_id` + status `requested`; (2) existing poll→download for
  `requested` chunks. New chunk lifecycle: `pending_request → requested → downloaded|missing`.
- **Lift the cap:** `DEFAULT_CHUNK_CAP` → configurable `flexcam_max_chunks_per_request`
  (default ~1,100 ≈ 12h).
- **Cost note (honest):** full-drive road-cam ≈ up to ~1,080 requests/vehicle/12h-shift.
  Flag-gated + per-run batch caps bound the blast radius; the spike informs real limits.

### W3 — 4-month retention
- **Purge sweep** on the 4-hourly cron. Config `footage_retention_days` (default **120**).
  Delete R2 objects + `footage_chunks` + `footage_requests` rows older than the window
  **where `evidence_locked != 1`** (NULL-safe). Extend the same evidence-safe purge to
  `dashcam_videos` event clips. Batch-limited per run (mirror `purgeOldRecordings`).
- **Pure helper** + cron wiring; unit-tested cutoff/selection logic.

### W4 — Footage ALPR (scan the full drive for plates)
- **Automatic (server-side):** if the spike confirms a per-segment still/thumbnail,
  ALPR that frame per chunk via `runAlprVehicleCapture` → existing `footageAlpr.ts`
  persistence. No new infra. Coverage = 1 frame/segment.
- **High-coverage (client-side, opt-in):** a "Scan footage for plates" action in the
  FlexCam viewer reuses the redaction studio's **ffmpeg.wasm** to decode a chunk into
  N JPEG keyframes, POSTed to `/api/alpr/capture` (multi-frame → `trustScore` consensus
  → genuine accuracy gain). Keyframe count/fps configurable.

### W5 — Live patrol scan (sharper real-time)
On the existing continuous scanner (`PlateLogPage` / patrol scan, reuses `/api/alpr/capture`):
- **Adaptive cadence** — scan faster at speed, back off when stopped.
- **Client pre-filter** — only spend a Roboflow credit on frames likely to hold a plate.
- **Multi-frame consensus** before a hit fires — kill false single-read "100%" alerts
  (route reads through `trustScore`).
- **Tighter dedup** window.

## Architecture / interfaces

- **`FootageSource` stays the vendor seam.** W2's pacing change lives in
  `captureOrchestrator.ts` (the orchestrator), not in the source — the source keeps
  `requestWindow`/`pollChunk`. After the spike, only `clearpathSource.ts` (the contract)
  changes if needed; the orchestrator and route are contract-agnostic.
- **Config flags** (all in `system_config`, category `integrations`): `flexcam_full_drive`,
  `flexcam_max_chunks_per_request`, `footage_retention_days`. Read at runtime; safe defaults.
- **Pure helpers, unit-tested** (vitest under `tests/`): chunk-pacing selection, retention
  cutoff/selection, patrol-scan cadence/consensus.

## Error handling
- Spike: never throws to the client; reports per-step success/failure + raw shapes.
- W2: vendor request/download failures are per-chunk and bounded (`attempts`, `MAX_POLL_ATTEMPTS`);
  a failed request pass doesn't abort the download pass. All wrapped so the cron loop never crashes.
- W3: purge is best-effort per object; an R2 delete failure logs and continues; never deletes locked.
- W4 automatic: best-effort, never throws (caller stamps `alpr_status`); client tier surfaces errors in UI.
- W5: a failed frame POST is dropped silently; the scanner keeps running.

## Testing
- Worker: vitest for the new pure helpers (pacing, retention, cadence/consensus). No live
  ClearPath calls in tests. Typecheck (`npm run typecheck`).
- Client: `cd client && npx tsc --noEmit` + `npx vitest run` + `npx vite build`.
- Live verification is the W1 spike itself (operator-run) + browser eyeball of the FlexCam
  viewer "scan footage" action.

## Deploy / rollout
- Ship via feature branch → `gh pr create` (PR flow, not direct push). PR runs `pr-tests.yml`;
  merge triggers `deploy.yml`.
- Bump `client/public/sw.js` `CACHE_NAME` (client changes in W4/W5).
- New `system_config` rows are runtime-reconciled; the chunk-state column
  (`pending_request`) ships via a migration **and** is reconciled at boot
  (`continue-on-error` deploy apply — apply DDL to live `785de7ae` after merge).
- All flags default safe: `flexcam_full_drive` off until the spike is run.

## Out of scope (this program)
- Edge/Jetson keyframe ALPR (hardware path; the `edge/` runner).
- Stitching chunks into one continuous video (already a separate concern; existing
  `concat.ts` / client ffmpeg path unchanged).
- Cabin-camera full-drive capture (event-only by operator decision).
- Roboflow video-native inference (possible W4 follow-up if the spike + thumbnails fall short).

## Risks
- **Vendor contract unknown** until W1 runs — the primary risk; mitigated by flag-gating
  W2 and a client-side fallback for W4.
- **Cost** — full-drive pull + per-segment ALPR consumes ClearPath API + R2 + Roboflow
  credits at fleet scale; bounded by flags, batch caps, road-cam-only, and the 120-day purge.
- **Worker limits** — addressed by the cron-paced request/download restructure.
