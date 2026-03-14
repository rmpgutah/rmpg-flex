# Enhanced Radio, Panic Alert & Android App Redesign

**Date:** 2026-03-14
**Status:** Approved
**Goal:** Beat Spillman Flex's radio system with hardware PTT, MDC selcall, dispatch-linked radio, and a complete Android-first UI overhaul for Sonim XP10 field use.

## Business Context

RMPG officers use Sonim XP10 phones in the field and laptops in patrol vehicles. The current radio and app UI was designed desktop-first. Officers need:
- Hardware PTT button support (Sonim yellow side button)
- Hardware SOS panic button (Sonim red SOS button)
- Spillman-style MDC features (selcall paging, silent monitor, cross-patch, emergency override)
- Radio transmissions linked to dispatch calls for audit trails
- A mobile-first app layout built for one-handed gloved use on a 5.7" screen
- Battery indicator in the status bar

## Feature 1: Hardware PTT & Panic Buttons

### Android (Sonim XP10 — Capacitor)

| Button | Keycode | Action |
|--------|---------|--------|
| Yellow PTT (side) | `KEYCODE_PTT` (279) | Radio push-to-talk (hold=TX, release=stop) |
| Red SOS (top) | Sonim SOS keycode (detect on first run) | Instant panic alert, no confirmation |
| Volume Up 4× rapid | N/A (existing) | Secondary panic trigger |

**Implementation:** Native Capacitor plugin (`HardwareKeyPlugin.java`) registers a `KeyEvent` listener at the Android activity level. JavaScript `keydown`/`keyup` don't reliably capture hardware keycodes — the native bridge dispatches custom events to the WebView.

- PTT key-down → `startTransmit()`, key-up → `stopTransmit()` (existing 500ms hang-time)
- SOS press → skip confirmation dialog → `POST /dispatch/panic` with `trigger_method: 'hardware_sos'` → start 15-second mic broadcast
- Haptic pulse on PTT press (Sonim has strong vibration motor)
- Fallback keycodes: `KEYCODE_HEADSETHOOK` (79), `KEYCODE_MEDIA_PLAY_PAUSE` (85) for Bluetooth accessories

### Laptop (Browser / Electron)

| Input | Action |
|-------|--------|
| Spacebar (existing) | PTT hold-to-talk |
| F5 key | Dedicated PTT key |
| Configurable USB pedal | User presses pedal in settings → keycode captured and stored |

**PTT Key Binding:** User preferences panel with "Press your PTT button now" capture. Stored in `system_config` with `category='user_ptt_binding'`.

## Feature 2: MDC Selcall System

### A) Unit Paging (Selcall)

- Dispatch clicks unit call sign in dispatch board → "Page Unit" button
- Server sends targeted `selcall_page` WebSocket message to that unit's client(s) by userId
- Receiving device: plays MDC-1200 style two-tone burst + shows banner "DISPATCH IS PAGING YOU"
- If officer is on a different channel, page arrives regardless (routed by userId, not channel)
- Auto-switch to DISPATCH channel after 5 seconds if no manual switch
- Logged to `radio_transcripts` with `transmission_type = 'selcall_page'`

### B) Supervisor Silent Monitor

- Supervisors/admins can join any channel in **monitor mode**
- Server adds them to audio relay list but excludes from `radio_channel_state` user list
- No join/leave notification broadcast for monitor-mode users
- PTT disabled in monitor mode — shows "MONITOR ONLY" label
- Monitor icon in Radio page: pick channel to silently monitor (can monitor one channel while actively on another)

### C) Cross-Patch

- Dispatch bridges two channels (e.g., TAC-1 ↔ DISPATCH)
- Server duplicates audio packets from channel A → B and B → A
- Visual banner on both channels: "CROSS-PATCHED WITH [channel]"
- Only admin/dispatch roles can create/destroy patches
- Maximum 1 active cross-patch at a time (avoids audio loops)
- Ephemeral server-side state (in-memory Map, no DB)

### D) Emergency Channel Override

- When panic fires, server force-broadcasts panic audio to ALL authenticated clients regardless of channel
- After 15-second panic broadcast, server sends `emergency_channel_override`
- All units auto-switch to DISPATCH channel
- Officers can manually switch back after acknowledging

## Feature 3: Dispatch-Linked Radio

### Auto-Tagging

- On each transmission, server checks: does this officer's unit have an active assigned call?
- Priority: `on_scene` > `enroute` > `dispatched`
- If match found: `radio_transcripts.linked_call_id = call.id`

