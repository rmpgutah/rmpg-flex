# Voice + AI Dispatch System Design

**Date**: 2026-03-25
**Status**: Approved

## Problem Statement

RMPG Flex has a comprehensive audio system (dispatch tones, radio tones, SpeechSynthesis voice alerts, panic audio, PTT radio), but three gaps remain:

1. **Voice quality** — Browser SpeechSynthesis sounds robotic and varies by OS/browser
2. **Alert coverage** — Not all events trigger appropriate audio; no severity tier system
3. **No AI integration** — No intelligent call analysis, narrative assistance, or dispatch suggestions

## Solution Overview

Three interconnected systems:

- **Edge-TTS Neural Voice** — Server-side Microsoft neural TTS replacing browser SpeechSynthesis
- **Three-Tier Alert Severity** — Minor/Moderate/Major classification with distinct audio profiles
- **Groq AI Integration** — Call analysis, narrative generation, unit suggestions via free Llama 3.1 70B

## 1. Three-Tier Alert Severity System

### Tier Definitions

| Tier | Tone Profile | Voice Behavior | Visual | Triggers |
|------|-------------|----------------|--------|----------|
| **Minor** | Single soft pip (info tone, 1000Hz 50ms) | Brief 1-line voice clip | Blue flash banner, auto-dismiss 5s | Status updates, routine check-ins, unit cleared, call closed |
| **Moderate** | Motorola Quick Call II (caution tone, 660ms) | Full dispatch read with call details | Amber pulse banner, persistent until acknowledged | BOLOs, warrants, backup requests, DV flags, pursuit starts, new priority calls |
| **Major** | Emergency warble (alarm tone) x3 repeats | Attention tone prefix + urgent full read | Red full-screen overlay with strobe effect | Panic, officer down, active shooter, shots fired, felony in progress, officer needs assistance |

### Classification Logic

New file: `client/src/utils/alertSeverity.ts`

Classifies events based on:
- **Call flags**: `weapons_involved` + `felony_in_progress` = Major; `domestic_violence` alone = Moderate
- **Event type**: `panic_alert` always Major; `bolo_alert` always Moderate; `call_closed` always Minor
- **Priority**: P1 calls escalate to at least Moderate; panic events always Major
- **AI override**: Groq analysis can escalate severity based on narrative content

### Audio Pipeline Per Tier

```
Event → classifySeverity() → {
  Minor:    playTone('info')    → edgeTTS(shortPhrase)
  Moderate: playTone('caution') → edgeTTS(fullDispatchRead)
  Major:    playTone('alarm')x3 → edgeTTS('EMERGENCY' + fullRead, urgent=true)
}
```

## 2. Edge-TTS Neural Voice

### Why Edge-TTS

- **Free** — No API key, no account, no rate limits
- **Neural quality** — Microsoft's neural TTS engine (same as Azure Cognitive Services)
- **Consistent** — Server-side generation means identical voice across all browsers/devices
- **Fast** — ~200-500ms generation for typical dispatch phrases

### Architecture

**Server endpoint**: `POST /api/tts`

```
Request:  { text: string, urgent?: boolean }
Response: audio/mpeg binary (MP3)
```

**Voice selection**: `en-US-JennyNeural` (calm, professional female dispatcher)
- Normal mode: rate +5%, pitch default
- Urgent mode: rate +15%, pitch +5Hz, volume +10%

