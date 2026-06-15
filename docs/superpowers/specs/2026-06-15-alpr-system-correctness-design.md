# ALPR System Correctness & Wiring — Design (Spec 1 of 2)

**Date:** 2026-06-15
**Status:** Approved scope, pending spec review
**Author:** Claude (Opus 4.8) with Christopher Zamora
**Companion spec:** Spec 2 — FlexCam full-trip revival (separate doc, spike-first, sequenced after this)

## Goal

Make the RMPG Flex ALPR system fully functional and *accurate* across every capture
surface: honest plate-read confidence everywhere, no silently-failed writes, correct
device→unit wiring, and no dead UI features. Scope is **correctness + wiring + UX of the
existing ALPR pipeline** — not new capture modalities.

The five capture surfaces share one trust/screening core:

| Surface | Entry point | Engine |
|---|---|---|
| On-scene / mobile | `POST /api/alpr/capture` → `finalizeCapture` (`src/routes/alpr.ts`) | Roboflow workflow |
| Patrol Scan (continuous) | same `/capture` (no `call_id`) | Roboflow workflow |
| ClearPath dashcam still-scan | `alprDashcamClip` (`src/utils/clearpathAlpr.ts`) | Workers AI (by design: free/fast) |
| FlexCam footage chunk | `persistVehicle` (`src/utils/footage/footageAlpr.ts`) | Roboflow workflow |
| Edge device (Jetson) ingest | `POST /api/alpr/edge` block (`src/routes/alpr.ts`) | edge-supplied |

The shared trust seam is `trustScore()` / `captureTrust()` over `src/utils/plateTrust.ts`.

## Verified state (what is and isn't broken)

Investigated 2026-06-15 against code + live D1 (`785de7ae`). Three agent-reported
"CRITICAL" findings were **false** and are explicitly discarded:

- `/api/alpr/image/*` route — **exists** (`src/routes/alpr.ts:977`).
- `driving-events` router — **mounted** at `/api/driving-events` (`src/routesConfig.ts:543`).
- `/api/driving-events/:id/stream` — **exists + mounted** (`src/routes/drivingEvents.ts:338`).

Root cause of the confusion: routes mount via `src/routesConfig.ts`, not `src/index.ts`.

**By design, not a defect:** the dashcam path uses Workers AI, not Roboflow (free/fast vs.
credits). Only the `clearpathAlpr.ts` header comment overstates it — a doc fix, not code.

### Confirmed defects

**D1 — Footage path leaks raw model confidence (accuracy).**
`src/utils/footage/footageAlpr.ts:124` gates `accepted` on `v.confidence` (raw Roboflow
`field_confidence.plate`) and writes that raw value into `vehicle_sightings.confidence`
(~line 135). It never calls `trustScore()`. A single weak Roboflow read self-reporting 0.95
is auto-accepted and displayed as trustworthy — the exact "false 100%" class of bug, still
live on this path. On-scene and dashcam correctly hard-cap lone reads at 0.84.

**D2 — Edge-device sighting stores raw confidence (accuracy).**
`src/routes/alpr.ts:1091` writes raw `rec.plate_confidence` into the sighting even though a
derived `trust.trustScore` is computed ~line 1062 and correctly used for the
`vehicle_capture_photos` package. The sighting diverges from the package.

**D3 — Silent success on `/accept` and `/verify` (working).**
`src/routes/alpr.ts` `/capture/:id/accept` (~769–771) and `/capture/:id/verify` (~879–883)
wrap the authoritative `persistConfirmedVehicle()` / record write in try/catch, log, then
**unconditionally** stamp `review_status='confirmed', accepted=1`. If the write throws, the
officer sees "Verified" but no `vehicles_records` / `vehicle_sightings` / `call_vehicles`
row was created — a confirmed capture with no record behind it.

**D4 — `/capture` silent partial success (working).**
`src/routes/alpr.ts` returns `success:true` even when the R2 image store failed
(~519–523, leaves an `image_key` that 404s) or the `field_photos` link failed (~529–533,
photo missing from the call gallery). No warning reaches the client.

**D5 — Dead admin features / unmapped device (wiring + working).**
`client/src/pages/admin/AdminClearPathGpsTab.tsx` never calls three working endpoints:
`/clearpathgps/auto-map-devices`, `/clearpathgps/enable-media`, `/clearpathgps/scan-alpr-now`.
And `PSO Sierra 19` (`cp160817`, assetId `136022`) has `unit_id=NULL` on live, so its 179
captures + 100 events `LEFT JOIN units` to nothing (no call-sign / officer / map / MDT
affiliation; hit notifications carry a null entity).

## Design — 4 pillars

### Pillar 1 — Honest confidence on every path
Single invariant: **no capture path writes a raw model confidence; all write a derived
`trustScore`.** Currently true for on-scene + dashcam; this pillar extends it to footage and
edge.

