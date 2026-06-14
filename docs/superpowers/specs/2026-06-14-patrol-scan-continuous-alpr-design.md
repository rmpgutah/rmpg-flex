# Patrol Scan — Continuous "While Driving" ALPR

**Date:** 2026-06-14
**Status:** Approved (design)
**Author:** Claude (with Christopher Zamora)

## Problem

ALPR exists today but **every capture path is manual single-shot** (phone
shutter, file picker) or a server-side cron poll over already-recorded media.
Nothing captures continuously while an officer is driving. The Jetson edge
runner that is *meant* to do continuous capture is scaffold-only (stubs).

Goal: make ALPR run continuously while driving, using hardware the officer
already has — the phone in the dashboard mount — and verify a live capture
against the deployed endpoint.

## Decisions (locked with operator)

- **Capture source:** phone in the mount. No new device, ships this session.
- **Cadence:** grab a frame every **~4 s**.
- **Dedup:** suppress re-logging the same plate for **5 minutes**.
- **Hit alert:** audible (spoken + tone) + visual (red full-screen banner) +
  haptic (vibrate) on any `critical` hit.
- **Call linkage:** **standalone** — Patrol Scan logs sightings only and does
  NOT attach plates to an open call. On-scene, call-linked scanning stays as the
  existing "Scan vehicles" mode.
- **24/7 caveat (accepted):** a browser camera runs only while the page is
  foreground and the screen is awake. A Screen Wake Lock keeps it running for a
  whole shift while mounted, but true OS-background (screen locked, phone in
  pocket) is impossible from web — that is a separate native-app / Jetson task.

## Architecture

A **continuous capture loop** layered onto the existing `FieldCameraPage`. No
new server routes and no schema change: `POST /api/alpr/capture` already does
plate read → screen (stolen / watchlist / warrant) → `vehicle_sightings` /
`vehicles_records` write → critical-hit detection. Patrol Scan simply *feeds it
frames automatically* instead of waiting for a shutter press.

### Components (all client-side)

1. **`patrolScan.ts` (pure helpers, unit-tested)** —
   `client/src/utils/patrolScan.ts`
   - `shouldLogPlate(plate, nowMs, seen: Map<string,number>, windowMs): boolean`
     — dedup gate; returns false if the plate was seen within `windowMs`.
   - `patrolAlertText(plate, hits): string | null` — the spoken/banner string for
     a critical hit (e.g. `"Stolen vehicle. Plate ABC123."`), or null if no
     critical hit.
   - `PATROL_INTERVAL_MS = 4000`, `PATROL_DEDUP_MS = 300_000`.

2. **`usePatrolScan` hook** — `client/src/hooks/usePatrolScan.ts`
   - Owns a **single-flight recursive timer** (not `setInterval`, so a slow
     upload can never stack a second request). Each tick: grab a frame from the
     page's existing `videoRef` via `stampToBlob` → `downscaleImage(1280, 0.8)`
     → `apiPostForm('/alpr/capture', form)` with `capture_reason: 'patrol_alpr'`
     (no `call_id`).
   - Holds the in-memory `seen` Map and applies `shouldLogPlate` before counting
     a sighting in the log (the server still screens every frame for safety; the
     dedup only governs the on-screen log + alert spam).
   - On a critical hit: `announcePlateHit()` (new, see #3), `navigator.vibrate`,
     and surface a `PatrolHit` to the page for the banner.
   - Returns `{ running, start, stop, log, lastHit, clearHit }`.

3. **`announcePlateHit(plate, hits)`** — new function in
   `client/src/utils/voiceAlerts.ts`, following the exact existing pattern
   (`isVoiceEnabled` / `isAudioAvailable` guards, `wasRecentlyAnnounced` dedup,
   `playToneAsync('alert')` then `enqueuePhrases`). Reuses the whole stack; no
   new audio engine.

4. **Patrol UI in `FieldCameraPage`** — a third mode chip ("PATROL"), a running
   scan log (recent reads, hits highlighted red), a full-screen red hit banner
   with dismiss, and a **Screen Wake Lock** acquired on start / released on stop
   (and re-acquired on `visibilitychange` per the WakeLock spec).

### Data flow

```
video frame → stamp → downscale(1280) → POST /alpr/capture (patrol_alpr)
   → { vehicles, hits }
   → server already wrote vehicle_sightings + screened
   → client: shouldLogPlate? → append to scan log
   → critical hit? → speak + tone + vibrate + red banner
```

Every accepted plate lands in `vehicle_sightings` / `vehicles_records`
server-side, so the intel plate-log fills automatically as the officer drives.

## Error handling

- Camera/upload failure on a tick is swallowed (logged to console) and the loop
  continues on the next interval — one bad frame must not kill the patrol.
- Single-flight guard: a tick that is still uploading when the next timer fires
  is skipped, never queued.
- Wake Lock unavailable (older WebView) → loop still runs; we just can't prevent
  sleep. Surface a one-time non-blocking notice.
- No-readable-plate frames (`vehicle_count === 0`) are normal and silent.

## Testing

- `tests`/vitest for `patrolScan.ts`: dedup window boundaries (just-inside /
  just-outside `windowMs`, unseen plate, empty plate), and `patrolAlertText`
  (critical hit present / absent / multiple).
- Loop + camera + wake lock verified manually in-app.

## Live run verification

After PR → merge → deploy, do a **browser-driven POST** to the deployed
`/api/alpr/capture` with a real plate image (curl is blocked by the Cloudflare
managed challenge on all paths except `/api/health`) and show the actual
returned vehicle data — plate, make/model/color, confidence, hits.

## Out of scope

- True OS-background capture (native iOS app / Jetson edge) — separate task.
- Server changes — none needed.
- Multi-vehicle-per-frame fidelity — bounded by the current Cloudflare
  single-read path (documented elsewhere).