**Server implementation** (`server/src/routes/tts.ts`):
- Uses `edge-tts` npm package (MIT license, wraps Microsoft Edge's free TTS)
- LRU cache (100 entries) for common phrases to reduce latency
- Streaming response for long announcements
- Rate limiting: 60 req/min per user

**Client integration** (`client/src/utils/edgeTTS.ts`):
- Fetches audio from `/api/tts`, decodes via AudioContext
- Applies radio bandpass filter (Q=2.5 @ 1350Hz) for authentic radio sound
- Queue system: alerts play in order, Major interrupts Minor/Moderate
- Fallback: If server TTS fails, falls back to existing browser SpeechSynthesis

### Dispatch Phrasing

Enhance existing voiceAlerts.ts phrase mappings with more authentic 10-code/plain-language dispatch style:
- Phonetic alphabet for plates/descriptions (Alpha, Bravo, Charlie...)
- Standard dispatch cadence: "[Attention tone] All units, [event type], [location], [details], [safety info]"
- Time announcements in 24-hour format
- Cross-street references when available

## 3. Groq AI Integration

### Infrastructure

**Server module**: `server/src/utils/groqAI.ts`

- Groq API (free tier): 30 requests/minute, Llama 3.1 70B
- API key stored in `server/.env` as `GROQ_API_KEY`
- Graceful degradation: All AI features are optional enhancements; system works fully without them
- Request queue with rate limiting to stay within free tier

### 3a. Smart Call Analysis

**Trigger**: When a call is created or narrative updated

**Flow**:
```
Call created/updated → server sends narrative to Groq →
Groq returns: {
  suggestedFlags: string[],      // Risk factors detected in narrative
  safetyBriefing: string,        // Officer safety summary
  severityOverride?: 'moderate' | 'major',  // AI-suggested escalation
  confidence: number             // 0-1 confidence score
}
→ Results stored on call record → Broadcast to dispatch clients
→ Voice alert uses AI safety briefing if available
```

**System prompt**: Trained as an experienced police dispatcher/analyst. Extracts weapons mentions, DV indicators, mental health flags, repeat offender patterns, location hazards.

**Confidence threshold**: Only auto-flag at confidence > 0.8. Below that, show as "AI suggestion" for dispatcher review.

### 3b. Dispatch Narrative Generator

**Trigger**: Dispatcher clicks "AI Assist" button in call narrative field

**Flow**:
```
Dispatcher types brief notes → clicks AI Assist →
POST /api/ai/narrative { notes, callType, location } →
Groq generates proper CAD narrative →
Returned to dispatcher for review/edit before saving
```

**Never auto-saves** — always presented as a draft for human review.

### 3c. Unit Suggestion Engine

**Trigger**: When dispatcher opens "Dispatch Units" panel for a call

**Flow**:
```
Call details + all unit statuses/GPS → POST /api/ai/suggest-units →
Groq analyzes: proximity, availability, specialization, workload →
Returns ranked unit list with reasoning →
Displayed as suggestions in dispatch panel (dispatcher makes final call)
```

**Inputs to AI**:
- Call type, priority, flags, location (lat/lng)
- All units: call_sign, status, last GPS position, current call count, specializations
- Time of day, shift information

## 4. Integration Points

### WebSocket Events (new)

| Event | Severity | Description |
|-------|----------|-------------|
| `alert:minor` | Minor | Wraps existing low-priority events |
| `alert:moderate` | Moderate | Wraps existing medium-priority events |
| `alert:major` | Major | Wraps existing high-priority events |
| `ai:analysis_complete` | — | AI call analysis results ready |
| `ai:narrative_ready` | — | AI narrative draft ready |

### Settings (per-user, localStorage)

| Key | Default | Description |
|-----|---------|-------------|
| `rmpg-voice-engine` | `'edge-tts'` | `'edge-tts'` or `'browser'` fallback |
| `rmpg-alert-min-tier` | `'minor'` | Minimum tier for audio alerts |
| `rmpg-ai-assist` | `true` | Enable/disable AI features |
| `rmpg-ai-auto-analyze` | `true` | Auto-analyze new calls |

### Pages Affected

- **DispatchPage.tsx** — AI sidebar, narrative assist button, unit suggestions, severity badges
- **Layout.tsx** (useDispatchVoiceAlerts hook) — Upgraded with severity tiers + Edge-TTS
- **SettingsPage or user preferences** — New toggles for voice engine, AI, alert tiers
- **All pages** — Alert banners (minor/moderate/major) rendered from Layout

## 5. New Files

| File | Purpose |
|------|---------|
| `server/src/routes/tts.ts` | Edge-TTS endpoint |
| `server/src/routes/ai.ts` | Groq AI endpoints (analysis, narrative, suggestions) |
| `server/src/utils/groqAI.ts` | Groq client, prompts, rate limiting |
| `client/src/utils/edgeTTS.ts` | Client-side Edge-TTS fetcher + audio pipeline |
| `client/src/utils/alertSeverity.ts` | Severity classification logic |
| `client/src/components/AlertBanner.tsx` | Tiered alert banner (minor/moderate/major) |
| `client/src/components/AIDispatchSidebar.tsx` | AI analysis panel for dispatch page |
| `client/src/components/NarrativeAssist.tsx` | AI narrative generation button + preview |

## 6. Dependencies

| Package | Purpose | License |
|---------|---------|---------|
| `edge-tts` | Microsoft Edge neural TTS | MIT |
| `groq-sdk` | Groq API client | Apache 2.0 |

## 7. Rollout

1. **Phase 1**: Alert severity system + Edge-TTS voice (no AI dependency)
2. **Phase 2**: Groq AI integration (call analysis + narrative assist)
3. **Phase 3**: Unit suggestion engine + polish

Each phase is independently deployable. Phase 1 improves the system immediately without any external API dependency beyond Edge-TTS.
