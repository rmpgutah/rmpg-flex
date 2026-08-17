# FlexOS Desktop — 100-Feature Windows-OS Enhancement Spec

**Date:** 2026-08-14
**Branch:** `claude/flexos-desktop-enhancements-3f0ddb`
**Total features:** 100 across 16 waves (Part 1: 1–50, Part 2: 51–100)
**Scope:** `client/src/components/desktop/`, `client/src/pages/DesktopPage.tsx`, `client/src/context/DesktopSystemContext.tsx`, `desktop/main.js` (Electron IPC for system-level features)

---

## Background

FlexOS is a police CAD/RMS desktop shell running inside Electron on Panasonic Toughbook FZ-55 units. The shell already ships ~60 features: taskbar, quick settings, notification center, virtual desktops, snap layouts (left/right halves), lock screen, screen saver, night light, window manager, 8 desktop apps, 17 widgets, and a full kiosk mode. This spec advances FlexOS to full Windows 11-parity for field law-enforcement use across 100 discrete features organized into 16 waves.

## Architecture Invariants (enforced on every feature)

- **No hardcoded hex** — all colors via CSS vars (`var(--surface-*)`, `var(--text-*)`, `var(--accent-silver-*)`, `var(--accent-gold-*)`, `var(--sev-*)`)
- **2 px radius everywhere** — `style={{ borderRadius: 2 }}` or `rounded-[2px]`. Never `rounded-lg`
- **Theme tokens only** — new components must not stamp additional `html` theme classes
- **`apiFetch` not raw `fetch`** — all new API calls from the renderer use `apiFetch` from `client/src/hooks/useApi.ts`
- **D1 100-param cap** — any new API call filtering by a list uses `queryInChunks`
- **No `SELECT *` on `calls_for_service`** — explicit column lists only
- **Tests green before each PR** — `npx vitest run` (worker) + `cd client && npx vitest run` (client)
- **Electron IPC only via `guardedHandle`/`guardedOn`** in `desktop/main.js` — never expose raw Node APIs to renderer

---

## PART 1 — Features 1–50

### Wave 1 — Shell Enhancements (8)

**1. Taskbar peek / thumbnail preview**
Hover a taskbar button for 400 ms → render a 240×160 live iframe thumbnail of that floating window above the button. Dismiss on mouse-leave. `FloatingWindow.tsx` exposes a `ref` to its root div; `DesktopTaskbar.tsx` uses `element.getClientRects()` to position the preview. Implementation: CSS `scale(0.2)` transform-origin thumbnail captured via a hidden absolutely-positioned clone div scaled into a fixed preview card.

**2. Taskbar auto-hide**
When enabled in Settings, the taskbar collapses to a 4 px hot strip at the bottom. Mouse-within-4-px-of-bottom triggers a CSS slide-up transition (200 ms). `taskbarPreferences.ts` stores `autoHide: boolean`. `DesktopPage.tsx` passes `autoHide` to `DesktopTaskbar`; taskbar uses a `mouseenter`/`mouseleave` pair with a 300 ms show delay and 1 s hide delay (prevents accidental collapse during rapid cursor movement).

**3. Focus Assist / DND mode**
Three levels: Off / Priority Only / Alarms Only. Stored in `DesktopSystemContext` as `focusAssist: 'off'|'priority'|'alarms-only'`. `DesktopNotificationCenter.tsx` checks this before surfacing a toast — non-P1 notifications are suppressed when `alarms-only` is active; non-panic/welfare notifications are suppressed under `priority-only`. Quick Settings panel exposes a 3-state toggle. An automatic rule: Focus Assist activates when an officer has an `active` call status.

**4. Desktop right-click context menu**
Right-clicking the wallpaper area (not an icon, widget, or taskbar) opens a context menu with: Sort Icons (by name / type / date), Auto-arrange toggle, Hide/Show desktop icons, Refresh, New Sticky Note, Change Wallpaper (opens wallpaper picker in Settings). Implemented by wiring `onContextMenu` on `DesktopPage`'s root div — offset-checked against icon/widget hit-test regions.

**5. Snap-to-quarter (corner snap)**
Extend existing `SnapLayouts.tsx` snap zones to include 4 corner quarters when the viewport is ≥1200 px wide. Dragging a window to within 12 px of a corner triggers a corner-snap preview zone. On drop, the window fills that quarter. `FloatingWindow.tsx` already handles the snap preview shade; the zone boundary logic is the only change.

**6. Taskbar badge / count overlays**
`DesktopTaskbar.tsx` receives a `windowBadges: Record<windowId, number>` prop from `DesktopPage`. The badge count comes from the floating window's title (if it contains a parenthetical number, e.g. "Dispatch Console (3)") or from an explicit `badge` prop on the window state. Rendered as an absolute-positioned 16 px red pill in the top-right corner of the taskbar button.

**7. Window grouping in taskbar**
When multiple floating windows share the same base route (e.g., two `/dispatch` windows), the taskbar shows a single grouped button with a stacking badge count. Clicking the grouped button opens a small flyout listing all windows in the group by title; clicking a list item focuses that window. `DesktopTaskbar.tsx` computes groups by `window.path` prefix.

**8. Quick Launch bar**
A secondary strip of 4 pinnable icons rendered directly above the taskbar's right-side clock. Separate from the main icon grid — always visible, not scrolled. User right-clicks any icon grid icon → "Pin to Quick Launch". Stored in local config as `quick_launch_pins: string[]`. `DesktopTaskbar.tsx` renders the strip inline.

