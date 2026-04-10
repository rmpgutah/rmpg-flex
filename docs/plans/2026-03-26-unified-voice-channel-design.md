# Unified Voice Channel ("Dispatch Radio AI") — Design

**Date:** 2026-03-26
**Status:** Approved

## Overview

Enhance the existing voice alert system with two major capabilities:
1. **Rich tactical narratives** — Dispatch alerts include all available call data (suspect description, vehicle info, safety flags, zone/beat, assigned units) instead of terse type+location summaries
2. **Unified voice channel** — After alerts, the system enters a listen mode where officers can speak commands back (status updates, plate queries, backup requests, pursuit logs)

The system behaves like a real radio channel: alert speaks → listen window opens → officer responds → system acts and confirms.

## Architecture

### Enhanced Alert Narratives

A new `composeDispatchNarrative(call)` function builds spoken text from all non-null call fields, ordered by tactical priority:

1. Call number + type + priority
2. Full address with apartment/floor/building name
3. Zone/beat/section
4. Suspect/vehicle description (if present)
5. Safety flags: weapons, warrants, pursuit, DV, mental health, felony
6. Service requests: EMS, K9
7. Assigned units

Each field uses natural-language templates. The Edge-TTS radio bandpass filter applies for authentic dispatch sound. Empty fields are silently skipped.

### Voice Channel State Machine

```
IDLE → ALERTING → LISTENING → PROCESSING → RESPONDING → IDLE
                     ↓
                  TIMEOUT → IDLE
```

| State | Description | Duration |
|-------|------------|----------|
| IDLE | Monitoring WebSocket for events. Mic off. | Indefinite |
| ALERTING | System speaks full narrative via Edge-TTS. Mic off. | 5-15s |
| LISTENING | Roger beep → mic opens → visual indicator shows. | 3-10s (configurable) |
| PROCESSING | Audio transcribed via hybrid STT. | 0.5-2s |
| RESPONDING | System executes command and speaks confirmation. | 1-5s |
| TIMEOUT | No speech detected → mic closes → return to IDLE. | — |

**Alert preemption:** New major alert during LISTENING cancels listen window, starts ALERTING.

### Listen Mode Configuration (Per User)

| Mode | Behavior |
|------|----------|
| Auto-listen | Mic opens automatically after every alert |
| Wake word | Mic briefly listens for "Dispatch"/"Command", only activates on wake word |
| Manual only | Mic only opens when officer presses keybind (V key or button) |

Default: Manual only.

### Hybrid Speech-to-Text

```
Officer speaks
    ├─ Browser Web Speech API (parallel, real-time)
    │   └─ Pattern match against known commands
    │       ├─ Match → Execute immediately (< 500ms)
    │       └─ No match → Wait for server
    └─ Server Whisper transcription (parallel, ~1-2s)
        └─ Command parser
            ├─ Known command → Execute
            └─ Unknown → "Command not recognized"
```

Browser API handles fast simple commands. Server Whisper handles noisy/complex input. Server result takes priority if it arrives within 2-second window and disagrees with browser.

### Command Categories

| Category | Examples | Action |
|----------|----------|--------|
| Status | "en route", "on scene", "available" | Update unit status via API |
| Queries | "run plate ABC 1234", "what's my next call" | Query DB, speak result |
| Requests | "request backup", "request EMS", "request K9" | Broadcast via WebSocket |
| Dispatch | "start pursuit log", "mark evidence at my location" | Create records with GPS |
| Acknowledgment | "copy", "10-4", "roger" | Log acknowledgment, close window |

### Response Confirmations

- Status: "Copy, Unit 3 now showing en route"
- Query: "Plate ABC 1234 — registered to 2019 white Honda Civic — no wants or warrants"
- Request: "Backup request transmitted for Unit 3 at 450 South State"
- Error: "Command not recognized. Say again."

## User Settings

| Setting | Options | Default |
|---------|---------|---------|
| Voice Alert Detail | Minimal / Standard / Full Tactical | Full Tactical |
| Listen Mode | Auto-listen / Wake word / Manual only | Manual only |
| Listen Window Duration | 3s / 5s / 8s / 10s | 5s |
| Command Confirmation | Speak / Silent / Beep only | Speak |
| Voice Engine | Edge-TTS / Browser | Edge-TTS |
| Wake Word | "Dispatch" / "Command" / Custom | "Dispatch" |

Settings in `localStorage` + `user_preferences` table for cross-device sync.

## Files

### New
- `client/src/utils/voiceChannel.ts` — State machine
- `client/src/utils/commandParser.ts` — Client-side command matching
- `client/src/utils/narrativeComposer.ts` — Enhanced narrative builder
- `client/src/hooks/useVoiceChannel.ts` — React hook
- `client/src/components/VoiceChannelIndicator.tsx` — Visual indicator
- `server/src/routes/voice.ts` — Transcription + command execution API

### Modified
- `client/src/hooks/useDispatchVoiceAlerts.ts` — Use narrative composer, integrate voice channel
- `client/src/utils/voiceAlerts.ts` — Add `composeDispatchNarrative()`
- `client/src/utils/edgeTTS.ts` — Longer narrative support, response cycle queuing
- `client/src/components/Layout.tsx` — Mount voice channel
- `server/src/utils/aiProvider.ts` — Add Whisper transcription
- `server/src/index.ts` — Register `/api/voice` route

## Security

- Mic permissions: Browser prompts on first use, graceful degradation if denied
- All commands authenticated via existing JWT — no bypass
- Destructive commands require spoken "Confirm" (clear call, cancel dispatch)
- All voice commands audit-logged with transcript and result
- Rate limit: 10 commands/minute/user (prevent mic-stuck floods)
