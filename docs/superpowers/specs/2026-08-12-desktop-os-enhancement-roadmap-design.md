# FlexOS Desktop — Windows-OS Enhancement Roadmap

**Date:** 2026-08-12  
**Branch:** `claude/system-enhancement-features-d8e15f`  
**Approach:** Approach A — One Wave, One PR  
**Total features:** 60 across 5 waves  
**Scope:** `client/src/components/desktop/`, `client/src/pages/DesktopPage.tsx`, `client/src/context/DesktopSystemContext.tsx`

---

## Background

The FlexOS desktop shell (`/desktop`) is a windowed CAD/RMS launcher built on React + Vite running inside Cloudflare Pages. It already ships a capable foundation: drag/resize/snap floating windows (`FloatingWindow.tsx`), virtual desktops, a taskbar with app drawer, widget panel, lock screen, boot splash, notification center, and an Electron-aware system tray. This roadmap advances that foundation to full Windows-OS fidelity for police dispatch use, removes Electron-only gates where possible, and adds 60 concrete features across 5 sequential waves.

**Existing strengths to preserve (no regressions):**
- FloatingWindow drag/resize, Aero Shake, edge snap (left/right), always-on-top, minimize/maximize
- Virtual desktop provider and workspace pills
- Desktop widget panel (positions, opacity, blur — all persisted via `desktop_widgets_json`)
- Lock screen + screensaver idle detection
- Notification center (real API-backed)
- P1 alert overlay and welfare countdown

---

## Architecture invariants

- **Theme tokens only** — no hardcoded hex anywhere in new components. All colors via `var(--surface-*)`, `var(--text-*)`, `var(--accent-silver-*)`, `var(--sev-*)`.
- **2 px radius everywhere** — `borderRadius: 2`. Never `rounded-lg`.
- **D1 100-param cap** — any new API call that filters by a list must use `queryInChunks`.
- **No `SELECT *` on `calls_for_service`** — 100-column cap. Use explicit column lists.
- **`apiFetch` not raw `fetch`** — all new API calls use `apiFetch` from `client/src/hooks/useApi.ts`.
- **One palette class on `<html>`** — new components must not stamp additional theme classes.
- **All tests must pass** — `npx vitest run` (worker) + `cd client && npx vitest run` (client) before each wave's PR.

---

## Wave 1 — Window Management Overhaul

**PR scope:** `FloatingWindow.tsx`, `DesktopWindowManager.tsx`, new `SnapLayouts.tsx`, `DesktopWindowSwitcher.tsx`, `DesktopKeyboardShortcuts.tsx`

### Feature list

#### 1. Snap Layouts overlay
Triggered by Win+Z or hovering the maximize button for 400 ms. Renders a zone-picker overlay attached to the maximize button. Auto-detects layout:
- **≤1399px viewport width:** 4 zones — left half, right half, top-left quarter, top-right quarter
- **≥1400px viewport width:** 6 zones — left third, center third, right third, plus top-left and top-right quarters and a right-two-thirds

On zone click: window snaps to that zone's exact bounds. Overlay dismisses on click-outside or Escape. Zone bounds computed from `window.innerWidth` / `window.innerHeight` minus taskbar height. Implementation: new `SnapLayouts.tsx` renders as a portal anchored to the maximize button; exported from `FloatingWindow.tsx`.

#### 2. Snap Assist
After a window snaps to a zone occupying less than the full screen, a semi-transparent Snap Assist panel fills the remaining unoccupied zone(s). It shows thumbnail representations (title + icon, no live render) of all other non-minimized windows. Click a thumbnail to snap that window into the remaining zone. Dismiss on Escape or backdrop click. Snap Assist only shows when ≥1 other non-minimized window exists.

#### 3. Title bar right-click system menu
Right-clicking the title bar (anywhere except the control buttons) opens a system menu:
- Restore (disabled if not maximized/minimized)
- Move (keyboard-mode: arrow keys reposition 10 px per press, Enter to confirm)
- Size (keyboard-mode: arrow keys resize, Enter to confirm)
- Minimize
- Maximize / Restore Down
- Close (Alt+F4)
- ── separator ──
- Always on Top ✓ (toggle)
- Opacity → submenu: 100%, 90%, 75%, 50%, 25%

Menu is a `<ContextMenu>` using the existing component. System menu z-index: `win.zIndex + 1`.

