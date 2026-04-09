# DashCam Police HUD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace DashCamDetailPage with a police-style HUD video player featuring overlay bars, expandable side panel, GPS-synced speed readout, and mini map.

**Architecture:** Single-page component at `/dash-cameras/:id` with two layers: (1) a video player with semi-transparent CSS overlay bars (top/bottom) and speed timeline scrubber, (2) a slide-in 280px right panel with collapsible officer/vehicle/incident/GPS sections. All data from one enhanced API call.

**Tech Stack:** React 18 + TypeScript, Google Maps JS API (dark styled), CSS custom properties (existing design system), requestAnimationFrame for GPS sync.

---

### Task 1: Enhance GET /:id API with officer/vehicle JOINs

**Files:**
- Modify: `server/src/routes/dashcamVideos.ts:131-164`

**Step 1: Update the SQL query**

In the `GET /:id` route handler (line 134-146), expand the SELECT to JOIN officer data from the users table via units.officer_id, and add missing vehicle fields:

```sql
SELECT v.*,
  COALESCE(fv.vehicle_number, fv_unit.vehicle_number) as vehicle_number,
  COALESCE(fv.make, fv_unit.make) as vehicle_make,
  COALESCE(fv.model, fv_unit.model) as vehicle_model,
  COALESCE(fv.year, fv_unit.year) as vehicle_year,
  COALESCE(fv.color, fv_unit.color) as vehicle_color,
  COALESCE(fv.plate_number, fv_unit.plate_number) as vehicle_plate,
  COALESCE(fv.plate_state, fv_unit.plate_state) as vehicle_plate_state,
  u.call_sign as unit_call_sign,
  u.status as unit_status,
  usr.full_name as officer_name,
  usr.badge_number as officer_badge,
  usr.rank as officer_rank
FROM dashcam_videos v
LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
LEFT JOIN units u ON v.unit_id = u.id
LEFT JOIN fleet_vehicles fv_unit ON fv_unit.assigned_unit_id = v.unit_id AND v.vehicle_id IS NULL
LEFT JOIN users usr ON u.officer_id = usr.id
WHERE v.id = ?
```

**Step 2: Verify the server compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add server/src/routes/dashcamVideos.ts
git commit -m "feat(api): add officer/vehicle JOINs to dashcam video detail endpoint"
```

---

### Task 2: Add HUD CSS animations and classes

**Files:**
- Modify: `client/src/index.css` (append to end)

**Step 1: Add HUD-specific CSS**

Append these classes to the end of `client/src/index.css`:

```css
/* ============================================================
   DASHCAM HUD OVERLAY
   ============================================================ */

/* REC indicator pulse */
@keyframes hud-rec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.hud-rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 6px #ef4444;
  animation: hud-rec-pulse 1s ease-in-out infinite;
}

.hud-rec-dot.paused {
  animation: none;
  background: #6b7280;
  box-shadow: none;
}

/* Overlay bars */
.hud-bar {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  z-index: 10;
  transition: opacity 150ms ease;
}

