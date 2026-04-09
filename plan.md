# Visual Overhaul Plan — RMPG Flex v5.4

## Phase 1: Layout & Navigation Redesign
**Goal**: Replace flat icon toolbar with a collapsible sidebar for better navigation and page structure.

### 1a. Collapsible Sidebar Navigation
- Add a left sidebar (240px expanded, 56px collapsed) with icon + label for each module
- Group modules into sections: **Operations** (Dashboard, Dispatch, Map, MDT, Patrol), **Records** (Incidents, Records, Warrants, Citations, FIs, Trespass, Evidence, Cases), **Enforcement** (Code Enforcement, Court, Offender Registry, Crime Analysis), **Personnel** (Personnel, Fleet, Body Cameras, Dash Cameras, Training), **Communications** (Comms, Radio, BOLOs, DAR), **Reports** (Reports, Custom Builder, Statute Analytics), **Admin** (Admin, Audit, Settings)
- Collapse toggle button (hamburger) at top
- Active page highlighted with brand-blue left accent bar
- Persist expanded/collapsed state in localStorage
- Keep the brand bar (52px) at top but remove the icon toolbar row
- Keep the menu bar (File|View|Tools|Help) as-is — it provides keyboard shortcuts and advanced features
- Mobile: sidebar becomes the existing hamburger drawer (already implemented)

### 1b. Improved Page Structure
- Add breadcrumb bar below brand bar showing: Module Group > Current Page
- Standardize page headers: icon + title + action buttons aligned right
- Consistent content padding and max-width containers

**Files to modify**: `Layout.tsx`, `App.tsx`, new `Sidebar.tsx` component, `index.css`

---

## Phase 2: Dashboard Redesign
**Goal**: Transform the dashboard from a basic stats page into a visual command center.

### 2a. Live Activity Map Widget
- Embed a small Google Map (350px height) showing unit positions + active calls
- Click-through to full map page
- Use existing `DispatchMiniMap` pattern but with unit markers

### 2b. Enhanced Stats Cards
- Redesign stat cards with animated count-up numbers
- Add sparkline mini-charts inside each card (7-day trend)
- Larger, more visual card design with icon backgrounds

### 2c. Calls by Hour Chart Upgrade
- Replace basic bar chart with area chart + gradient fill
- Add tooltip with call count + call types breakdown
- Add 7-day average overlay line

### 2d. New Widgets
- **Unit Status Donut Chart** — visual breakdown of available/dispatched/enroute/onscene/busy/off_duty
- **Response Time Trend** — line chart showing avg response over last 7 days
- **Live Dispatch Feed** — real-time scrolling feed of dispatch events (WebSocket)
- **Priority Distribution Pie** — visual breakdown of P1/P2/P3/P4 calls

### 2e. Widget Grid Layout
- CSS grid layout with draggable/resizable panels (optional, if time permits)
- 2-column on desktop, single column on mobile

**Files to modify**: `DashboardPage.tsx`, new chart components, `index.css`

---

## Phase 3: Login Page Polish
**Goal**: Add subtle animations and visual refinements to the login experience.

### 3a. Background Animation
- Add subtle animated grid/particle effect behind the login card (CSS only, no heavy libs)
- Scanline overlay (already have CRT class — use subtly)

### 3b. Login Card Enhancements
- Smooth step transitions (slide animation between Credentials and 2FA)
- Input focus glow effects
- Typing indicator on password field
- Success animation on login (green pulse before redirect)

**Files to modify**: `LoginPage.tsx`, `index.css`

---

## Phase 4: Dash Cameras Enhancement
**Goal**: Full-featured MVR system with video burning, data entry, and case/call linking.

### 4a. Enhanced Upload UI
- Multi-step upload wizard: Select File → Enter Metadata → Link to Case/Call → Review & Upload
- Thumbnail preview generation (video frame capture at 2s mark)
- Bulk upload support (multiple files)
- Upload queue with individual progress bars

### 4b. Video "Burning" (HUD Overlay Bake-in)
- **Server-side**: Add ffmpeg-based video processing endpoint
  - Takes original video + HUD metadata (agency, unit, speed, GPS, timestamp, case#)
  - Burns semi-transparent HUD overlay into the video file
  - Outputs a new MP4 with permanent overlay
  - Progress tracking via WebSocket (percent complete)
- **Client-side**: "Burn HUD" button on video detail
  - Shows processing status (queued → processing → complete)
  - Download burned copy or replace original
  - Preview before burning

### 4c. Case & Call Linking
- **Database**: Add `dashcam_video_links` table:
  ```sql
  CREATE TABLE dashcam_video_links (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL,
    link_type TEXT NOT NULL, -- 'case' | 'call' | 'incident'
    link_id INTEGER NOT NULL,
    link_reference TEXT, -- case number, call number, or incident number
    linked_by TEXT,
    linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES dashcam_videos(id)
  )
  ```
- **Upload modal**: Add "Link to Case/Call" section with:
  - Case number search/autocomplete (searches cases table)
  - Call number search/autocomplete (searches calls_for_service table)
  - Incident number search/autocomplete
  - Multiple links allowed per video
- **Video detail view**: Show linked cases/calls/incidents as clickable badges
- **Case/Incident pages**: Show linked videos in an "Attached Videos" section

### 4d. Enhanced Video Player & Detail View
- Redesign video player page as a full detail view (not just modal):
  - Large video player (left 2/3)
  - Metadata panel (right 1/3): all fields, edit inline
  - Timeline scrubber with GPS/speed visualization below video
  - Linked cases/calls/incidents section
  - Audit trail (who uploaded, edited, linked)
- Thumbnail grid view option (alongside table view)
- Map view: plot all videos on map by GPS coordinates

### 4e. Data Entry Improvements
- Quick-tag buttons for common classifications
- Auto-populate unit/vehicle from logged-in user's assignment
- Auto-populate GPS from user's current location
- OCR-style license plate entry helper (future)

**Files to modify**: `DashCamerasPage.tsx`, `DashCamUploadModal.tsx`, `DashCamVideoPlayer.tsx`, `DashCamVideoEditModal.tsx`, `server/src/routes/dashcamVideos.ts`, `server/src/models/database.ts`, new `VideoDetailPage.tsx`

---

## Phase 5: Visual Polish & Animations
**Goal**: Add visual refinements across the app.

### 5a. Page Transitions
- Fade-in on page navigation (CSS transition on Outlet)
- Skeleton loading states for data-heavy pages

### 5b. Table Enhancements
- Row hover animations with subtle highlight
- Expandable row detail (click to expand inline)
- Column sort indicators with animated arrows

### 5c. Chart Consistency
- Standardize chart colors, tooltips, and axes across all pages
- Add chart loading skeletons
- Consistent empty-state for charts with no data

---

## Implementation Order
1. **Phase 1** (Sidebar) — highest visual impact, affects every page
2. **Phase 4** (Dash Cameras) — new feature functionality
3. **Phase 2** (Dashboard) — command center feel
4. **Phase 3** (Login) — polish
5. **Phase 5** (Visual Polish) — finishing touches

## Estimated Scope
- ~15-20 files modified
- ~3-5 new files created
- 1 new DB table (dashcam_video_links)
- 1 new server dependency (ffmpeg for video burning)