#### 4. Per-window opacity slider
In the system menu's Opacity submenu, a range input (20–100, step 5) lets the user set a continuous opacity value. The value is stored in `win.opacity` (already present in `DesktopWindowState`). `setWindowOpacity` already exists in the window manager — wire it to this slider. Persists for the session only (not across reloads).

#### 5. Window cascade
`DesktopPage.tsx` right-click context menu adds **Cascade Windows**. Arranges all non-minimized windows in a diagonal staircase: each window offset by 28px down and 28px right from the previous, starting at (20, 20). Window size: 640×480 each. Windows that would overflow the screen wrap to start position.

#### 6. Window tile horizontal / tile vertical
Right-click context menu adds **Tile Windows Horizontally** and **Tile Windows Vertically**. Horizontally: windows share equal height, stacked top-to-bottom, full width. Vertically: windows share equal width, side-by-side, full height. Both compute from non-minimized window count. Minimized windows are excluded and stay minimized.

#### 7. Window rules — remember size+position
On window close, persist `{ width, height, x, y }` to `localStorage` keyed by `win.path` (e.g., `rmpg_winrule_/dispatch`). On `openWindow(path)`, check for a saved rule and apply it as the initial bounds instead of the default. Rules are overridden by any explicit `options` passed to `openWindow`. Per-user isolation: key includes the user ID (`rmpg_winrule_${userId}_${path}`). UI: Settings app ("Window Rules" tab) lists saved rules with a clear-all button.

#### 8. Maximize to full-screen (F11)
When a window is focused, F11 toggles a CSS-only full-screen mode: the `FloatingWindow` div expands to `position:fixed; inset:0; z-index: ALWAYS_ON_TOP_ZINDEX_OFFSET + 500` and hides its title bar. The taskbar remains visible (covered by the window). Press F11 or Escape to exit. This is distinct from the existing `toggleMaximize` which respects taskbar height.

#### 9. Aero Shake refinement
The existing shake detection (`shakeRef`) fires correctly but gives no visual feedback. Add a 300 ms CSS ring-pulse animation on the shake-target window's title bar at the moment the shake triggers. Also debounce: after a shake minimizes all others, a reverse shake within 2 s restores them (currently implemented as `autoMinimizedIds` in `DesktopPage` — move this logic into `FloatingWindow` so each window manages its own shake state).

#### 10. Window border resize handles
On hover of any 8 px strip along the window edge or 16×16 corner areas, apply the matching CSS cursor (`n-resize`, `s-resize`, `e-resize`, `w-resize`, `ne-resize`, `nw-resize`, `se-resize`, `sw-resize`). The resize logic already works via pointer events — this adds the visual cursor affordance that currently only activates once a drag has started.

#### 11. Alt+Tab switcher with visual previews
Global keydown listener: Alt+Tab opens `DesktopWindowSwitcher` (already exists, currently only shows window titles). Enhancement: add a thumbnail preview for each window — rendered as a scaled-down `<iframe>` clone or a title+icon card (title+icon is safe; live iframe clones have cross-origin risk). Keyboard navigation: Tab / Shift+Tab cycles selection, Enter focuses the selected window, Escape cancels. Release of Alt key also confirms selection (requires tracking Alt keyup). Switcher z-index: `ALWAYS_ON_TOP_ZINDEX_OFFSET + 2000`.

#### 12. Win+Arrow keyboard snap
In `DesktopKeyboardShortcuts.tsx`:
- **Win+Left** → snap focused window to left half
- **Win+Right** → snap focused window to right half  
- **Win+Up** → maximize focused window
- **Win+Down** → restore focused window (if maximized) or minimize (if restored)

"Win" key = `e.metaKey` on Mac, `e.ctrlKey && e.shiftKey` as fallback on Windows (since Ctrl+Win is system-captured). Use `e.metaKey || (e.ctrlKey && e.shiftKey)` to support both platforms.

#### 13. Window tabs
Drag a window's title bar over another window's title bar (within 40 px vertical overlap) to merge them into a tab group. The target window gains a tab strip below its title bar listing all merged windows by title. Clicking a tab brings that window's iframe to the front within the tab group. The tab group is a new `windowGroupId` field on `DesktopWindowState`; grouped windows share position/size from the group leader. A tab can be torn off by dragging it off the strip.

**Implementation note:** Tab groups require a `windowGroups` map in `DesktopWindowManager` state. This is additive — existing windows are ungrouped by default.

