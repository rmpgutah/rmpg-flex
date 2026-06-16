# ALPR + Full-Drive Capture Program — Design

**Date:** 2026-06-15
**Status:** Approved (design); spec pending user review
**Scope decision:** Attempt all **8 workstreams** this session (grew from 5 via operator
refinement: + continuous video/markers, + Forensic Playback overlay, + trained plate
detector). W2/W4 are built to the best-guess vendor contract now and repaired after the
operator runs the W1 spike. W8 (model training) is an async parallel track kicked off
first; W7 ships degraded-to-heuristic and auto-upgrades when W8's endpoint is live.

**Recommended build sequence:** W8 model training (kick off first, runs async) →
W1 spike + pure helpers (shared `trustScore`/turn-detection/retention helpers) →
W3 retention + W2 full-drive pull (server) → W6 continuous video + markers →
W4 footage ALPR → W7 forensic overlay (wires to W8 when ready) → W5 live patrol scan.
This is a multi-PR program; ship in reviewable slices, not one mega-PR.

## Goal

Two operator goals, one program:

1. **ALPR — scan and capture data faster and more accurately.** Make full-drive
   footage actually get plate-scanned (today it no-ops on video), sharpen the live
   "while driving" patrol scanner, and upgrade the Forensic Playback viewer's yellow
   reticle into a real detection-driven capture point (closest-vehicle lock, exact
   plate localization via a trained detector, dynamic red/yellow/green read state, and
   multi-frame consensus for accuracy).
2. **ClearPath GPS — capture the full drive.** Request every ~40-second segment of
   travel, download all of it, and retain it for 4 months (auto-purge non-evidence
   at 120 days; locked evidence never purged).
3. **One continuous full-drive video (no length limit), with a marked timeline.**
   Present the 40s clips as a single seamless video of any length; pin camera-triggered
   driving-violation events and turns/direction-changes on the timeline.

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
- **Remove the length cap (operator: "no time limits on max time of video"):**
  delete `DEFAULT_CHUNK_CAP`. A drive of any length is captured; the cron-paced
  request/download drains it over successive ticks. An optional safety-ceiling config
  `flexcam_max_chunks_per_request` defaults to **0 = unlimited** (operator can set a
  ceiling later if cost demands).
- **Cost note (honest):** full-drive road-cam ≈ ~90 requests/hour/vehicle (unbounded
  by shift length). Flag-gated + per-run batch caps bound per-tick blast radius; the
  spike informs real vendor limits.

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

### W6 — Continuous full-drive video + timeline markers
The operator goal: the 40s clips presented as **one full video, no length limit**, with
the camera-triggered violations and turns pinned on the timeline.
- **Seamless continuous playback (default, unbounded):** the FlexCam viewer plays the
  ordered downloaded chunks back-to-back as one video (HLS-style ordered-segment player).
  No giant-file merge, so length is genuinely unlimited. Driven by the existing
  `buildManifest()` ordered-chunk list + per-chunk stream endpoint.
- **On-demand true merge (evidence export):** `POST /render/:id` produces one physical
  file via `concatToR2()` (streaming, length-safe) for TS/fMP4; for standard MP4 the
  client ffmpeg.wasm path merges. Used for court export, not routine playback.
- **Marker layer** — a new `footage_markers` table
  (`footage_request_id, ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir`):
  1. **Event tags (camera-triggered):** fetch the ClearPath event list across the drive
     window, classify each via `classifyDrivingEvent()` (`hard_brake / fcw / ldw /
     hard_turn / …` + severity). This is the "camera triggered for a ~20s driving-violation
     observation" tag, positioned at the event timestamp's offset within the drive.
  2. **Turn pins (GPS-derived, both):** a pure helper detects direction changes from the
     GPS track (bearing delta over a short window past a threshold) → a pin per turn with
     `turn_dir` (left/right) + `heading_deg`. Turns the camera *also* flagged as a hard-turn
     event are distinctly marked (`kind='camera_hard_turn'`) vs. plain GPS turns
     (`kind='gps_turn'`).