### Call Detail Radio Tab

- New "Radio" tab in call detail panel alongside Notes, Units, History
- Chronological list: timestamp, officer name, duration, transcript, playback button
- Dispatchers see exactly what was said during a call

### Audit Trail

- Call PDF report gets "Radio Traffic Summary" section
- Lists each transmission: time, officer, duration, transcript snippet (first 80 chars)
- Total radio time per officer on the call
- Critical for use-of-force reviews, incident reconstruction, training

### Manual Link Override

- "Link to Call" dropdown on transmission log entries
- Dispatch can reassign a TX to a different call if auto-tag was wrong

## Feature 4: Battery Indicator

- Browser Battery API (`navigator.getBattery()`) on Chrome/Android WebView
- Electron `powerMonitor` API for laptops
- Displays in status bar at bottom-right, next to clock/date
- Format: icon + percentage (e.g., `🔋 87%` or `⚡ 43%` when charging)

| Range | Color | Behavior |
|-------|-------|----------|
| 100–50% | Green | Normal |
| 49–20% | Amber | Warning |
| 19–0% | Red | Blink animation |
| Below 15% | Red | `batteryLow` tone from radioTones.ts (once) |

- Updates via Battery API change events (no polling)
- Graceful hide if Battery API unavailable (Firefox/Safari)

## Feature 5: Android App Full Layout Overhaul

### New Mobile Shell

```
┌─────────────────────────────┐
│ RMPG FLEX    ● On Duty  🔋 │  Compact header (40px)
│ Unit 4-2 | DISPATCH  CH1   │  Context bar (32px)
├─────────────────────────────┤
│                             │
│       PAGE CONTENT          │  Full-height scrollable
│                             │
├─────────────────────────────┤
│ 🗺  📋  📻  🔔  ≡         │  Bottom nav (56px)
│ Map Calls Radio Alert More  │
└─────────────────────────────┘
```

### Key Changes

| Current | New |
|---------|-----|
| 48px header + hamburger drawer | 40px header + 32px context bar + 56px bottom nav |
| All pages via drawer | 4 primary on bottom nav, rest in "More" |
| Desktop-sized buttons | Min 48dp touch targets, 16px+ body text |
| No persistent context | Context bar: unit, channel, active call # |
| F-key nav (useless on mobile) | Swipe gestures, pull-down refresh |
| Tiny call cards | Full-width cards, large incident type + address |
| Small map with overlapping controls | Full-bleed map, floating action buttons |

### Bottom Nav Pages (4 primary)

1. **Map** — GPS position, active calls, other units. Full-bleed map, floating buttons (center on me, toggle layers). Tap call pin → bottom sheet with summary + "En Route" button. Tap unit pin → bottom sheet + "Page" button.

2. **Calls** — Dispatch board, active calls, status changes. HUGE status buttons: En Route (green), On Scene (amber), Clear (blue). Active call at top with large address. Swipe card left → quick actions. Swipe right → full detail panel.

3. **Radio** — The mobile radio layout from Feature 1. Portrait-first, 120dp PTT button, large active speaker name, compact TX log, swipeable channel picker.

4. **Alerts** — Panic alerts, warrant hits, BOLOs, notifications. Cards with severity-colored left border. Tap to expand. Acknowledge button.

### "More" Drawer

Accessed via hamburger (≡) on bottom nav. Contains: Incidents, Reports, Warrants, Persons, Vehicles, Citations, Field Interviews, Training, Settings, Profile.

### Page-Specific Mobile Optimizations

**Incidents/Reports:**
- Single-column stacked form fields
- Camera button for photo attachments from Sonim camera
- Voice-to-text mic icon for narrative dictation
- Sticky save button at bottom, always visible

**Settings (mobile):**
- PTT button test: "Press your PTT button now" → captures keycode
- Radio channel preferences
- Notification sound selection
- GPS accuracy mode toggle

### Mobile Radio Layout (portrait)