#### 14. Snap keyboard shortcuts reference
`DesktopKeyboardShortcuts.tsx` registers a new shortcut: Win+/ (or Ctrl+?) opens a floating reference card listing all desktop keyboard shortcuts. The card is a read-only `FloatingWindow` that opens at center screen.

---

## Wave 2 — Taskbar & Shell Polish

**PR scope:** `DesktopTaskbar.tsx`, `FlexOSAppDrawer.tsx`, new `TaskbarWindowButton.tsx`, `TaskbarThumbnailPreview.tsx`, `JumpList.tsx`

### Feature list

#### 1. Running-state indicator dot
Under each pinned taskbar icon that has ≥1 open window, render a 4×4 px dot using `var(--desktop-shell-accent)`. Multiple open windows = up to 3 dots side-by-side. Uses `useDesktopWindows().windows` filtered by `fn.path`.

#### 2. Window thumbnail preview on hover
Hovering a taskbar icon for 500 ms opens a `TaskbarThumbnailPreview` panel above the icon showing title + icon cards (one per open window of that app). Click a card to focus that window. Panel dismisses on mouse-leave (200 ms grace period). For apps with no open windows, the panel does not appear.

#### 3. Jump Lists
Right-clicking a pinned taskbar icon opens a `JumpList` panel. Each module provides a static jump-list config (defined in `navCatalog.ts` as an optional `jumpList` array of `{ label, action }` entries). Common entries: Dispatch → "New Call", "Radio Log"; Warrants → "New Warrant", "Search Warrants"; Fleet → "Add Vehicle"; Personnel → "Clock In/Out". The bottom of every Jump List always has "Unpin from taskbar" and "Close all windows".

#### 4. Taskbar clock with date + seconds toggle
The clock in `DesktopTaskbar.tsx` gains a second line showing the date (e.g., `Tue Aug 12`). In Desktop Settings, a toggle enables displaying seconds in the time (HH:MM:SS). The `useClock` hook already fires every second — the display just needs the date line and conditional seconds.

#### 5. Calendar flyout
Clicking the clock opens a `CalendarFlyout` panel (not a full app — a compact 280×300 px popup). Shows current month as a grid, current day highlighted with accent color. Previous/next month navigation arrows. Clicking a date shows the date in a detail line — no event integration in this wave. Dismisses on click-outside.

#### 6. Show Desktop button
A 6×100% tall strip on the far right of the taskbar (right of the system tray). On click: minimize all non-minimized windows (save their IDs), strip gets a highlight. Click again: restore those windows. Tooltip: "Show desktop". This replaces the current `handleShowDesktop` logic in `DesktopPage.tsx` (which already exists but has no dedicated button).

#### 7. Taskbar window buttons for non-pinned apps
Open windows whose `path` is NOT in the pinned apps list get their own taskbar button in a scrollable overflow zone between the pinned icons and the system tray. Button shows the window's title (truncated) and a close ×. Click = focus the window. Buttons are ordered by window open time.

#### 8. Taskbar search box
A search icon button in the taskbar opens the command palette (Wave 4). In this wave: the button exists and opens `FlexOSAppDrawer` as a fallback (same as the grid launcher button). A `TODO` comment marks the integration point for Wave 4's command palette.

#### 9. App drawer Recents section
`FlexOSAppDrawer.tsx` gains a "Recents" tab showing the 6 most recently navigated module paths (read from `loadRecent()` in `navFavorites.ts`). Icons display the same `AppTile` component. This tab is the default when the drawer opens.

#### 10. Taskbar auto-hide smooth animation
`isTaskbarAutoHideEnabled()` already returns true/false. The taskbar currently jumps in/out. Add a CSS transition: `transform: translateY(100%)` when hidden, `transform: translateY(0)` when shown, with `transition: transform 180ms ease`. A 300 ms hover-delay prevents flicker on accidental mouse-near-edge.

#### 11. Notification badge counts on taskbar icons
Module paths that have associated notification types (Dispatch, Warrants, Messages) show a red badge with unread count over their taskbar icon. The existing `/notifications/unread-count` endpoint is already polled every 30 s. Extend it or add a per-module breakdown endpoint to drive per-icon badges.

#### 12. Middle-click to close window
Middle-click on a taskbar window button calls `closeWindow(id)` for that window. Middle-click on a pinned icon with one open window closes that window. Middle-click on a pinned icon with multiple open windows does nothing (ambiguous — use the thumbnail preview to close specific ones).

