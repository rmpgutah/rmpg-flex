# Radio Console & Panic Alarm Enhancement — Design Document

**Date:** 2026-04-12
**Status:** Approved
**Approach:** Hybrid — build on existing infrastructure, extract panic to dedicated route, new radio console as left sidebar

---

## Overview

Comprehensive enhancement of the RMPG Flex radio system and panic alarm system. Covers:

1. **Radio Console** — Full left-sidebar radio panel with multi-channel monitor, scanner, encryption, S-meter, unit paging, radio check, emergency talkgroup override, PTT, transmission log
2. **Command Execution Engine** — Wire NLU-parsed voice commands to real dispatch API calls
3. **Audio Quality Upgrades** — AGC, noise gate, dynamic presence, bitcrusher codec simulation
4. **Panic Alarm Overhaul** — Dedicated `panic_alerts` table, server-side acknowledgment, configurable audio recording (default 60s), tiered escalation (30/60/90s), cancel/false-alarm, mobile hardware

---

## 1. Radio Console — Left Sidebar Panel

### Layout Integration

- **Collapsed**: 48px wide vertical strip — "RADIO" text rotated, TX/RX LED, mute icon
- **Expanded**: 320px wide panel, pushes page content right
- **Toggle**: Click collapsed strip, or press **R** hotkey
- **Persistent**: Open/closed state in localStorage (`rmpg-radio-panel-open`)
- **Z-index**: Below modals/panic overlays, above page content

### Panel Sections (top to bottom)

#### 1.1 Header
- Gold embossed text: "RMPG RADIO CONSOLE"
- Dark chrome gradient `#1a1a1a → #242424`
- Beveled groove separator below

#### 1.2 Encryption Indicator
- P25 encryption status with green LED (secure) / amber LED (clear)
- Key ID display (hex): `Key: 0x4A`
- Toggle buttons: `[SECURE]` `[CLEAR]` `[SCRAMBLE]`
- Active button highlighted in gold `#d4a017`

#### 1.3 Multi-Channel Monitor (up to 3 channels)

Active channel: full card with gold border, activity bar, who's talking, unit count
Monitored channels: compact cards — channel name + IDLE/ACTIVE status

**LCD Display Styling:**
- Background: `#050505` (sunken), monospace 12px
- Active text: `#33ff33` phosphor green with `text-shadow: 0 0 4px rgba(51,255,51,0.3)`
- Inactive text: `#1a5a1a` dim green
- 2px inset border (recessed LCD bezel)

Channel types: Dispatch Main, Tactical, Admin/Supervisors, Unit-to-Unit, Emergency
Configurable via admin settings in `system_config`.

#### 1.4 Channel Scanner
- `[SCAN]` button: cycles channels every 3s, pauses on active transmission, resumes after 5s silence
- `[MON]` button: monitor current channel (muted mic, listen only)
- `[DIR]` button: direct unit call mode
- `[+ADD CH]`: add channel to monitor list
- Scanner icon rotates during active scan (CSS animation)

#### 1.5 Signal Strength Meter (S-Meter)
- 12 bars: 1-6 green `#22c55e`, 7-9 amber `#d4a017`, 10-12 red `#dc2626`
- Each bar: 3px wide, 12px tall, 1px gap, active bars have glow
- dBm readout mapped from WebSocket ping latency
- Latency (ms), throughput (kB/s up/down), packet loss (%)
- Updates every 2 seconds

#### 1.6 Unit Selector / Paging
- Dropdown: `ALL UNITS (broadcast)` default
- Unit chip grid: green dot = online, red = offline, gray hollow = out of service
- `[PAGE GROUP]`: page a unit group (Zone 1, K9, Supervisors, etc.)
- `[RADIO CHECK]`: ping specific unit, get ACK with latency/battery/GPS