- **GPS source:** the `gps[]` arrays carried on ClearPath media objects for the window;
  spike-gated fallback to the trip's stored GPS track if on-demand segments omit `gps`.
- **Rendering:** markers returned by `GET /footage/:id` (alongside the manifest) and drawn
  as pins on the viewer's scrubber; clicking a pin seeks the continuous player to that offset.
- **Pure, unit-tested helpers:** GPS turn detection (bearing delta → turn_dir/degrees) and
  marker offset positioning (ts → offset within the drive, gap-aware).

### W7 — Forensic Playback overlay upgrade (the dashcam viewer)
Operator fixes to `client/src/components/ForensicDashcamPlayer.tsx` + helpers:
1. **Reticle locks to the closest vehicle.** `primaryTrack()`
   (`client/src/utils/vehicleTracker.ts`) currently blends `area + centrality +
   lowness + stability`. Re-weight so **closest dominates** (largest/lowest box wins;
   keep light stability damping to stop jitter). The yellow focus reticle follows that
   vehicle every frame.
2. **LP capture point sits on the actual plate.** The reticle's plate point is driven by
   the **trained plate-detection model (W8)** when its box is available, falling back to
   the `plateRegion(bbox)` heuristic (lower-center of the closest vehicle) until/if the
   detector returns nothing. Graceful upgrade — the viewer ships working on the heuristic
   and sharpens to exact boxes once W8 is live.
3. **Dynamic reticle color + multi-frame consensus.** Reticle color = read state:
   **red** = bad/below-trust read, **yellow** = capturing/in-progress, **green** =
   accepted (≥0.85 derived trust). While capturing, grab **N frames** of the plate region,
   run ALPR on each, and combine via `trustScore()` consensus (agreement across frames
   raises trust above the single-read cap) → drives the color and the stored read. Replaces
   today's single-frame `rescanPlate`.
- Pure, unit-tested helpers: closest-vehicle selection weighting, reticle-color state
  machine (reads → red/yellow/green), multi-frame read consensus (shared with W4/W5).

### W8 — Trained plate-detection model (returns a real plate box)
The engine behind W7's exact reticle. Cloudflare Workers AI has no stock plate-localization
model and can't host a custom YOLO, so:
- **Train on Roboflow.** Fork a high-quality Universe license-plate **detection** dataset
  (candidates confirmed available: `cardetect-iyapw/anpr-tdrid` ~10k labeled images, single
  `License_Plate` class; `testworkspace-7jvng/license-plate-detection-itypr` ~5.1k, trained
  v9) into our `rmpg-utah` workspace → generate a version → train a detection model. No
  from-scratch labeling. (Operator does any visual review/label-judging per Roboflow's
  human-in-the-loop split; Claude drives the API/automation.)
- **Serve via Roboflow hosted inference** (fast detection endpoint returning plate bboxes +
  confidence), **proxied by a new Worker route `POST /api/alpr/detect-plate`** so the
  `ROBOFLOW_API_KEY` never reaches the client. The viewer calls it throttled (not every
  frame — on capture + periodic refresh) to snap the reticle.
- **Honest framing:** "Cloudflare-side" = trained on Roboflow, proxied through the Cloudflare
  Worker. Latency: training is asynchronous (minutes–hours) + may want a label review pass,
  so W8 runs as a **parallel track kicked off first**; W7 ships degraded-to-heuristic and
  auto-upgrades when the model endpoint goes live.

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
- Cabin-camera full-drive capture (event-only by operator decision).
- Roboflow video-native inference (possible W4 follow-up if the spike + thumbnails fall short).

## Risks
- **Vendor contract unknown** until W1 runs — the primary risk; mitigated by flag-gating
  W2 and a client-side fallback for W4.
- **Cost** — full-drive pull + per-segment ALPR consumes ClearPath API + R2 + Roboflow
  credits at fleet scale; bounded by flags, batch caps, road-cam-only, and the 120-day purge.
- **Worker limits** — addressed by the cron-paced request/download restructure.