```
┌─────────────────────────────┐
│ ● DISPATCH  155.010 MHz     │  Channel + freq, tap to switch
│ ▸ CROSS-PATCHED: TAC-1      │  Status banner (when active)
├─────────────────────────────┤
│    ╔═══════════════════╗    │
│    ║   SGT. MARTINEZ   ║    │  Active speaker (largest text)
│    ║   ▓▓▓▓▓▓▓▓░░░░░  ║    │  Waveform bars
│    ║   TRANSMITTING    ║    │
│    ╚═══════════════════╝    │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │ 4-2 │ │ 4-5 │ │ 4-7 │  │  Channel users (large targets)
│  │  ●  │ │  ●  │ │  ○  │  │  Tap to selcall/page
│  └─────┘ └─────┘ └─────┘  │
├─────────────────────────────┤
│ 14:32 Martinez: 10-4        │  Last 3 TX (scrollable)
│ 14:31 Dispatch: Unit 4-2... │
│ 14:30 Reyes: En route       │
├─────────────────────────────┤
│     ╔═══════════════╗      │
│     ║   PTT (TALK)  ║      │  120dp min, green/red/gold
│     ╚═══════════════╝      │
│  [Page] [Channels] [Log]   │  Bottom action bar
└─────────────────────────────┘
```

Landscape mode (vehicle cradle): wider layout with TX log on right side.

## Schema Changes

### Modified Tables

```sql
-- radio_transcripts: add call linking + transmission type
ALTER TABLE radio_transcripts ADD COLUMN linked_call_id INTEGER REFERENCES calls_for_service(id);
ALTER TABLE radio_transcripts ADD COLUMN transmission_type TEXT DEFAULT 'normal';
-- transmission_type: 'normal', 'selcall_page', 'emergency', 'cross_patch'
```

### Server In-Memory State (no DB)

```typescript
// Cross-patch state
const crossPatches: Map<string, { channelA: string; channelB: string; createdBy: number }>;

// Silent monitors
const silentMonitors: Map<string, Set<string>>; // channel → Set<clientId>
```

## Files to Create

| File | Purpose |
|------|---------|
| `android/app/src/main/java/.../HardwareKeyPlugin.java` | Capacitor native plugin for PTT/SOS keycodes |
| `client/src/components/BatteryIndicator.tsx` | Status bar battery widget |
| `client/src/components/radio/MobileRadioLayout.tsx` | Android-optimized radio UI |
| `client/src/components/radio/SelcallPageModal.tsx` | Dispatch paging UI |
| `client/src/components/radio/CrossPatchControls.tsx` | Cross-patch create/destroy UI |
| `client/src/components/radio/SilentMonitorPanel.tsx` | Supervisor monitor channel picker |
| `client/src/components/dispatch/CallRadioTab.tsx` | Radio traffic timeline for call detail |
| `client/src/components/mobile/MobileShell.tsx` | New mobile app shell with bottom nav + context bar |
| `client/src/components/mobile/MobileCallsPage.tsx` | Mobile-optimized dispatch/calls view |
| `client/src/components/mobile/MobileMapPage.tsx` | Full-bleed mobile map |
| `client/src/components/mobile/MobileAlertsPage.tsx` | Mobile alerts/notifications view |

## Files to Modify

| File | Changes |
|------|---------|
| `server/src/utils/websocket.ts` | Selcall routing, silent monitor, cross-patch relay, emergency override |
| `server/src/models/database.ts` | `linked_call_id` + `transmission_type` columns on radio_transcripts |
| `client/src/hooks/useRadio.ts` | Hardware PTT events, selcall handling, cross-patch state, monitor mode |
| `client/src/hooks/usePanicAudio.ts` | Hardware SOS button integration |
| `client/src/pages/RadioPage.tsx` | Responsive layout, monitor mode UI, mobile detection |
| `client/src/pages/dispatch/DispatchPage.tsx` | "Page Unit" button, Radio tab on call detail |
| `client/src/components/Layout.tsx` | Battery indicator, mobile shell detection/routing |
| `client/src/utils/recordPdfGenerator.ts` | Radio traffic summary section in call PDFs |
| `client/src/utils/radioTones.ts` | Selcall two-tone burst, battery low tone |
| `client/src/components/PanicButton.tsx` | Hardware SOS keycode integration |

## Implementation Priority

| Phase | Features | Est. Effort |
|-------|----------|-------------|
| 1 | Battery indicator + mobile shell layout | Small |
| 2 | Hardware PTT/SOS (Capacitor plugin) | Medium |
| 3 | Selcall paging + emergency override | Medium |
| 4 | Silent monitor + cross-patch | Medium |
| 5 | Dispatch-linked radio + call radio tab | Medium |
| 6 | Radio traffic in call PDF | Small |
| 7 | Full mobile page optimizations (Map, Calls, Alerts) | Large |
| 8 | Mobile Radio page portrait layout | Medium |