**Radio Check Flow:**
1. Select unit → click RADIO CHECK
2. WebSocket `radio_check` message → target unit
3. Auto-response `radio_check_ack` with: unit ID, timestamp, WS latency, battery %, GPS accuracy
4. Display in transmission log: `RADIO CHECK 4-2: ACK 22ms, BAT 78%, GPS ±5m`
5. 10s timeout → `RADIO CHECK 4-2: NO RESPONSE` (red)

#### 1.7 PTT Button
- Large center button with 3D beveled border
- **Idle**: `#2a2a2a` face, outset border, 6px center LED (gray)
- **TX (pressed)**: `#991b1b` red face, gold LED glow, inset shadow, `box-shadow: 0 0 8px rgba(220,38,38,0.5)`
- **RX (receiving)**: `#166534` green face, green LED, pulsing glow
- CSS transition: 50ms (snappy)
- Vertical volume slider beside PTT
- `[MUTE]` `[MON]` `[V key]` buttons below

#### 1.8 Emergency Talkgroup Override
- RED button with diagonal warning stripes (CSS repeating gradient)
- Recessed: 2px inset shadow
- **Activation**: Click + hold 2 seconds (prevents accidental trigger)
- **Effects**:
  1. All units forcibly switched to emergency channel (WebSocket broadcast)
  2. All other channels muted
  3. Panic warble tone on all clients
  4. Red banner: "EMERGENCY TALKGROUP ACTIVE" across all clients
  5. All transmissions auto-recorded
  6. Activity log entry
- **Deactivation**: Supervisor+ click "END EMERGENCY" (confirmation required)
- **Auto-deactivation**: 30 minutes with no activity

#### 1.9 Transmission Log
- Rolling log, 100 entries max, scrollable, newest on top
- Format: `HH:MM:SS  [UNIT]  "transcription text"`
- Color: dispatch=gold `#d4a017`, units=white, emergency=red `#dc2626`, system=amber
- System events (radio checks, channel changes) with lightning icon
- Filterable by unit or channel

#### 1.10 Quick Commands
- 7 configurable one-tap buttons: `[10-4]` `[10-8]` `[BACKUP]` `[EMS]` `[SITREP]` `[CODE 4]` `[10-7]`
- Each sends the voice command text through the command execution pipeline
- Configurable labels/commands via admin settings

### Keybinds
- **R** — Toggle radio panel open/close
- **V** (hold) — PTT (hold to talk, release to stop)
- **Shift+V** — Cycle listen mode (auto → wake → manual)
- **Ctrl+Shift+E** — Emergency talkgroup override (2s hold still required)

### Components
- `client/src/components/radio/RadioConsole.tsx` — main panel container
- `client/src/components/radio/ChannelCard.tsx` — individual channel display
- `client/src/components/radio/SignalMeter.tsx` — S-meter + network stats
- `client/src/components/radio/UnitSelector.tsx` — unit chips + paging
- `client/src/components/radio/PTTButton.tsx` — push-to-talk with LED
- `client/src/components/radio/TransmissionLog.tsx` — scrollable log
- `client/src/components/radio/EncryptionIndicator.tsx` — P25 status
- `client/src/components/radio/EmergencyOverride.tsx` — emergency button
- `client/src/components/radio/RadioChannelScanner.tsx` — scanner logic
- `client/src/components/StatusBarRadio.tsx` — compact status bar indicator

### Hooks
- `client/src/hooks/useRadioConsole.ts` — panel state, channel management, scanner
- `client/src/hooks/useRadioCheck.ts` — radio check ping/ack logic
- `client/src/hooks/useSignalStrength.ts` — WebSocket latency/throughput measurement

---

## 2. Command Execution Engine

### Command → API Action Mapping