#### 13. Taskbar button right-click "Close all windows"
Right-clicking any taskbar icon (pinned or unpinned window button) shows a context menu: `Close all windows for [App Name]` / `Close window`. Uses `windows.filter(w => w.path === fn.path).forEach(w => closeWindow(w.id))`.

---

## Wave 3 — System Tray & Status Expansion

**PR scope:** `DesktopSystemTray.tsx`, `DesktopQuickSettings.tsx`, `FlexOSStatusBar.tsx`

### Feature list

#### 1. Tray visible in browser mode
Remove the `if (!isElectron) return null` guard. For browser sessions, poll battery via the Web Battery API (`navigator.getBattery()`) where available; skip gracefully where not. GPS lock reads from the RMPG API (`/gps/my-location` last-update timestamp) instead of Tauri. Sync queue reads from `apiFetch('/sync-queue/count')` (stub if endpoint not yet present). The tray shows in both Electron and browser — Electron-specific icons (relaunch, file access) remain behind the `isElectron` check.

#### 2. Volume control
Quick Settings panel gains a volume row: speaker icon + horizontal slider (0–100). Controls `HTMLMediaElement` global volume via `document.querySelectorAll('audio, video')` and persists to `localStorage('rmpg_desktop_volume')`. Desktop sounds (`desktopSounds.ts`) read from this key. No OS-level audio access (browser can't do that without permissions).

#### 3. Shift status badge
Tray shows a colored pill badge reflecting the officer's on-duty state: green "ON DUTY" / grey "OFF DUTY". State reads from the same `apiFetch('/personnel/time/mine/active')` call the taskbar clock toggle already uses. Polls every 5 min. Clicking the badge toggles the clock-in/clock-out (same handler as the taskbar button).

#### 4. GPS accuracy indicator
When the device has GPS (`navigator.geolocation`), tray shows a satellite icon with the accuracy radius in feet (e.g., `±15ft`). Tooltip shows full coordinates. Color: green ≤30 ft, amber ≤100 ft, red >100 ft or no fix. Updates every 30 s. Falls back to last known position from API (`/gps/my-location`) when device GPS unavailable.

#### 5. Radio channel badge
Tray shows a radio tower icon + channel number/name from the officer's unit record. Read from `apiFetch('/units/my-assignment')` (returns assigned radio channel). Clicking opens Quick Settings where the channel can be changed (syncs to the unit record). Stub "CH —" if no assignment.

#### 6. Connectivity detail panel
Clicking the Wi-Fi icon in the tray opens a detail panel: API URL, last successful ping timestamp, round-trip latency (ms from the health probe), and degraded reason if applicable. Panel is a 240×160 px card, dismisses on click-outside.

#### 7. Sync queue detail panel
Clicking the sync spinner (when `syncPending > 0`) opens a detail panel listing queued items (type + created timestamp). Reads from `apiFetch('/sync-queue')` if the endpoint exists, otherwise shows a count-only fallback. Includes a "Retry now" button that calls `apiFetch('/sync-queue/retry', { method: 'POST' })`.

#### 8. Battery detail tooltip
Battery icon hover shows a rich tooltip: percentage, charging status, estimated time remaining (calculated from drain rate if ≥2 readings are available in a `useRef` history). Time remaining is "~Xh Ym" format.

#### 9. Network interface info
System Dashboard (`FlexOSSystemDashboard.tsx`) already shows network interfaces from the API health endpoint. Surface the primary interface's IP address as a tooltip on the connectivity icon in the tray. No new API call — reuse what `FlexOSSystemDashboard` already fetches.

#### 10. Tray clock with timezone
The `FlexOSStatusBar.tsx` clock gains a timezone abbreviation suffix (e.g., `14:32:07 MDT`). Timezone reads from `Intl.DateTimeFormat().resolvedOptions().timeZone` and abbreviates via `toLocaleTimeString` with `timeZoneName: 'short'`.

#### 11. Quick unit-status toggle from tray right-click
Right-clicking the shift status badge shows a context menu of unit statuses: Available, Busy, On-Call, Traffic Stop, Out of Service. Selecting one calls `apiFetch('/units/my-status', { method: 'PUT', body: JSON.stringify({ status }) })`. This mirrors the existing status selector in Quick Settings but accessible without opening the panel.

#### 12. Tray overflow chevron
When tray icons exceed available width (computed via `ResizeObserver` on the tray container), a `+N` chevron appears. Clicking it opens a dropdown showing the hidden icons. The priority order (always visible first): connectivity, GPS, shift badge, radio, battery, sync.

---

## Wave 4 — CAD-Native Desktop Tools

**PR scope:** New files `DesktopCommandPalette.tsx`, `DesktopCalculator.tsx`, `DesktopCallTicker.tsx`, `DesktopStatusBoard.tsx`. Mounted in `DesktopPage.tsx`.

### Feature list

#### 1. Command palette (Ctrl+P)
Global shortcut Ctrl+P (not fired when focus is inside an iframe) opens a full-width search overlay. Input field autofocuses. Results are grouped by type:

- **Modules** — matched from `allFunctions` (already filtered by role)
- **Active Calls** — `apiFetch('/dispatch/calls?status=active&q=<query>')` top 5
- **Persons** — `apiFetch('/persons?q=<query>')` top 5 (name, DOB, ID)
- **Units** — `apiFetch('/units?q=<query>')` top 5
- **Warrants** — `apiFetch('/warrants?q=<query>')` top 5

Selecting a Module opens it as a floating window. Selecting a Call/Person/Warrant/Unit opens the corresponding detail page as a floating window. Keyboard: ↑/↓ navigate, Enter selects, Escape dismisses. Debounced 200 ms. Max 20 total results shown.

#### 2. Desktop calculator
Win+C (or from app drawer: "Calculator") opens a small floating window (280×380 px, cannot resize below 240×320). Standard calculator (0–9, +−×÷, %, √, ±, clear, backspace). Keyboard-operable. Also has a "Unit Convert" tab: mph↔kph, ft↔m, lbs↔kg, °F↔°C, mi↔km — useful for incident reporting. Persists last expression across session restarts via `sessionStorage`.

#### 3. Unit status quick-set from right-click
Desktop right-click context menu (in `DesktopPage.tsx`) gains a **Set My Status…** submenu with the 5 unit statuses. Calls the same endpoint as the tray right-click (Wave 3 feature 11). Shows current status with a checkmark. Disabled when user has no unit assignment.

#### 4. Enhanced panic button widget
The existing `DesktopPanicWidget.tsx` is replaced with an enhanced version:
- Requires a 2-second hold (not a single click) to prevent accidental activation
- Shows a countdown ring animation during the hold
- On activation: plays the panic audio chime, calls `apiFetch('/panic', { method: 'POST' })`, shows a "PANIC ACTIVE — Cancel?" overlay for 10 s
- Cancel button within 10 s calls `apiFetch('/panic/cancel', { method: 'POST' })`
- After 10 s without cancel: logs to the incident feed and sends a notification

#### 5. Call ticker overlay
An optional horizontal strip above the taskbar (`DesktopCallTicker.tsx`). When enabled (toggle in Desktop Settings), shows a scrolling marquee of active calls: `[Priority] [Call Type] — [Address]`. Marquee speed: 60 px/s. Click on a call entry opens that call in a floating window. Color-coded by priority: P1 red, P2 orange, P3 yellow, P4 white. Pauses scrolling on hover. Height: 22 px.

#### 6. Officer status board widget
`DesktopStatusBoard.tsx` — a moveable widget (like the existing widget panel items) showing all on-duty units in a compact grid: unit number, officer name, status badge, and last GPS update. Updates every 30 s via `apiFetch('/units?on_duty=true')`. Clicking a unit opens their detail page as a floating window.

#### 7. Quick new-call entry from taskbar
A `+` button added to the taskbar (between the pinned icons and the search icon) opens a condensed new-call form in a floating window. The form includes: call type (dropdown), priority (P1–P4), address (text), notes (text), and Submit. On submit, calls `apiFetch('/dispatch/calls', { method: 'POST', body })`. This is the fastest path to creating a CFS from anywhere on the desktop.

#### 8. CAD clock widget
Replaces the existing `DesktopShiftTimerWidget.tsx` (which shows shift elapsed time). The enhanced version shows:
- Shift elapsed time (HH:MM:SS, green)
- Active incident timers — one row per call the officer is assigned to, showing elapsed time since dispatch
- A "Start timer" button for manual stopwatch (for field tasks)

#### 9. Radio channel selector widget
`DesktopRadioChannelWidget.tsx` (already exists as a stub) — implement it: shows current assigned channel, a dropdown to switch between the agency's radio channels (loaded from `apiFetch('/radio/channels')`), and a mute toggle. Channel change calls `apiFetch('/units/my-channel', { method: 'PUT', body: JSON.stringify({ channel_id }) })`.

#### 10. Roll call checklist widget
`DesktopRollCallWidget.tsx` (already exists) — implement it: shows a list of officers expected on shift with a present/absent toggle per officer. Only admin/supervisor/dispatcher roles can mark officers. Submits attendance via `apiFetch('/roll-call', { method: 'POST', body })`. Read-only for officer role (shows own status only).

#### 11. Incident map mini-widget
`DesktopMiniMapWidget.tsx` already exists — enhance it: add live unit position dots (colored by unit status), update every 15 s via `apiFetch('/gps/all-units')`. Click a dot to open that unit's detail. Click the widget to expand to a full map window. Use the existing Mapbox token and `MAP_PALETTE` constants.

---

## Wave 5 — System Apps

**PR scope:** New directory `client/src/components/desktop/apps/` containing 6 new app components. Each opens as a floating window from the app drawer or keyboard shortcut.

### Feature list

#### 1. Task Manager (`DesktopTaskManager.tsx`)
Opened via Ctrl+Shift+Esc or app drawer. Floating window (600×500 px). Three tabs:
- **Windows** — lists all open floating windows: title, path, open duration, a "Focus" button and a "Close" ×
- **Sessions** — calls `apiFetch('/admin/active-sessions')` (admin only) showing logged-in users, role, last-active timestamp, and a "Force sign out" button
- **System** — embeds the existing `FlexOSSystemDashboard` content (CPU, memory, disk, uptime). Non-admin users see only the Windows tab.

#### 2. Clipboard History (`DesktopClipboard.tsx`)
Opened via Win+V or app drawer. Listens to the `copy` DOM event (requires `navigator.clipboard` read permission — prompts user on first open). Stores last 20 copied strings in `sessionStorage`. Panel (260×400 px) lists entries with timestamp, truncated preview, and a copy-again button. Clicking an entry copies it to the clipboard. A "Clear all" button wipes the history. No sensitive-data storage: strings over 500 chars are stored as `[Large text — click to re-copy]` placeholders with the full value stored only in memory.

#### 3. Snipping tool (`DesktopSnippingTool.tsx`)
Opened via Win+Shift+S or app drawer. Dims the screen to 50% opacity and shows a crosshair cursor. User drags a selection rectangle. On release: captures the selection using `html2canvas` (or the Screen Capture API where available, falling back to a `<canvas>` draw). Shows a preview in a small floating window with:
- Copy to clipboard
- Save to evidence (calls `apiFetch('/evidence/upload', { method: 'POST' })` with the image blob)
- Annotate (simple pen/text tool overlay before saving)

#### 4. Desktop Calendar app (`DesktopCalendar.tsx`)
Opened via app drawer. Floating window (700×500 px). Month and week views (toggle). Reads shift schedule from `apiFetch('/schedules/my-schedule')`. Shift days are highlighted. Clicking a day shows the schedule detail for that day. Non-interactive days (no schedule) show a blank day. Future: event creation. This wave: read-only.

#### 5. Notepad (`DesktopNotepad.tsx`)
Opened via app drawer or Win+N. Floating window (500×400 px, resizable). Plain `<textarea>` with monospace font. Toolbar: New, Save as sticky note (converts to a `DesktopStickyNote`), Copy all, Clear, word/char count footer. Auto-saves to `sessionStorage('rmpg_notepad_content')` every 2 s. A "Link to call" button (shows when a CFS floating window is open) stamps the current call number + timestamp as a header in the notepad.

#### 6. System Preferences (`DesktopSystemPreferences.tsx`)
Replaces the current `DesktopSettingsApp.tsx` inline panel with a proper floating window (560×480 px). Sidebar nav with sections:
- **Display** — wallpaper, accent color, brightness, night-light schedule
- **Sound** — master volume, individual chime volumes (alert, notify, chime), mute toggle
- **Notifications** — per-type notification enable/disable, DND schedule
- **Desktop** — icon size, view mode, sort mode, auto-arrange, widget settings
- **Theme** — theme selector (Blue & Silver / Night / Day / Legacy Black), accent color
- **Accessibility** — reduce motion toggle (disables CSS transitions in `FloatingWindow`), large text mode (bumps base font 2 px), high contrast mode (increases border contrast)
- **Window Rules** — list of saved window size/position rules (from Wave 1 feature 7), clear individual or all
- **About** — version, officer, uptime, node (same as `FlexOSAbout.tsx` content)

`DesktopSettingsApp.tsx` becomes a thin wrapper that opens `DesktopSystemPreferences.tsx` as a floating window (for backwards compatibility with existing callers).

#### 7. About FlexOS (enhanced `FlexOSAbout.tsx`)
Existing component enhanced to include: RMPG Flex version, FlexOS version, logged-in officer name + role, session start time, deployment environment (Pages project), D1 database ID (last 8 chars only, for support reference), and a "Copy diagnostic info" button that copies a JSON blob to clipboard.

#### 8. Keyboard shortcut sheet
Win+/ opens a floating window (500×600 px, scrollable) listing all registered shortcuts grouped by category: Window Management, Desktop, Taskbar, CAD Tools, Navigation. The data is a static map in `DesktopKeyboardShortcuts.tsx`. Each row: key combo (monospace chip) + description. A search field filters rows.

#### 9. Desktop theme creator
In System Preferences > Theme section: an "Advanced" expander reveals a custom accent color picker (`<input type="color">` clamped to navy-safe hues), a custom wallpaper upload field (calls `apiFetch('/preferences/wallpaper', { method: 'POST' })` with the file as multipart), and a preview panel showing a thumbnail of the current desktop with the proposed changes applied. Saving writes to `desktop_wallpaper` + `desktop_accent` in user preferences.

#### 10. Evidence scratch pad
A special variant of Notepad that opens pre-linked to the most recently focused CFS floating window. Header shows: incident number, call type, address, timestamp. Notes are saved per-incident to `apiFetch('/dispatch/calls/:id/notes', { method: 'POST' })`. Multiple officers can have open scratch pads for the same call — their saves append, not overwrite. Opened via the right-click context menu on any CFS floating window title bar ("Open Evidence Scratch Pad").

---

## Cross-wave shared concerns

### Keyboard shortcut registry
Each wave introduces new global shortcuts. To avoid conflicts, all shortcuts are registered in a single `SHORTCUT_MAP` constant in `DesktopKeyboardShortcuts.tsx`. New waves append to this map. Before registering a new shortcut, check the map for conflicts. Current reserved shortcuts (do not reuse):
- Ctrl+L → Lock screen
- Ctrl+, → Settings
- Ctrl+Alt+Delete → Power menu
- Ctrl+I → System dashboard
- Alt+Tab → Window switcher

### Z-index budget
| Layer | Z-index range |
|---|---|
| Desktop surface | 0 |
| Floating windows | 1–9999 |
| Always-on-top windows | 10001–19999 |
| Snap preview | 11000 |
| Alt+Tab switcher | 12000 |
| Notification center | 20000 |
| Quick settings | 20000 |
| P1 alert overlay | 99990 |
| Lock screen | 99995 |
| Power menu | 99995 |
| Boot splash | 99999 |

New Wave 1–5 overlays must fit within the existing budget. Snap Layouts: `win.zIndex + 1`. Snap Assist: same band. Command palette: 20000 (same as notification center — they don't co-exist). Call ticker: 100 (above desktop surface, below windows). Task Manager / System apps: normal floating window z-index.

### Accessibility minimums
All new interactive elements:
- `aria-label` on icon-only buttons (enforced by the existing TS prop requirement on `IconButton`)
- Keyboard focus ring (`:focus-visible`) — `outline: 2px solid var(--desktop-shell-accent)`
- Color is never the only signal (all status indicators have a text label or tooltip)

### Testing requirements per wave
Each wave PR must include:
- At minimum 1 vitest unit test per new major component
- No regression in existing test suites (`client/src/components/desktop/*.test.tsx`)
- TypeScript: zero new errors (`cd client && npx tsc --noEmit`)
- Client build must succeed (`cd client && npx vite build`)

---

## Implementation order within each wave

Features are numbered in recommended build order within each wave. Start with the data/state layer (window manager extensions, new API calls), then the rendering layer (new components), then the integration layer (mounting in `DesktopPage.tsx`, wiring keyboard shortcuts). This order minimizes mid-wave blockers.

---

## Transition to implementation

This spec is designed for the `superpowers:writing-plans` skill. Each wave maps to one implementation plan. Start with Wave 1.
