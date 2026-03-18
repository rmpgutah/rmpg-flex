# DashCam Police HUD — Design Document

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Replace DashCamDetailPage with a police-style HUD video player

## Overview

A hybrid HUD that's minimal by default (timestamp + REC + speed bars overlaying the video) with an expandable right panel for full tactical information. Replaces the existing `DashCamDetailPage.tsx` at route `/dash-cameras/:id`. Multi-purpose: officer review, supervisor investigation, and evidence presentation.

## Architecture

### Two Modes

**Collapsed (default):** Video fills viewport with two semi-transparent overlay bars:
- **Top bar (36px):** `● REC` (pulsing red), timestamp synced to playback, unit call sign, speed (color-coded), camera channel badge (FRONT/REAR), `[ⓘ]` panel toggle
- **Bottom bar (32px):** Case number (amber mono), classification badge, address, GPS coordinates

**Expanded (click ⓘ):** 280px right panel slides in (200ms ease) with collapsible sections.

### Speed Timeline Scrubber
24px SVG between video and bottom bar. Color-coded speed segments (green ≤45, amber 46-65, red >65 MPH). Blue playhead synced to `video.currentTime`. Click to seek.

## Expanded Panel Sections

280px width, `var(--surface-base)` background, `border-left: 1px solid var(--border-default)`.

| # | Section | Default | Content |
|---|---------|---------|---------|
| 1 | Officer & Unit | expanded | Name, badge #, rank, call sign, status LED |
| 2 | Vehicle | expanded | #, year/make/model, color, plate/state |
| 3 | Speed Gauge | expanded | 48px monospace readout, color-coded, updates live |
| 4 | GPS Map | collapsed | 200px Google Map (dark), blue marker at current position, route polyline from GPS track |
| 5 | Incident | collapsed | Linked calls: priority badge (P1-P4), incident type, status, disposition, dispatch timeline |
| 6 | Evidence | collapsed | Case #, classification, uploaded by, upload date, burn status, notes |
| 7 | Linked Entities | collapsed | Clickable links to calls/warrants/citations |

Bottom sticky actions: Burn HUD, Download Original, Download Burned, Edit (managers+).

## Overlay Bar Details

### Top Bar
- `rgba(0,0,0,0.65)` + `backdrop-blur(4px)`
- `● REC` red pulse when playing, `▌▌ PAUSED` when paused
- Timestamp: advances with `video.currentTime` + `recorded_at` base offset
- Speed: interpolated from `cpg_gps_track` array at current playback time
- Speed colors: green ≤45, amber 46-65, red >65 MPH. `-- MPH` if no GPS data
- Channel: `FRONT` (blue) or `REAR` (purple) badge

### Bottom Bar
- Case # in amber monospace, or `NO CASE` dimmed
- Classification: routine=gray, evidence=amber, flagged=red, restricted=purple
- Address (truncated), GPS coords in monospace

## Playback Controls

Custom controls replacing native browser controls:

```
◄◄  ▶/▌▌  ►►  │  0:42 / 3:15  │  🔊━━━━  │  0.5x  1x  1.5x  2x  │  ⛶
```

- Skip: ±10 seconds
- Speed: 0.5x, 1x, 1.5x, 2x (for frame-by-frame incident review)
- Fullscreen: browser API, HUD persists

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Space | Play/Pause |
| ←/→ | Skip 10s |
| J/K/L | Pro review (back/pause/forward, L stacks) |
| F | Fullscreen |
| I | Toggle panel |
| 1-4 | Speed (0.5x/1x/1.5x/2x) |

## Data Requirements

### Backend Change (one JOIN enhancement)
The `GET /api/fleet/dashcam-videos/:id` endpoint needs to JOIN officer/vehicle data to avoid extra round-trips:

Added response fields:
- `officer_name`, `officer_badge`, `officer_rank` (from users via units.officer_id)
- `unit_call_sign`, `unit_status` (from units)
- `vehicle_number`, `vehicle_year`, `vehicle_make`, `vehicle_model`, `vehicle_color`, `vehicle_plate`, `vehicle_plate_state` (from fleet_vehicles)

### GPS Sync
- `cpg_gps_track` JSON parsed client-side: `Array<{latitude, longitude, speed, altitude, timestamp}>`
- Interpolation at ~4 updates/sec (requestAnimationFrame, throttled)
- Updates: speed readout, map marker position, coordinate display
- Fallback: static `speed_mph` and `latitude/longitude` if no GPS track

### No New Endpoints
All existing endpoints sufficient:
- `GET /:id` — metadata (enhanced with JOINs)
- `GET /:id/neighbors` — prev/next
- `GET /:id/links` — linked entities
- `GET /:id/stream?token=...` — video streaming
- `POST /:id/burn` — trigger burn
- `GET /:id/download-burned?token=...` — download burned file

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `client/src/pages/DashCamDetailPage.tsx` | Replace | New HUD player component (~600-800 lines) |
| `server/src/routes/dashcamVideos.ts` | Modify | Add JOINs to GET /:id for officer/vehicle data |
| `client/src/index.css` | Add | HUD-specific animations (REC pulse, bar transitions) |

## Visual Theme
- Consistent with existing design system (CSS custom properties)
- `panel-beveled`, `panel-title-bar` for expanded panel sections
- Monospace font for all data readouts (JetBrains Mono / system mono)
- LED indicators for status
- All existing Tailwind dark theme patterns