| Parsed Action | API Call | Broadcast | Spoken Confirmation |
|---|---|---|---|
| `status_update` | `PUT /dispatch/units/:id/status` | `unit_status` WS | "Copy, [unit] now showing [status]" |
| `acknowledge` | `POST /dispatch/calls/:id/acknowledge` | `call_updated` WS | "10-4, acknowledged" |
| `request_backup` | `POST /dispatch/calls/:id/backup` | `backup_request` WS + voice alert | "Backup request transmitted" |
| `request_ems` | `POST /dispatch/calls/:id/ems` | `ems_request` WS | "EMS request transmitted" |
| `request_k9` | `POST /dispatch/calls/:id/k9` | `k9_request` WS | "K9 request transmitted" |
| `run_plate` | `GET /records/compound-search?plate=X` | — | Spoken results (hits/no hits) |
| `run_name` | `GET /records/universal-search?q=X` | — | Spoken results summary |
| `next_call` | `GET /dispatch/calls?status=pending&limit=1` | — | Spoken call details |
| `start_pursuit` | `POST /dispatch/calls/:id/pursuit` | `pursuit_started` WS | "Pursuit initiated, all units notified" |
| `officer_down` | `POST /dispatch/panic` | Full panic broadcast | Panic alarm sequence |
| `sitrep` | `GET /dispatch/calls/:id` | — | Spoken situation report |
| `code_4` | `PUT /dispatch/calls/:id` (clear) | `call_updated` WS | "Code 4, scene clear" |
| `create_call` | `POST /dispatch/calls` | `call_created` WS | "New call created, [number]" |

### Execution Pipeline

```
Transcription → NLU Parse → Confidence Check
  ├─ > 0.7: Execute API → Speak Confirmation
  ├─ 0.5-0.7: "Did you say [action]? Confirm." → Wait for "10-4"/"affirm"
  └─ < 0.5: "Please repeat, I didn't copy that"
```

### New File
- `client/src/utils/voiceCommandExecutor.ts` — maps NLU output to API calls, handles confirmation flow

### Server Endpoints (new)
- `POST /dispatch/calls/:id/backup` — broadcast backup request, create notification
- `POST /dispatch/calls/:id/ems` — broadcast EMS request
- `POST /dispatch/calls/:id/k9` — broadcast K9 request
- `POST /dispatch/calls/:id/acknowledge` — log call acknowledgment
- `POST /dispatch/calls/:id/pursuit` — initiate pursuit mode

---

## 3. Audio Quality Upgrades

### New Audio Processing Nodes

| Enhancement | Web Audio Node | Parameters |
|---|---|---|
| **AGC** | `DynamicsCompressorNode` | threshold: -24dB, knee: 30dB, ratio: 12:1, attack: 0.003s, release: 0.25s |
| **Noise Gate** | `AudioWorkletNode` (custom) | threshold: -40dB, attack: 10ms, release: 100ms |
| **Dynamic Presence** | `BiquadFilterNode` (peaking) | frequency: 1200-1800Hz (voice-adaptive), gain: +3dB, Q: 1.0 |
| **Bitcrusher** | `AudioWorkletNode` (custom) | bit depth: 12, sample rate reduction: 0.8x |
| **Dynamic Static** | Pink noise generator | level: 0.010-0.025 mapped to WebSocket latency (higher latency = more static) |

### Updated Audio Chain

```
Source → Noise Gate → AGC → Bandpass (300-3400Hz) → Dynamic Presence → Bitcrusher → Voice Gain → Output
                                                                                         ↓
                                                                              Pink Noise (dynamic level)
```

### New Files
- `client/src/utils/audio/noiseGateProcessor.ts` — AudioWorklet for noise gate
- `client/src/utils/audio/bitcrusherProcessor.ts` — AudioWorklet for codec sim
- Updates to `client/src/utils/edgeTTS.ts` — insert new nodes into existing chain

---

## 4. Panic Alarm Overhaul

### 4.1 New Database Table