- **Footage (`footageAlpr.ts`):** in `persistVehicle`, compute
  `const trust = trustScore({ reads: [v.plate], modelPct: v.confidence })`. Gate `accepted`
  on `trust.trustScore >= ALPR_ACCEPT_CONFIDENCE` (a lone read hard-caps at 0.84 → never
  auto-accepts, which is correct). Write `trust.trustScore` into `vehicle_sightings.confidence`.
  Preserve the existing "always screen / always log sighting / upsert master only on accept"
  shape. Mirror the on-scene `PACKAGE_GATE` (0.80) decision on derived trust if a package row
  is created.
- **Edge (`alpr.ts` edge block):** write the already-computed `trust.trustScore` into the
  sighting instead of raw `rec.plate_confidence`.
- **Lock the invariant:** a unit test over `plateTrust` asserting (a) a single read with
  `modelPct: 0.99` yields `trustScore <= 0.84`, and (b) footage/edge persistence helpers, given
  a lone high-model-pct read, produce a sub-accept-gate value. Refactor the per-vehicle derive
  into a tiny shared helper if it reduces duplication across footage/edge/on-scene; otherwise
  call `trustScore` inline. Keep helpers pure and unit-tested.

### Pillar 2 — No silent success
Make a failed authoritative write visible without losing the capture-review state.

- `persistConfirmedVehicle()` and the `/accept`/`/verify` handlers return a structured
  `{ persisted: boolean, warning?: string }`. On failure: still record the review decision,
  but set `review_status='confirmed_unlinked'` (new sentinel value — no schema change, it's a
  free-text column) instead of `'confirmed'`, write an `audit_log` row, and return
  `{ success: true, warning: 'Vehicle record was not created — review and retry.' }`.
- `/capture`: include `image_stored` and `field_photo_linked` booleans + a `warnings[]` array
  in the response when R2 or field-photo writes fail (no longer an unconditional clean success).
- **Client:** `PlateLogPage` / `FieldCameraPage` / review queue surface the warning (toast +
  a "record not saved" chip) instead of a green "Verified". Distinguish "no readable plate"
  from "read failed" in the capture toast.

### Pillar 3 — Wiring + dead admin features
- **`AdminClearPathGpsTab.tsx`:** add three buttons wired to the existing endpoints —
  "Auto-map dashcam devices" (`/auto-map-devices`), "Enable dashcam ALPR" (`/enable-media`),
  "Scan ALPR now" (`/scan-alpr-now`) — each with loading/result state matching the existing
  `handleSyncNow` pattern.
- **Unmapped-device UX:** for any mapping row with `unit_id=NULL`, show an amber "Not linked
  to a unit" chip and an inline unit picker (reads the existing units list) that POSTs to
  `/clearpathgps/mappings` to bind it. (User deferred the live binding to the UI — this is how
  they'll do it.)
- **New-event correctness:** once a device is mapped, new `dashcam_events` / captures already
  inherit `unit_id`. Add a lightweight backfill endpoint `POST /clearpathgps/mappings/:id/relink`
  that stamps `unit_id` onto that device's existing NULL-unit `dashcam_events` rows, surfaced as
  a "Link past events" action next to the picker. Bounded UPDATE, idempotent.

### Pillar 4 — Visibility check (light)
Confirm dashcam ALPR reads reach dispatch/officers via the existing
`/api/driving-events/plate-history` surface and its client page. If a `source`/device filter is
missing for browsing dashcam-sourced reads, add that filter only. No new pages.

## Out of scope (follow-ups, not built here)
- FlexCam full-trip revival → **Spec 2** (spike-first on the ClearPath footage-request endpoint).
- Never-built crop-upload (`/capture/:photoRowId/photos`) and model-management
  (`/alpr/models`) endpoints — leave as-is or remove in a separate cleanup.
- Roboflow-enriching the dashcam path (make/model/damage) — intentional architecture; revisit
  only if the operator wants paid enrichment on passive reads.

## Data / migration
None. Every column used already exists (`alpr_captures.confidence`/`plate_confidence`,
`vehicle_sightings.confidence`, `cpg_device_mappings.unit_id`, `dashcam_events.unit_id`).
`review_status` is free-text, so `'confirmed_unlinked'` needs no DDL.

## Testing
- Worker: vitest over `plateTrust` invariants + new pure helpers (`npx vitest run`). No
  Worker route suite exists yet; add smoke-level pure-function tests for the persistence
  decision logic where extracted.
- Client: `cd client && npx vitest run` + `npx tsc --noEmit`.
- Manual: admin tab buttons against live (test-connection / scan-alpr-now return JSON);
  confirm a low-confidence footage read no longer auto-accepts.

## Delivery
Isolated worktree (already on `claude/unruffled-hoover-21b03c`). TDD. Ship as a PR off
`origin/main` per the project's PR-flow rule; bump `client/public/sw.js` `CACHE_NAME`. No
migration to apply to live D1.