---

### Wave 2 — System Apps (8)

**9. File Manager**
A floating window app (`/desktop-file-manager`) that uses the `sys:list-user-data-dir` IPC to enumerate subdirectories of `app.getPath('userData')`. Shows: logs/, evidence/, cache/, crash-dumps/. Each file row has: name, size, modified date, "Open folder" (shell.openPath) and "Delete" (with confirmation dialog). Read-only on files outside `userData`. `desktop/main.js` adds `guardedHandle('fs:list-dir', ...)` and `guardedHandle('fs:delete-file', ...)` with path validation via `validateFilePathInput`.

**10. Timer & Stopwatch**
A floating window app (`/desktop-timer`) with two tabs: Countdown and Stopwatch. Countdown: numeric input for minutes + seconds, start/pause/reset, browser `Notification` + audio beep on zero. Stopwatch: millisecond precision, lap recording, copy laps to clipboard. Optionally links a countdown to an active call (auto-populates from welfare check interval).

**11. Unit Converter**
A floating window app (`/desktop-converter`) with category tabs: Speed (mph↔km/h), Distance (ft↔m, mi↔km), Weight (lbs↔kg), Temperature (°F↔°C). Each tab has two inputs — editing either updates the other. Copy-to-clipboard button on each result. CAD-relevant: the speed tab also shows "ft/s" for pursuit calculations.

**12. Color Picker**
A floating window app (`/desktop-color-picker`). Uses `eyeDropper` API (`new window.EyeDropper().open()`) to sample any screen pixel. Displays the picked color's hex, RGB, and HSL values. Shows a large color swatch. History of last 12 picked colors (click to re-select). Copy hex/RGB/HSL to clipboard buttons.

**13. Screen Magnifier**
A floating always-on-top window that renders a zoomed view of the region under the cursor. Zoom level: 2×/4×/8× via keyboard shortcuts. Implemented via a canvas element that captures the screen region using `html2canvas` on a 50 ms rAF loop, targeting the cursor's viewport coordinates. Toggle on/off via Quick Settings or Win+Plus.

**14. Print Dialog**
A floating window that lists available printers via the `sys:printers` IPC handler (`formatPrinters` from `fileOps.js` already exists). User selects printer, clicks "Print Current View" — triggers `mainWindow.webContents.print({ printer })` via a new `window:print` IPC channel. Also exposes "Print to PDF" (saves to `userData/exports/`).

**15. Event Viewer**
A floating window app (`/desktop-event-viewer`) that reads from the `error_log` D1 table via `GET /api/errors` (admin/manager only). Columns: timestamp, severity, category, message, source, trace ID. Filterable by severity level and time range. Also shows the local `rmpg-flex.log` tail via `sys:logs` IPC. Two tabs: API Errors / Local Log.

**16. Media Player**
A floating window app (`/desktop-media-player`). Loads video/audio files from the evidence cache via `fs:list-dir` (filtered to `.mp4`, `.mov`, `.wav`, `.mp3`). HTML5 `<video>` and `<audio>` elements render the content. Controls: play/pause, seek bar, volume, speed (0.5×/1×/1.5×/2×), fullscreen. Keyboard shortcuts: Space (play/pause), Left/Right (±10 s), M (mute).

---

### Wave 3 — System-Level Controls (7)

**17. Power Plans**
Three plans: High Performance (disables `powerSaveBlocker` release on minimize, keeps screen on), Balanced (default — releases blocker after 10 min idle), Battery Saver (limits background sync to 5 min intervals, dims after 2 min idle). Stored in local config as `power_plan: 'high'|'balanced'|'saver'`. Quick Settings exposes a 3-way toggle. `DesktopSystemContext` publishes the plan; `DesktopPage` wires it to `sys:set-power-plan` IPC which manages `powerSaveBlocker.start/stop`.

**18. Display Settings panel**
A Settings tab (in `DesktopSettingsApp`) showing: current resolution (read-only from `sys:info`), DPI scaling (50%–200% CSS zoom on the root `:root` element), Night Light schedule (already in `DesktopNightLightOverlay` but not in Settings), display brightness (Windows: IPC call to PowerShell `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, N)`).

**19. Audio Volume Mixer**
Quick Settings panel adds a master volume slider using `window.electronAPI.setVolume(n)` IPC → `mainWindow.webContents.setAudioMuted(false)` + `systemPreferences.getUserDefault('com.apple.sound.beep.volume')` on macOS / `nircmd setsysvolume` on Windows. A secondary slider per open floating window using the Web Audio API `GainNode` if the window contains `<audio>`/`<video>`.

**20. Wi-Fi Network Picker**
A Quick Settings flyout listing available Wi-Fi networks via `sys:wifi-networks` IPC → Windows: `netsh wlan show networks mode=bssid` / macOS: `/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s`. Parsed into `{ ssid, signal, secured }` entries. Click → `sys:wifi-connect` IPC → `netsh wlan connect name=<ssid>`. Secured networks prompt for password via a native dialog.

**21. Bluetooth Manager**
A Settings tab showing paired and nearby Bluetooth devices via `sys:bluetooth-devices` IPC → PowerShell `Get-PnpDevice -Class Bluetooth`. Displays: device name, status (connected/paired/available), connect/disconnect/remove buttons. New device pairing opens Windows' own Bluetooth settings via `shell.openExternal('ms-settings:bluetooth')`.