```sql
CREATE TABLE IF NOT EXISTS panic_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  call_id INTEGER,
  trigger_method TEXT NOT NULL DEFAULT 'ui_button',
  message TEXT,
  latitude REAL,
  longitude REAL,
  location_address TEXT,
  audio_file_id TEXT,
  audio_duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  escalation_level INTEGER DEFAULT 0,
  acknowledged_at TEXT,
  acknowledged_by INTEGER,
  resolved_at TEXT,
  resolved_by INTEGER,
  resolution_notes TEXT,
  responder_unit_ids TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (acknowledged_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
```

**Status enum:** `active`, `acknowledged`, `resolved`, `false_alarm`, `cancelled`
**Trigger methods:** `ui_button`, `hardware_button`, `voice_command`, `sos_button`
**Escalation levels:** 0 (initial), 1 (re-broadcast), 2 (auto-dispatch), 3 (external notify)

### 4.2 New Route: `server/src/routes/dispatch/panic.ts`

Extracted from aggregates.ts (lines 645-828).

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/dispatch/panic` | POST | Trigger panic alert | Any authenticated |
| `/dispatch/panic/active` | GET | List active panics | dispatcher+ |
| `/dispatch/panic/history` | GET | Historical log with filters | supervisor+ |
| `/dispatch/panic/:id/acknowledge` | POST | Server-side acknowledgment | Any authenticated |
| `/dispatch/panic/:id/resolve` | POST | Mark resolved (with notes) | supervisor+ |
| `/dispatch/panic/:id/false-alarm` | POST | Mark false alarm (with notes) | supervisor+ |
| `/dispatch/panic/:id/cancel` | POST | Officer cancels own panic | Triggering officer only, within 30s |
| `/dispatch/panic/:id/audio` | POST | Upload audio chunk | System (from client stream) |
| `/dispatch/panic/:id/audio` | GET | Stream/download recorded audio | supervisor+ |

### 4.3 Server-Side Audio Recording

- Client streams audio chunks (500ms WebM/Opus) via WebSocket `panic_audio` messages
- Server writes chunks to temp file: `server/uploads/panic/{panic_id}_raw.webm`
- On recording end: move to permanent storage, create `attachments` record
- Link via `audio_file_id` in `panic_alerts`
- **Duration**: Configurable via `system_config` key `panic_audio_duration_seconds` (default: 60, max: 300)
- Audio files are immutable — no delete endpoint, audit-logged

### 4.4 Escalation Engine

Server-side timer starts on panic trigger:

| Time | Escalation Level | Action |
|---|---|---|
| 0s | 0 | Initial broadcast to all WebSocket clients |
| 30s | 1 | Re-broadcast `panic_alert`, create "critical" notification for all users |
| 60s | 2 | Auto-dispatch 3 nearest available units to panic location |
| 90s | 3 | Send email to all supervisor+ roles via `emailSender.ts` |

- Timer lives server-side (in-memory `setTimeout`, cleaned up on ack/resolve/cancel)
- Each escalation level logged in `panic_alerts.escalation_level` + `activity_log`
- Escalation intervals configurable via `system_config` keys:
  - `panic_escalation_1_seconds` (default: 30)
  - `panic_escalation_2_seconds` (default: 60)
  - `panic_escalation_3_seconds` (default: 90)

### 4.5 Acknowledgment Flow

```
Client receives panic_alert
  → User clicks "ACKNOWLEDGE"
  → POST /dispatch/panic/:id/acknowledge
  → Server:
    1. Set acknowledged_at = now, acknowledged_by = user_id
    2. Update status = 'acknowledged'
    3. Cancel escalation timer
    4. Activity log entry
    5. Broadcast panic_acknowledged to all clients
  → All clients:
    1. Update alert UI: "Acknowledged by [Name] at [Time]"
    2. Stop alarm playback
    3. Keep alert visible (don't auto-dismiss)
```

### 4.6 Cancel / False Alarm

**Cancel** (officer self-cancel):
- Only the triggering officer can cancel
- Must be within 30 seconds of trigger
- Stops escalation, broadcasts `panic_cancelled`
- Status → `cancelled`

**False Alarm** (supervisor action):
- Any supervisor+ can mark false alarm
- Requires resolution notes (min 10 chars)
- Stops escalation, broadcasts `panic_false_alarm`
- Status → `false_alarm`

### 4.7 Mobile / Hardware Enhancements

- **Haptic feedback**: `navigator.vibrate([200, 100, 200, 100, 200])` on panic trigger
- **SOS button**: Capacitor keyCode listener for Sonim XP10 SOS (keyCode 287/288)
- **Hardware triggers skip 5s confirmation** — immediate send
- **Android Volume Button**: Existing 4x rapid press / 3s hold — unchanged

### 4.8 WebSocket Messages (new)

| Message Type | Direction | Purpose |
|---|---|---|
| `panic_acknowledged` | Server → All | Panic acknowledged by a user |
| `panic_resolved` | Server → All | Panic resolved |
| `panic_cancelled` | Server → All | Panic cancelled by triggering officer |
| `panic_false_alarm` | Server → All | Panic marked as false alarm |
| `panic_escalated` | Server → All | Panic escalated to next level |
| `emergency_talkgroup_active` | Server → All | Emergency talkgroup override activated |
| `emergency_talkgroup_ended` | Server → All | Emergency talkgroup override ended |
| `radio_check` | Client → Target | Radio check ping |
| `radio_check_ack` | Target → Sender | Radio check acknowledgment |

---

## 5. Admin Configuration

New `system_config` keys:

| Key | Default | Purpose |
|---|---|---|
| `panic_audio_duration_seconds` | 60 | Max audio recording duration |
| `panic_escalation_1_seconds` | 30 | Time to re-broadcast |
| `panic_escalation_2_seconds` | 60 | Time to auto-dispatch |
| `panic_escalation_3_seconds` | 90 | Time to email supervisors |
| `radio_channels` | JSON array | Configured radio channels |
| `radio_quick_commands` | JSON array | Quick command button config |
| `radio_encryption_default` | "secure" | Default encryption mode |
| `emergency_talkgroup_timeout_minutes` | 30 | Auto-deactivation timeout |

---

## File Structure (New/Modified)

### New Files
```
client/src/components/radio/
├── RadioConsole.tsx
├── ChannelCard.tsx
├── SignalMeter.tsx
├── UnitSelector.tsx
├── PTTButton.tsx
├── TransmissionLog.tsx
├── EncryptionIndicator.tsx
├── EmergencyOverride.tsx
└── RadioChannelScanner.tsx

client/src/components/StatusBarRadio.tsx
client/src/hooks/useRadioConsole.ts
client/src/hooks/useRadioCheck.ts
client/src/hooks/useSignalStrength.ts
client/src/utils/voiceCommandExecutor.ts
client/src/utils/audio/noiseGateProcessor.ts
client/src/utils/audio/bitcrusherProcessor.ts

server/src/routes/dispatch/panic.ts
```

### Modified Files
```
client/src/components/Layout.tsx          — Add RadioConsole sidebar
client/src/components/StatusBar.tsx        — Add StatusBarRadio indicator
client/src/components/PanicButton.tsx      — Wire server-side ack, new WS messages
client/src/hooks/usePanicAudio.ts          — Extended recording, server upload
client/src/utils/edgeTTS.ts                — Insert AGC, noise gate, bitcrusher
client/src/utils/voiceChannel.ts           — Wire to RadioConsole UI
client/src/pages/dispatch/DispatchPage.tsx — Radio panel integration
server/src/models/database.ts              — panic_alerts table + new config keys
server/src/routes/dispatch/aggregates.ts   — Extract panic to panic.ts
server/src/routes/dispatch/index.ts        — Mount panic.ts router
server/src/utils/websocket.ts              — New message types (radio_check, panic_ack, etc.)
server/src/routes/notifications.ts         — Panic escalation notifications
```