.hud-bar-top {
  top: 0;
  height: 36px;
  font-size: 11px;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.hud-bar-bottom {
  bottom: 0;
  height: 32px;
  font-size: 10px;
  gap: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

/* Speed color classes */
.hud-speed-green { color: #22c55e; }
.hud-speed-amber { color: #f59e0b; }
.hud-speed-red { color: #ef4444; }

/* Channel badges */
.hud-channel-front {
  background: rgba(59, 130, 246, 0.25);
  border: 1px solid rgba(59, 130, 246, 0.5);
  color: #60a5fa;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.hud-channel-rear {
  background: rgba(168, 85, 247, 0.25);
  border: 1px solid rgba(168, 85, 247, 0.5);
  color: #c084fc;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

/* Classification badges */
.hud-class-routine { color: #6b7280; }
.hud-class-evidence { color: #d4a017; }
.hud-class-flagged { color: #ef4444; }
.hud-class-restricted { color: #a855f7; }

/* Side panel */
.hud-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 280px;
  background: var(--surface-base);
  border-left: 1px solid var(--border-default);
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 200ms ease;
  z-index: 20;
}

.hud-panel.open {
  transform: translateX(0);
}

/* Panel section headers */
.hud-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.hud-section-header:hover {
  background: var(--surface-hover, rgba(255,255,255,0.04));
}

.hud-section-content {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
}

/* Speed gauge */
.hud-speed-gauge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  padding: 8px 0;
}

.hud-speed-unit {
  font-size: 14px;
  font-weight: 600;
  opacity: 0.6;
  margin-top: 2px;
}

/* Playback controls */
.hud-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.8);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.hud-controls button {
  background: none;
  border: none;
  color: #d0d8e0;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 2px;
  font-size: 11px;
  font-family: inherit;
  transition: background 100ms ease, color 100ms ease;
}

.hud-controls button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.hud-controls button.active {
  background: rgba(59, 138, 212, 0.3);
  color: #3b8ad4;
}

/* Speed timeline */
.hud-timeline {
  position: relative;
  height: 24px;
  background: rgba(0, 0, 0, 0.7);
  cursor: pointer;
}

.hud-timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #3b8ad4;
  z-index: 2;
  pointer-events: none;
}
```

**Step 2: Verify build**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: add DashCam HUD overlay CSS classes and animations"
```

---

### Task 3: Build the HUD component — video layer + overlay bars

**Files:**
- Replace: `client/src/pages/DashCamDetailPage.tsx`

**Step 1: Build the core component**

Replace `DashCamDetailPage.tsx` with the new HUD component. This is the largest task (~700 lines). Key architecture:

```tsx
// State
const [video, setVideo] = useState<any>(null);       // API response
const [panelOpen, setPanelOpen] = useState(false);    // side panel
const [isPlaying, setIsPlaying] = useState(false);    // playback state
const [currentTime, setCurrentTime] = useState(0);    // video.currentTime
const [duration, setDuration] = useState(0);          // video.duration
const [playbackRate, setPlaybackRate] = useState(1);  // 0.5/1/1.5/2x
const [currentSpeed, setCurrentSpeed] = useState<number | null>(null); // from GPS
const [currentGps, setCurrentGps] = useState<{lat: number, lng: number} | null>(null);
const [gpsTrack, setGpsTrack] = useState<GpsPoint[]>([]);
const [neighbors, setNeighbors] = useState<{prev: number|null, next: number|null}>({prev:null,next:null});
const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['officer','vehicle','speed']));

// Refs
const videoRef = useRef<HTMLVideoElement>(null);
const animFrameRef = useRef<number>(0);
```

The component has these main render sections:
1. **Video container** (position: relative, fills available space)
   - `<video>` element with `ref={videoRef}`, streaming src from API
   - Top overlay bar (HUD data)
   - Bottom overlay bar (case/GPS)
   - Speed timeline SVG
   - Custom playback controls
2. **Side panel** (280px, conditionally rendered)

**GPS interpolation function** — maps `video.currentTime` to the GPS track array:
```typescript
function interpolateGps(track: GpsPoint[], currentTime: number, recordedAtUnix: number): { speed: number; lat: number; lng: number } | null {
  if (!track.length) return null;
  const targetTime = recordedAtUnix + currentTime;
  // Binary search for nearest two points, lerp between them
  // Return interpolated speed, lat, lng
}
```

**requestAnimationFrame loop** — runs while playing:
```typescript
useEffect(() => {
  if (!isPlaying) return;
  const tick = () => {
    if (videoRef.current) {
      const t = videoRef.current.currentTime;
      setCurrentTime(t);
      const gps = interpolateGps(gpsTrack, t, video.recorded_at_unix);
      if (gps) {
        setCurrentSpeed(gps.speed);
        setCurrentGps({ lat: gps.lat, lng: gps.lng });
      }
    }
    animFrameRef.current = requestAnimationFrame(tick);
  };
  animFrameRef.current = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(animFrameRef.current);
}, [isPlaying, gpsTrack]);
```

**Keyboard shortcuts** — via `useEffect` with `keydown` listener.

**Step 2: Verify build**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/pages/DashCamDetailPage.tsx
git commit -m "feat: replace DashCamDetailPage with police-style HUD player"
```

---

### Task 4: Build expanded panel sections

**Files:**
- Modify: `client/src/pages/DashCamDetailPage.tsx` (the file from Task 3)

This task adds the collapsible panel sections. Each section follows the same pattern:

```tsx
<div>
  <div className="hud-section-header" onClick={() => toggleSection('officer')}>
    <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
    <User className="w-3 h-3" />
    <span>OFFICER & UNIT</span>
  </div>
  {expanded && (
    <div className="hud-section-content">
      {/* Section content */}
    </div>
  )}
</div>
```

**Sections to implement:**

1. **Officer & Unit** — officer_name, officer_badge, officer_rank, unit_call_sign, unit_status (LED dot)
2. **Vehicle** — vehicle_number, vehicle_year/make/model, vehicle_color, vehicle_plate + state
3. **Speed Gauge** — `<div className="hud-speed-gauge">{currentSpeed ?? '--'}</div>` with color class
4. **GPS Map** — 200px Google Map container. Use existing `googleMapsLoader.ts` pattern. Dark styled. Blue marker at `currentGps`. If gpsTrack exists, draw polyline.
5. **Incident** — fetch linked calls from `video.links.filter(l => l.entity_type === 'call')`, display each with priority badge, incident type, status, disposition
6. **Evidence** — case_number, classification badge, uploaded_by, created_at, burn_status indicator
7. **Linked Entities** — remaining links (warrants, citations, etc.) with clickable navigate

**Bottom actions bar** (sticky):
- Burn HUD button (managers+), Download Original, Download Burned (if burn_status=complete), Edit (managers+)

**Step 2: Verify build**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/pages/DashCamDetailPage.tsx
git commit -m "feat(hud): add expandable side panel with officer/vehicle/incident sections"
```

---

### Task 5: Google Maps inset for GPS panel

**Files:**
- Modify: `client/src/pages/DashCamDetailPage.tsx` (GPS Map section from Task 4)

**Step 1: Implement map section**

The GPS Map section needs a 200px Google Map with:
- Dark styling from `DARK_MAP_STYLE` (import from `googleMapsLoader.ts`)
- Blue marker at current GPS position (updates with playback)
- Route polyline drawn from `gpsTrack` array (if available)
- Static single-point view if only lat/lng fields exist (no track)

Use the existing Google Maps loading pattern from the codebase:
- Check `window.google?.maps` availability
- `useRef` for map container div
- `useEffect` to initialize map when section expands
- `useEffect` to update marker position when `currentGps` changes

```typescript
// Map initialization when GPS section expands
useEffect(() => {
  if (!expandedSections.has('gps') || !mapContainerRef.current || !window.google?.maps) return;
  if (mapInstanceRef.current) return; // already initialized

  const map = new google.maps.Map(mapContainerRef.current, {
    center: { lat: video.latitude || 40.7608, lng: video.longitude || -111.891 },
    zoom: 15,
    styles: DARK_MAP_STYLE,
    disableDefaultUI: true,
    zoomControl: true,
  });
  mapInstanceRef.current = map;

  // Draw route polyline if GPS track exists
  if (gpsTrack.length > 1) {
    new google.maps.Polyline({
      path: gpsTrack.map(p => ({ lat: p.latitude, lng: p.longitude })),
      strokeColor: '#3b8ad4',
      strokeOpacity: 0.7,
      strokeWeight: 3,
      map,
    });
  }

  // Position marker
  markerRef.current = new google.maps.Marker({
    position: { lat: video.latitude, lng: video.longitude },
    map,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#3b8ad4', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
  });
}, [expandedSections, gpsTrack]);

// Update marker position during playback
useEffect(() => {
  if (!markerRef.current || !currentGps) return;
  markerRef.current.setPosition({ lat: currentGps.lat, lng: currentGps.lng });
}, [currentGps]);
```

**Step 2: Verify build**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/pages/DashCamDetailPage.tsx
git commit -m "feat(hud): add GPS map inset with route polyline and moving marker"
```

---

### Task 6: Integration testing and polish

**Files:**
- Modify: `client/src/pages/DashCamDetailPage.tsx` (minor fixes)
- Verify: `client/src/App.tsx` (route already exists from prior work)

**Step 1: Verify route registration**

Check that `App.tsx` has the route `<Route path="/dash-cameras/:id" element={<DashCamDetailPage />} />` — this should already exist from the prior detail page work. No changes needed.

**Step 2: Build the full app**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors or warnings

**Step 3: Run the dev server and test**

Run: `npm run dev`
Navigate to `/dash-cameras/:id` with a real video ID.

Verify:
- [ ] Video loads and plays
- [ ] Top bar shows REC indicator, timestamp, unit, speed, channel
- [ ] Bottom bar shows case number, classification, address, coordinates
- [ ] Speed timeline renders with colored segments
- [ ] ⓘ button toggles side panel
- [ ] Officer, Vehicle, Speed sections expanded by default
- [ ] GPS Map loads when expanded (if Google Maps available)
- [ ] Keyboard shortcuts work (Space, ←→, F, I, 1-4)
- [ ] Playback speed buttons work
- [ ] Download/Burn/Edit buttons work
- [ ] Previous/Next navigation works
- [ ] Mobile responsive (bars stack, panel fullscreen)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(hud): polish and integration verification"
```

---

## Summary

| Task | Description | Est. Lines |
|------|-------------|-----------|
| 1 | API JOIN enhancement | ~10 |
| 2 | HUD CSS classes | ~180 |
| 3 | Core HUD component (video + bars + controls) | ~450 |
| 4 | Expanded panel sections | ~250 |
| 5 | Google Maps inset | ~60 |
| 6 | Integration testing | ~20 |
| **Total** | | **~970** |