**22. Storage Usage Panel**
A Settings tab showing a bar chart of `userData` disk usage by category (evidence, logs, exports, cache, crash dumps) alongside total free/used disk space from `sys:disk-space`. One-click "Clean old logs" (deletes log entries older than 30 days), "Clear evidence cache" (with confirmation), "Clear HTTP cache" (via `window:clear-cache` IPC).

**23. Date & Time Settings**
A Settings tab with: timezone selector (IANA zone list, defaults to America/Denver), 12h/24h clock toggle, "Sync with NTP" button (Windows: `w32tm /resync`, macOS: `sntp -sS pool.ntp.org`). All changes persist via `setConfig`. The clock widget and lock screen clock both read from the same `timeFormat`/`timezone` preference.

---

### Wave 4 — Productivity Tools (7)

**24. Clipboard History**
Win+V opens a floating Clipboard History panel. Stores the last 20 clipboard entries in local config as `clipboard_history: string[]` — appended on every `clipboard:set` IPC call. Panel shows each entry truncated to 2 lines; click to copy back to clipboard; right-click → "Pin" (persists across sessions), "Delete". Pinned items render at the top with a pin icon.

**25. Screenshot Annotation**
After a snip is captured in `DesktopSnippingTool`, the captured canvas enters an annotation mode with: Arrow tool (click-drag draws an arrowhead line), Text tool (click → type label, drag to reposition), Rectangle highlight (semi-transparent yellow fill). Toolbar across the top. "Save" writes the annotated PNG to `userData/exports/`; "Copy" puts it on the clipboard; "Attach to Call" posts it to the active call's field photos.

**26. Voice Memo Recorder**
A Quick Launch / tray-accessible floating mini-app. One big record button (MediaRecorder API, `audio/webm`). Shows live waveform visualizer via `AnalyserNode`. On stop: auto-names the file `voice-memo-<timestamp>.webm`, saves to `userData/voice-memos/`, optionally links to the active call ID. Listing of past memos in the same window with play/delete.

**27. Text Expander / Quick Phrases**
A Settings tab where users define shortcodes and expansions (e.g. `mir` → full Miranda warning text, `10-4` → "Acknowledged"). Stored in local config as `text_expanders: {code, expansion}[]`. A global `keydown` interceptor in `DesktopKeyboardShortcuts` detects space/tab after a code and replaces the last N characters in the focused `<textarea>` or `contenteditable` element.

**28. QR Code Generator**
A floating mini-app that accepts any text input and renders a QR code via a pure-JS QR encoder (no external CDN — bundle `qrcode-generator` npm package). Pre-populated from active call URL when launched from a call record. Displays the QR at 300×300 px; "Save PNG" writes to exports; "Print" triggers the print dialog.

**29. Barcode Lookup Panel**
A persistent docked mini-panel (or Quick Launch app) that listens for the `hardware:barcode-scanned` IPC event already fired by `main.js`'s keystroke burst classifier. On scan: auto-determines if payload is a plate, ORI number, state ID barcode, or VIN, then fires the appropriate RMS lookup. Results shown inline in the panel with links to the full record.

**30. Evidence File Export**
A floating app that presents all files in `userData/evidence/` as a multi-select list. "Export selected" packages the chosen files into a timestamped ZIP (using the browser's native `CompressionStream` API) with a `manifest.json` containing each file's SHA-256 hash (via `crypto.subtle.digest`), capture timestamp, and linked call ID. Downloaded via a Blob URL.

---

### Wave 5 — CAD-Native Widgets (8)

**31. BOLO Ticker Widget**
Horizontally scrolling ticker that pulls `GET /api/dispatch/bolos?active=1&limit=20` every 60 s. Each BOLO entry shows: suspect description snippet + vehicle + priority badge. Click a BOLO → opens the full BOLO record in a floating window. Scrolls at a configurable speed (1–5 setting in widget context menu). Pauses scroll on hover.

**32. Hot Zones Widget**
A 200×200 mini-map (reuses `DesktopMiniMapWidget` base) that overlays a heatmap of incident density for the past 24 h. Uses `GET /api/dispatch/calls/heatmap?hours=24` to fetch `[{lat,lng,weight}]` grid data, renders via canvas `fillRect` with opacity proportional to weight. Tap → opens full `MapPage` with the heatmap layer active.

**33. Dispatch Queue Widget**
Shows the current pending/queued calls awaiting dispatch via `GET /api/dispatch/calls?status=pending,queued`. Renders as a compact list: call number, nature, priority badge, time waiting. Auto-refreshes every 15 s. Red highlight if any call has waited >5 min past SLA. Click a row → opens the call in the Dispatch Console floating window.

**34. Unit Proximity Widget**
User drops a pin on a mini-map (or uses current GPS position). Widget shows the nearest N units sorted by distance, with their unit ID, officer name, status, and straight-line distance. Data from `GET /api/dispatch/units/proximity?lat=&lng=&limit=5`. Updates every 30 s. Tap a unit → opens its detail in the MDT.

**35. License Plate Quick-Search Widget**
A text input widget. Type or scan a plate → fires `POST /api/vehicles/plate-lookup` → shows: vehicle make/model/color/year, registered owner, stolen flag (red badge), active warrants on owner (amber badge). Results display inline below the input. History of last 5 plates in a dropdown.

**36. Address / Parcel Lookup Widget**
Type an address → auto-complete via Mapbox Geocoding → fires `GET /api/geography/parcel?address=` → shows: parcel owner, zoning, call history count (last 90 days), known persons at address. One-click to open in MapPage pinned to that address.

**37. Shift Performance Widget**
Reads `GET /api/dispatch/shift-stats?officer_id=&date=today`. Displays: calls handled, avg response time (minutes), miles driven (from GPS trail), active hours, priority breakdown (P1/P2/P3 counts). Refreshes every 5 min. Tap → opens full shift analytics in a floating window.

**38. Radio Log Widget**
Displays the last 20 radio traffic entries from `GET /api/dispatch/radio-log?limit=20`. Each entry: timestamp, channel, transcription snippet, officer ID. Auto-scrolls to newest. Pause-on-hover. "Filter by channel" dropdown. Updates every 30 s via the existing 15 s polling infrastructure.

---

### Wave 6 — Desktop Enhancements (5)

**39. Wallpaper Slideshow**
`DesktopWallpaper.tsx` adds a slideshow mode. When enabled (via Settings), it cycles through all available wallpaper IDs on a user-configured interval (5 / 15 / 30 / 60 minutes). Uses a CSS cross-fade transition (0.8 s opacity transition between two absolutely-stacked `<img>` layers). Stored as `wallpaper_slideshow: { enabled, intervalMinutes }` in local config.

**40. Desktop Icon Label Editing**
In `DesktopIconGrid.tsx`, double-clicking the label beneath an icon enters an inline `<input>` edit mode. On blur or Enter, the new label is saved to local config as `icon_labels: Record<path, string>`. The label overrides the default module name from `navCatalog`. Escape cancels. Label is truncated at 20 characters; tooltip shows the full label.

**41. Widget Library Drawer**
An "Add Widget" floating panel listing all registered widget types with a name, icon, and one-line description. Click a widget → adds it to the widget panel at a default position. Widget types already visible on the desktop are shown with a checkmark; clicking them removes them after confirmation. Opened from the desktop right-click menu or taskbar settings.

**42. Desktop Theme Export / Import**
In `DesktopSettingsApp`, a "Themes" tab with "Export Theme" (downloads a JSON file containing: wallpaper ID, accent ID, widget positions/states, icon grid layout, taskbar size, night light schedule) and "Import Theme" (reads a JSON file via `<input type=file>`, validates the schema, applies all settings, shows a diff of what changed).

**43. High Contrast Mode**
A toggle in Accessibility settings that stamps `html.theme-high-contrast` which overrides palette vars: `--surface-base: #000`, `--surface-raised: #000`, `--text-primary: #fff`, `--text-secondary: #ff0`, borders at `2px solid #fff`. All existing theme-variable-backed components automatically inherit it. Also triggers `prefers-contrast: more` media query support.

---

### Wave 7 — Security & Compliance (4)

**44. Session Activity Log Viewer**
A Settings tab showing per-session events logged to the `error_log` table (category='session'): login, logout, module opens, lock/unlock, failed PINs. Filterable by date range and event type. Admin/manager only. Export to CSV button.

**45. Configurable Auto-Lock Timer**
A Settings control: "Lock screen after N minutes of inactivity" (choices: 1 / 5 / 10 / 15 / 30 / Never). Stored as `auto_lock_minutes: number | null`. `DesktopScreenSaver.tsx` already has idle detection; it passes `isIdle` to `DesktopPage`, which triggers the lock screen after `auto_lock_minutes` minutes instead of the hardcoded screensaver threshold.

**46. Device / Workstation ID Panel**
A Settings tab showing: device fingerprint (from `getOrCreateDeviceId()` in `sessionAuth.js`), hostname (`os.hostname()`), primary MAC address, serial number (Windows: `wmic bios get serialnumber`), last-seen timestamp, Electron version, app version. "Copy all to clipboard" for IT support. No edit controls.

**47. Remote Admin Lock**
Admin sends `POST /api/desktop/remote-lock { device_id }` → Worker queues a WebSocket push message to the target session. The desktop's existing `useLiveSync` hook receives a `desktop:remote-lock` WS message → calls `onLock()` in `DesktopPage`. The lock is permanent until the officer manually unlocks. Logged to `error_log` with category='security'.

---

### Wave 8 — Communication & Integration (3)

**48. In-App Phone Dialer**
A floating mini-app with a standard 12-key dial pad. "Click to call" from any person record fires `tel:` protocol via `shell.openExternal('tel:NNNN')` (hands off to the system's default phone app or VoIP client). Also supports direct manual dial. Call log shows last 10 dialed numbers from local config. Integrated into the person record popup as a phone icon.

**49. Emergency Alert Broadcast**
A supervisor-only floating app. Type a message (max 160 chars), select scope (all online officers / specific units / specific district). `POST /api/dispatch/broadcast { message, scope }` → Worker fans out a WebSocket `dispatch:broadcast` message to all targeted sessions. The receiving desktop shows a full-screen P1-style overlay with the message, officer must tap "Acknowledged" to dismiss. Logged to `error_log`.

**50. Multi-Unit Message Broadcast Widget**
A widget with a multi-select officer list (from `GET /api/dispatch/units?status=active`) and a text input. "Send" posts to `POST /api/messages/bulk { recipient_ids, content }`. Shows send status per recipient inline. Collapses to a compact "Broadcast" button when not composing. Supervisor role required.

---

## PART 2 — Features 51–100

### Wave 9 — Window Management Depth (6)

**51. Aero Shake (window shake minimizes others)**
Already partially referenced — confirm implementation in `FloatingWindow.tsx`: detect a rapid horizontal drag gesture (≥4 direction reversals within 600 ms, each >40 px) on the title bar. On classification: minimize all OTHER non-minimized windows. Second shake → restore them. State stored in `DesktopWindowManager` as `preShakeMinimized: string[]`.

**52. Title-bar double-click maximize**
`FloatingWindow.tsx` adds `onDoubleClick` on the title bar div → toggles maximize/restore. Currently missing as an explicit gesture (the maximize button exists but the title-bar double-click does not). One-line addition.

**53. Always-on-top per-window toggle**
Title-bar context menu (from Part 1 feature #3) adds "Always on Top" toggle. Implementation: `DesktopWindowManager` stores `alwaysOnTop: boolean` per window in the window state. `FloatingWindow.tsx` applies `zIndex: 9999` when true and renders a pin icon in the title bar.

**54. Window opacity per-window slider**
The title-bar context menu adds an "Opacity" submenu with a live slider (20%–100%). Already partially present as a widget-level feature in `DesktopWidgetPanel` — extend the same `opacity` pattern to `FloatingWindow` windows. The `FloatingWindow` root div gets `style={{ opacity: win.opacity ?? 1 }}`.

**55. Recently closed windows restore**
`DesktopWindowManager` stores the last 5 closed windows (path + title + last bounds) in a `closedWindowHistory` array. Ctrl+Shift+T reopens the most recently closed one at its last position. A "Recently Closed" submenu in the taskbar right-click context menu shows all 5.

**56. Minimize all / Show desktop**
A small clickable zone (8×8 px) in the far bottom-right corner of the taskbar (Windows "Show Desktop" button). Click → minimizes all floating windows (`windows.forEach(w => minimizeWindow(w.id))`). Second click → restores them. Win+D keyboard shortcut wired in `DesktopKeyboardShortcuts`.

---

### Wave 10 — Advanced Shell (7)

**57. Dynamic / time-based wallpaper**
`DesktopWallpaper.tsx` adds a "Dynamic" wallpaper option. At 06:00 it switches to the day wallpaper; at 20:00 it switches to the night wallpaper. Uses the `themeSchedule.ts` time resolution already in the codebase. Configured in Settings: choose a day wallpaper ID and night wallpaper ID.

**58. Taskbar clock with calendar flyout**
Clicking the clock area in `DesktopTaskbar` opens a calendar flyout (a mini monthly calendar). The current date is highlighted. Dates with scheduled events (from `DesktopCalendar`'s stored events) show a dot indicator. Navigate months with chevron buttons. Click a date → opens `DesktopCalendar` app focused on that date.

**59. Taskbar search bar**
An inline search input rendered in the center of `DesktopTaskbar` (between the app drawer button and the clock). Typing opens the `DesktopCommandPalette` pre-populated with the typed query. The input itself is a thin 200 px field styled to match Windows 11's taskbar search. Hidden in kiosk mode.

**60. Taskbar tray overflow**
When tray icons in `DesktopSystemTray` exceed 6, excess icons are hidden behind an "^" overflow button. Clicking it opens a flyout grid of the hidden icons. Drag an icon from the overflow into the main tray row to pin it there. Order and pinned state stored in `tray_icon_order: string[]` local config.

**61. Pin to taskbar from floating window**
Right-clicking the title bar of any floating window → "Pin to Taskbar" → adds the window's route to `quick_launch_pins` (the Quick Launch bar from Feature 8). Only available for windows that have a stable route (not ephemeral dialogs). A filled pin icon appears in the title bar corner when pinned; click it to unpin.

**62. Desktop icon context menu: navigate to module**
Right-clicking a desktop icon shows: Open, Open in New Window, Pin/Unpin, Rename (Feature 40), Navigate to (opens the route in the main SPA tab rather than in a floating window), Delete shortcut. "Navigate to" is useful on low-memory devices where multiple floating windows are expensive.

**63. Recycle Bin icon**
A special always-present desktop icon that tracks recently removed pinned icons in `deleted_icons: {path, label, deletedAt}[]` local config. Right-click → "Restore All" or "Empty Recycle Bin." Double-click → opens a small list of deleted icons, each with a "Restore" button. The icon shows a full/empty visual state based on whether `deleted_icons` is non-empty.

---

### Wave 11 — System Information & Diagnostics (7)

**64. Performance Monitor**
A floating app (`/desktop-perfmon`) with live charts (rendered via SVG path — no external charting library) showing CPU %, RAM %, network rx/tx bytes/s, and disk read/write bytes/s. Data polled every 2 s via `sys:cpu-usage` IPC + a new `sys:perf-snapshot` IPC handler that returns `{ cpu, memUsed, memTotal, netRx, netTx, diskRead, diskWrite }` from `os.cpus()`, `os.freemem()`, `os.totalmem()`, and Node's `process.resourceUsage()`.

**65. Resource usage history (Task Manager enhancement)**
`DesktopTaskManager.tsx` adds a "History" tab. A ring buffer of 300 samples (10 min at 2 s interval) is stored in `DesktopSystemContext`. Rendered as 300 px wide SVG sparklines for CPU, RAM, and network. Hover shows exact values at that time. "Export CSV" downloads the buffer.

**66. Network diagnostics tool**
A floating app (`/desktop-netdiag`) with four tools:
- Ping: `sys:ping` IPC → `ping -c 4 api.rmpgutah.us` → parse RTT
- Traceroute: `sys:traceroute` IPC → streamed output
- DNS lookup: `sys:dns-lookup` IPC → `dns.lookup()` in Node
- Speed test: measures download time for a known-size endpoint on `api.rmpgutah.us`

**67. Device health panel**
A Settings tab listing connected hardware devices: GPS (port, fix status, age), barcode scanner (last scan timestamp), body cam (status from `sys:body-cam-status`), TPM (from `sys:tpm-status`), battery (from `sys:battery`). Each device shows a green/amber/red health indicator. "Run hardware self-test" button triggers `runHardeningSelfTest()` IPC.

**68. Startup programs manager**
A Settings tab listing modules that auto-open on desktop load (currently hardcoded to Dispatch Console via `CadAutoOpen`). User can disable the auto-open and add other routes to the auto-open list. Stored as `startup_windows: { path, title, width, height, delay }[]`. `CadAutoOpen` becomes data-driven from this config.

**69. FlexOS configuration snapshot**
"Settings > Backup & Restore" tab. "Create Snapshot" writes a JSON blob of all `getConfig()` keys (excluding secrets) to `userData/snapshots/<timestamp>.json`. "Restore" shows a list of snapshots with timestamps, previews the diff of changed keys, applies it on confirm. "Delete" removes a snapshot. This gives officers an escape hatch if a settings change breaks something.

**70. Hardware diagnostics report exporter**
A button in the Device Health panel that generates a full diagnostics bundle: CPU info, RAM, disk, battery, GPS fix, TPM, network interfaces, app version, device ID, last 50 log lines. Formatted as plain text. "Save report" writes to `userData/exports/diagnostics-<timestamp>.txt`; "Email IT" opens a `mailto:` with the report as the body.

---

### Wave 12 — Accessibility (6)

**71. System-wide text size scaling**
A Settings > Accessibility slider: 100% / 115% / 130% / 150%. Applies `document.documentElement.style.fontSize = N + '%'` on the root element. All `rem`-based sizing (which most FlexOS components use via Tailwind) scales automatically. Stored as `text_scale_percent: number` in local config. Applied at boot before first render.

**72. Full keyboard navigation mode**
`DesktopPage` adds a `keyboardNav` mode toggled by F6 or via Accessibility settings. In this mode: the taskbar, icon grid, widget panel, and Quick Settings are Tab-navigable with visible focus rings (2 px `--sev-warn` outline). Arrow keys navigate within each zone. Enter activates the focused item. Escape returns focus to the desktop root.

**73. Sticky Keys**
An Accessibility toggle. When enabled, `DesktopKeyboardShortcuts.tsx` intercepts solo Shift/Ctrl/Alt/Win presses and holds them as "latched" modifiers — a visual indicator pill appears in the taskbar corner showing the latched modifier. The next non-modifier keydown fires the combination. Second press of the same modifier unlatches it.

**74. Screen reader live announcements**
All incoming `dispatch:call-updated`, `dispatch:broadcast`, and P1-level alerts trigger an update to a visually-hidden `aria-live="assertive"` region in `DesktopPage`. The announcement includes: event type, call number, priority, and nature. This lets officers using a screen reader hear incoming alerts without visual focus.

**75. Custom cursor size & color**
A Settings > Accessibility section with a cursor size slider (16 px / 24 px / 32 px / 48 px) and a color picker (default silver, options: white, yellow, red). Applied via a CSS custom cursor `url()` generated at runtime as an SVG data URI with the selected color and size. Stored as `cursor_size`, `cursor_color` in local config.

**76. Reduced motion mode**
A Settings > Accessibility toggle that stamps `html.reduced-motion` on the root. A global CSS rule: `html.reduced-motion * { transition-duration: 0ms !important; animation-duration: 0ms !important; }`. All FlexOS animations (window slide-in, notification toast, taskbar auto-hide) immediately respect this without per-component changes.

---

### Wave 13 — Network & Connectivity (6)

**77. VPN status widget**
Shows active VPN connection status via `sys:vpn-status` IPC → Windows: `Get-VpnConnection -AllUserConnection | Where Status -eq Connected` / macOS: `scutil --nc list`. Displays: VPN name, server, connected duration, estimated latency. Connect/disconnect buttons. Updates every 30 s. Red/green status dot.

**78. Network speed test**
A panel in Network Settings (or standalone floating app). "Run test" fetches a 1 MB file from `api.rmpgutah.us/api/health-large` (a new Worker route returning a dummy payload), measures elapsed time → computes Mbps. Also pings 5 times → avg/min/max latency. Results displayed with color-coded grades (green ≥25 Mbps, amber ≥5 Mbps, red <5 Mbps).

**79. Mobile hotspot toggle**
A Quick Settings tile "Mobile Hotspot." Click → `sys:hotspot-toggle` IPC → Windows: PowerShell `Set-NetConnectionSharing` / macOS: `networksetup -createnetworkservice`. Shows current state (On/Off) and connected device count when On. Non-functional on macOS (shows "not supported" tooltip) since macOS hotspot requires System Preferences.

**80. IP / MAC display panel**
A Quick Settings flyout (or Device Health tab section) listing: primary IPv4, IPv6, MAC address, default gateway, DNS servers, public IP (fetched from `api.rmpgutah.us/api/health` response headers). Each row has a "Copy" button. One "Copy all" button formats everything as a block of text for IT support.

**81. Firewall status indicator**
A tray icon badge (amber shield) that appears when Windows Defender Firewall is disabled. Polled every 5 min via `sys:firewall-status` IPC → PowerShell `Get-NetFirewallProfile | Select Enabled`. Click the badge → opens Windows Security via `shell.openExternal('windowsdefender:')`. No-op on non-Windows.

**82. Certificate expiry panel**
A Security Settings tab that shows the TLS certificate for `rmpgutah.us` and `api.rmpgutah.us` — fetched via `sys:cert-info` IPC → Electron's `app.on('certificate-error')` cached data or a fresh `net.request` + response `certificate` event. Displays: issuer, subject, valid from/to, days until expiry. Red badge if <30 days.

---

### Wave 14 — Security Hardening (5)

**83. Config tamper detection**
At boot, `main.js` hashes all config values via `crypto.createHash('sha256')` and stores the hash in a write-once location (`app.getPath('temp')/rmpg-config-hash`). On each subsequent boot, re-hashes and compares. If any security-relevant key changed outside the app (e.g., `kiosk_shell_enabled`, `admin_offline_secret`), the desktop shows a modal warning and logs to `error_log` category='security'.

**84. USB device whitelist**
`main.js` subscribes to WMI device-arrival events via `child_process.spawn('powershell', ['Register-WmiEvent ...'])` (Windows only). On a new USB device connection, checks against a `usb_whitelist: string[]` local config (device instance IDs). Unknown device → desktop toast notification: "Unknown USB device connected: [name]. Contact IT." Logged to the security audit log.

**85. Screen privacy filter mode**
A Quick Settings tile "Privacy Screen." Applies a CSS vignette overlay: a radial gradient that darkens the outer 30% of the viewport while leaving the center 40% at full brightness. The effect is visible from side angles but not straight-on. Also dims the screen brightness to 30% via the display IPC. Toggle on/off. Hotkey: Ctrl+Shift+P.

**86. Geo-fence auto-lock**
A Security Settings section. Admin defines a geo-fence as a center lat/lng + radius (miles). Stored in local config. `internalGps.js` publishes GPS position every 30 s; the main process checks if the position is outside the fence. If outside for >60 s, sends `desktop:geo-lock` to the renderer, which triggers the lock screen. Officer must re-authenticate to continue. The fence is displayed on a small mini-map in Settings.

**87. Credential vault**
A Settings section "Officer Vault." Officers store sensitive text values (radio code book, door codes, locker combinations) encrypted via `safeStorage.encryptString` in local config under `officer_vault: {label, ciphertext}[]`. The vault is locked behind PIN authentication (uses the existing `pinManager` flow). On unlock, values are decrypted in memory only and displayed for 60 s before re-locking. No value is ever written to the clipboard without explicit user action.

---

### Wave 15 — CAD-Native Apps (8)

**88. Plate reader history app**
A floating window app (`/desktop-alpr-history`) that queries `GET /api/alpr/captures?limit=100`. Shows a table: timestamp, plate text, make/model/color, confidence %, stolen flag, call ID. Click a row → expands to show the captured image thumbnail + full vehicle details. Filter by: date range, stolen-only, confidence threshold. Export to CSV.

**89. Warrant search app**
A floating window (`/desktop-warrants`) with full filter controls: name, DOB, warrant type, status, issuing court, assigned officer. Results table with click-to-expand. "Flag for service" button assigns the warrant to the officer's active call. Reuses the existing `WarrantsPage` API endpoints but in a compact floating UI sized 900×600.

**90. Incident timeline app**
A floating window app (`/desktop-incident-timeline?call_id=X`) showing a vertical timeline of all events for a single call: creation, unit assignments, status updates, radio traffic, photos attached, officer notes, clearance. Each event shows: timestamp, actor (officer/system), event type icon, detail text. Printable via the print dialog.

**91. Shift briefing app**
Auto-opens at the start of each shift (detected when the officer transitions from `off_duty` to any on-duty status). Shows: active BOLOs, top active warrants in area, recent person-of-interest flags, weather, staffing (who else is on duty). Read-only. "Acknowledge" button dismisses. Data from multiple existing API endpoints aggregated in one view.

**92. Mutual aid tracker app**
A floating window (`/desktop-mutual-aid`) listing all active calls with units from external agencies. Columns: call number, type, location, requesting agency, assisting agencies, units deployed. Refreshes every 60 s from `GET /api/dispatch/calls?has_mutual_aid=true`. "Request mutual aid" button on each call fires a structured request.

**93. Evidence photo viewer**
A floating window (`/desktop-evidence-photos?call_id=X`) showing a lightbox-style grid of all photos attached to a call. Click → full-screen with zoom/pan (CSS transform). Arrow keys navigate between photos. Shows: filename, captured timestamp, officer, GPS coordinates. Download and "Attach to report" buttons.

**94. Use-of-force quick-report**
A floating form app (`/desktop-uof-report?call_id=X`) with structured fields: subject description, use of force type (checkboxes), officer action taken, injuries (checkboxes), medical provided, supervisor notified. Generates a UoF report record via `POST /api/records/use-of-force`. Links to the call record automatically. Supervisor is auto-notified via the broadcast system.

**95. Digital citation generator**
A floating form app (`/desktop-citation?call_id=X`) with fields: violator name/DOB/address (auto-populated from linked person record), violation code, location, vehicle info, officer signature field (touchscreen draw). Generates a citation PDF via the existing `jsPDF` pipeline. Prints via the print dialog. Saves a copy to `userData/exports/citations/`.

---

### Wave 16 — CAD-Native Widgets Part 2 (5)

**96. Active warrants count widget**
Displays a live count from `GET /api/warrants?status=active&count=true`. Shows total count + breakdown by type (arrest warrant, bench warrant, civil). Color-coded: green <10, amber 10–50, red >50. Tap → opens the Warrant Search app (Feature 89) pre-filtered to active warrants. Refreshes every 5 min.

**97. Officer safety flag widget**
Queries `GET /api/intel/safety-flags?area=<officer_district>`. Shows a compact list of persons with active officer-safety flags in the officer's assigned district. Each entry: name, flag type (violent history, weapons, mental health), last seen address. Tap → opens the person record. Updates every 10 min.

**98. Priority call escalation widget**
Queries pending/queued calls and checks elapsed time against configurable SLA thresholds (P1: 3 min, P2: 8 min, P3: 20 min). Shows calls that have breached SLA sorted by severity. Red pulsing border when any P1 is over threshold. Tap a row → opens the call in Dispatch Console. Refreshes every 30 s.

**99. Evidence chain-of-custody widget**
Queries `GET /api/evidence/pending-actions?officer_id=current`. Shows evidence items that need officer action: unsigned transfer, expiring hold, required lab submission. Each item shows: evidence ID, item description, action required, due date. Tap → opens the evidence record. Amber badge on the widget icon when any item is overdue.

**100. Mutual aid status widget**
Displays a count of units from partner agencies currently active on calls in the jurisdiction. Data from `GET /api/dispatch/units?type=mutual_aid&status=active`. Shows: total count, breakdown by agency name. Tap → opens the Mutual Aid Tracker app (Feature 92). Updates every 60 s. Shows "No mutual aid active" in a muted state when count is 0.

---

## Implementation Order

Features are implemented in dependency order. Each wave becomes one PR.

| Priority | Wave | Features | Rationale |
|---|---|---|---|
| 1 | Wave 5 (CAD widgets) | 31–38 | Highest operational value, self-contained widgets |
| 2 | Wave 1 (shell) | 1–8 | Visible shell improvements, officer daily use |
| 3 | Wave 2 (system apps) | 9–16 | Standalone floating apps, low coupling |
| 4 | Wave 3 (system controls) | 17–23 | Settings panel additions |
| 5 | Wave 4 (productivity) | 24–30 | Tooling, some IPC additions |
| 6 | Wave 6 (desktop) | 39–43 | Polish / preference features |
| 7 | Wave 7 (security) | 44–47 | Security features, IPC additions |
| 8 | Wave 8 (comms) | 48–50 | Integration, needs API routes |
| 9 | Wave 9 (window depth) | 51–56 | Window manager enhancements |
| 10 | Wave 10 (shell pt2) | 57–63 | Advanced shell features |
| 11 | Wave 11 (diagnostics) | 64–70 | System info + IPC handlers |
| 12 | Wave 12 (accessibility) | 71–76 | A11y — global CSS + context |
| 13 | Wave 13 (network) | 77–82 | IPC heavy, Windows-specific |
| 14 | Wave 14 (security) | 83–87 | Main process hardening |
| 15 | Wave 15 (CAD apps) | 88–95 | Full floating apps |
| 16 | Wave 16 (CAD widgets 2) | 96–100 | Final widget additions |

## File Map (new files to create)

```
client/src/components/desktop/
  apps/
    DesktopFileManager.tsx          (#9)
    DesktopTimer.tsx                (#10)
    DesktopUnitConverter.tsx        (#11)
    DesktopColorPicker.tsx          (#12)
    DesktopScreenMagnifier.tsx      (#13)
    DesktopPrintDialog.tsx          (#14)
    DesktopEventViewer.tsx          (#15)
    DesktopMediaPlayer.tsx          (#16)
    DesktopPerfMon.tsx              (#64)
    DesktopNetworkDiag.tsx          (#66)
    DesktopAlprHistory.tsx          (#88)
    DesktopWarrantSearch.tsx        (#89)
    DesktopIncidentTimeline.tsx     (#90)
    DesktopShiftBriefing.tsx        (#91)
    DesktopMutualAidTracker.tsx     (#92)
    DesktopEvidencePhotoViewer.tsx  (#93)
    DesktopUofReport.tsx            (#94)
    DesktopCitationGenerator.tsx    (#95)
  widgets/
    DesktopBoloTickerWidget.tsx     (#31)
    DesktopHotZonesWidget.tsx       (#32)
    DesktopDispatchQueueWidget.tsx  (#33)
    DesktopUnitProximityWidget.tsx  (#34)
    DesktopPlateLookupWidget.tsx    (#35)
    DesktopAddressLookupWidget.tsx  (#36)
    DesktopShiftPerfWidget.tsx      (#37)
    DesktopRadioLogWidget.tsx       (#38)
    DesktopVpnStatusWidget.tsx      (#77)
    DesktopActiveWarrantsWidget.tsx (#96)
    DesktopOfficerSafetyWidget.tsx  (#97)
    DesktopCallEscalationWidget.tsx (#98)
    DesktopEvidenceCoC_Widget.tsx   (#99)
    DesktopMutualAidWidget.tsx      (#100)
  DesktopWidgetLibrary.tsx          (#41)
  DesktopRecycleBin.tsx             (#63)
```
