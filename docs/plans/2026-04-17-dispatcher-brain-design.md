# Dispatcher Brain — Unified Voice Feedback & Speech Enhancements Design

**Date:** 2026-04-17
**Status:** Approved
**Supersedes:** Extends `2026-03-25-voice-ai-dispatch-design.md` and `2026-03-26-unified-voice-channel-design.md`

## Overview

RMPG Flex already ships a mature voice stack: Edge-TTS neural synthesis with a radio-bandpass filter, a full state-machine voice channel (`idle → alerting → listening → processing → responding`), hybrid STT (Web Speech + server Whisper), a stress analyzer, conversation memory, and an NLU command executor. This design adds a single **Dispatcher Brain** module that unifies four new capability directions on top of that foundation:

1. Conversational back-and-forth (multi-turn dialog with referent memory)
2. Proactive situational coaching (unprompted guidance tied to call protocols + timers)
3. Broader event coverage (voice announcements for citations, incidents, warrants, evidence, arrests, HR)
4. Voice persona customization (per-user voice, rate, pitch, terseness)

All four ship as one coherent module so they share a single speak-queue, cooldown policy, and context memory. Implementation is phased across four deployable merges.

Brain logic is **rule-based + templates** — no LLM. This keeps the dispatcher offline-capable, unit-testable, auditable, and deploy-safe on the existing VPS. Every spoken line traces back to a template + slot values and logs through the existing audit trail.

## Architecture

A new module `client/src/utils/dispatcherBrain.ts` sits between event sources (WebSocket, REST, timers, officer utterances) and the existing voice stack. It does not replace `voiceChannel`, `voiceAlerts`, or `edgeTTS` — it orchestrates them.

```
 ┌───────────────────────────────────────────────────────────┐
 │                     dispatcherBrain.ts                    │
 │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
 │  │  Event   │→ │  Rules   │→ │  Memory  │→ │  Speak   │   │
 │  │  fan-in  │  │  engine  │  │ (context)│  │  queue   │   │
 │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
 └──────────┬──────────────────────────────────────┬─────────┘
            │                                      │
            ▼                                      ▼
      WebSocket + REST                    voiceChannel / edgeTTS
      (dispatch, citations,               (existing alert→listen
       incidents, warrants,                →process→respond)
       evidence, HR, …)
```

### Inputs

- Existing `broadcastDispatchUpdate` / `broadcastUnitUpdate` WebSocket channels
- New WebSocket event types: `citation_created`, `incident_created`, `warrant_entered`, `evidence_logged`, `arrest_created`, `leave_approved`
- 30-second timer tick for overdue status checks, geofence breach detection, shift reminders
- Officer utterances from `voiceChannel` when it lands in `PROCESSING`

### Outputs

- Speech via existing `announceWithSeverity(text, severity)`
- State-machine transitions via `voiceChannel.requestListen()` / `voiceChannel.respond()`
- Transcript entries to a new `useDispatchTranscript` hook (consumed by the accessibility pane)

### Speak queue

Single priority queue keyed on `severity` (critical > high > normal > low) with per-rule cooldown windows. Critical alerts preempt lower-severity speech already in the queue. Global rate limit: max one non-critical announcement per 6 seconds. The queue is the single point where volume is controlled so coaching and event announcements never compound into noise.

## Rules engine

Rules are typed entries in a registry concatenated from `client/src/utils/dispatcherRules/*.ts`.

```ts
interface DispatcherRule {
  id: string;                           // 'dv-approach-warning'
  trigger: 'event' | 'timer' | 'state';
  eventTypes?: string[];                // ['call_created', 'call_updated']
  match: (ctx: BrainContext) => boolean;
  severity: AlertSeverity;              // drives TTS tone + queue priority
  cooldownMs: number;                   // per-rule (or per-rule+entity)
  compose: (ctx: BrainContext) => string;
  followUp?: 'listen' | 'none';
}
```

### Initial rule catalog

| Category | Rule id | Trigger | Example phrasing |
|---|---|---|---|
| Coaching | `dv-approach-warning` | `call_created` where `domestic_violence=1` | "Approach with caution — domestic, weapons history on location." |
| Coaching | `felony-backup-suggest` | `call_created` where `felony_in_progress=1` and `assigned_units<2` | "Felony in progress, recommend second unit." |
| Coaching | `mental-health-protocol` | `call_created` where `mental_health_crisis=1` | "Mental health crisis — CIT response preferred, non-lethal staging." |
| Coaching | `overdue-status-check` | 8-min timer on `on_scene` with no `status_update` | "3-Adam, status check, 8 minutes on scene." |
| Coaching | `geofence-breach` | WS `unit_outside_beat` | "3-Adam is outside assigned beat Delta-2." |
| Event | `citation-issued` | WS `citation_created` | "Citation RN-26-0142 issued by 4-Bravo, $85 fine." |
| Event | `incident-created` | WS `incident_created` | "Incident RN-26-0301 opened from call CN-26-0457." |
| Event | `warrant-entered` | WS `warrant_entered` | "New warrant on [name], felony, $50,000 bail." |
| Event | `evidence-logged` | WS `evidence_logged` | "Evidence tag E-26-0089 logged for case 26-0301." |
| Event | `arrest-booked` | WS `arrest_created` | "Arrest booked: [name], felony theft, by 4-Bravo." |
| Event | `hr-approval` | WS `leave_approved` | "Leave request approved for [officer]." |

### Cooldown & dedup

`Map<ruleId + entityId, lastSpokenAt>`. A `felony-backup-suggest` for call `CN-26-0457` won't repeat for 5 minutes even if the call updates; different calls can still fire it independently. The brain queue drops low-severity duplicates (same rule + entity within cooldown) before they hit TTS.

### Server-side broadcast additions

Non-dispatch modules currently persist mutations without broadcasting. We add `broadcastDispatchUpdate({ action, ...payload })` at six mutation sites:

- `server/src/routes/citations.ts` — POST create, POST batch status
- `server/src/routes/incidents.ts` — POST create
- `server/src/routes/warrants.ts` — POST create
- `server/src/routes/evidence.ts` — POST log entry
- `server/src/routes/arrests.ts` — POST create
- `server/src/routes/hr/leave.ts` — PATCH approve

No new server infrastructure; each call is 3-5 lines wedged next to the existing `auditLog()` call.

## Conversation memory

The existing `conversationMemory.ts` rolling transcript is extended into a typed context model:

```ts
interface BrainContext {
  lastCall?:   { id: string; call_number: string; location: string; type: string };
  lastUnit?:   { call_sign: string; officer_name?: string };
  lastPerson?: { id: number; first_name: string; last_name: string };
  lastPlate?:  { plate: string; state: string };

  currentUserCallSign?:   string;
  currentUserOnSceneAt?:  number;
  currentUserGeofence?:   { beat: string; inBeat: boolean };

  transcript: TranscriptEntry[];  // rolling 10 entries
}
```

Context updates in two deterministic places:

1. **Event ingestion** — when the brain speaks about a call/unit/person, the corresponding `lastX` slot is updated.
2. **Utterance ingestion** — NLU extracts entities from officer speech and promotes them to `lastX`. Example: "Run plate 8-Ida-Robert-7-4-5" → `lastPlate`.

### Referent resolver

`resolveReferents(transcript, ctx)` is a pre-pass inserted into the NLU pipeline **before** the slot-filler. It rewrites pronouns and deictics using context, leaving the downstream intent matcher untouched.

| Utterance | Rewrites to |
|---|---|
| `"tell me more about that call"` | `"tell me more about call CN-26-0457"` |
| `"who's assigned?"` | `"who is assigned to call CN-26-0457"` |
| `"run him"` | `"run person id 1042"` |
| `"put me 10-7 at that location"` | `"put 3-Adam 10-7 at 123 Main St"` |
| `"second unit to that call"` | `"dispatch second unit to call CN-26-0457"` |

Unresolved referents trigger a `"Which call did you mean?"` clarification turn.

### Multi-turn dialog patterns

1. **Clarification** — ambiguity detected → mark `pendingClarification` → open 4s listen → resolve on next utterance.
2. **Confirmation** — NLU confidence 0.5–0.7 triggers "Did you say X? Please confirm." Context routes yes/no to the right action.
3. **Follow-up chain** — "run this plate" → result → "who's the registered owner?" works without re-stating the plate because `lastPlate` carries forward.

Every rewrite is logged to audit so a dispatcher reviewing a shift transcript sees exactly what the system resolved "that call" to.

### Persistence

In-memory per session; stale referents decay after 5 minutes. Optional: flush the rolling transcript to a new `voice_transcripts` table keyed to `user_id` + `shift_id` at shift end for later review. Opt-in via admin setting.

## Voice persona

One persona per user, stored in two places:

- **localStorage** — keys `rmpg-voice-persona`, `rmpg-voice-rate`, `rmpg-voice-pitch`, `rmpg-voice-terseness` for instant pickup
- **users table** — new columns `voice_persona`, `voice_rate`, `voice_terseness` via `addCol` migrations, synced on login so the persona follows across devices

```ts
interface VoicePersona {
  voiceId:   string;                                // e.g. "en-US-JennyNeural"
  rate:      number;                                // 0.8 – 1.3, default 1.0
  pitch:     number;                                // -10% to +10%, default 0
  terseness: 'narrative' | 'standard' | 'terse';
}
```

### Terseness modes

Terseness does not touch `edgeTTS.ts`. It changes how `composeDispatchNarrative()` and the rule `compose()` functions render templates.

| Mode | "new call" sample |
|---|---|
| narrative | `"New call, priority one, domestic disturbance at 123 Main Street, apartment 4B, zone Delta-2 beat 14. Suspect is a white male, 30s, black hoodie. Unit 3-Adam assigned."` |
| standard | `"Priority one domestic, 123 Main, Delta-2-14, 3-Adam."` |
| terse | `"P1 domestic, 123 Main, 3-Adam."` |

### Voice selection

Four curated Edge-TTS voices exposed with friendly labels rather than raw voice IDs:

| Label | Voice ID |
|---|---|
| Female – Calm | `en-US-JennyNeural` |
| Female – Crisp | `en-US-AriaNeural` |
| Male – Baritone | `en-US-GuyNeural` |
| Male – Tactical | `en-US-DavisNeural` |

### UI

New "Voice" tab under Settings → User Preferences with voice picker, rate/pitch sliders, terseness radio, and a **Preview** button that speaks a sample line using the current settings. One additional row on the existing TTS test panel lets admins audit.

## Accessibility pane

New `<DispatcherTranscript>` component mounted as a collapsible drawer in the status bar area, keybind `T`. Consumes the same `useDispatchTranscript` hook the brain writes to, so every spoken line is mirrored as text.

- **ARIA live region** — `aria-live="polite"` for normal, `assertive` for critical, so screen readers pick up announcements without needing TTS
- **Severity color dots** — green/amber/red matching the existing LED palette, so hearing-impaired dispatchers get urgency visually
- **Filter + search** — severity, rule category, call number
- **Export** — copies the current transcript to clipboard as plain text
- **Load previous shift** — appears only if the optional `voice_transcripts` persistence is enabled

No schema change for the pane itself; data lives in the in-memory rolling buffer.

## Testing

Three test layers using vitest (already wired for server; add `vitest` to `client/` for this work).

- **Rule engine unit tests** — `client/src/utils/__tests__/dispatcherRules.test.ts`. Each rule: (a) match-hits, (b) match-misses, (c) compose-output snapshot, (d) cooldown suppression. ~4 tests × ~15 rules = 60 tests.
- **Referent resolver tests** — table-driven, ~20 transcript/context/expected-rewrite triples.
- **Brain integration tests** — fire synthetic WS events, assert speak-queue contents in order. Uses a mock TTS that records calls.

**Manual QA matrix:** 4 personas (narrative/standard/terse × 2 voices) × 6 representative events = 24 captured audio samples for regression listening.

## Rollout

| Phase | Scope | Flag gate |
|---|---|---|
| 1 | Persona UI + DB columns, terseness rendering, transcript pane (no brain yet) | Deploy; officers opt in via settings |
| 2 | Rules engine + event coverage (WS broadcasts + event rules) | `voice_brain_enabled` user flag, default off |
| 3 | Coaching rules (timers, geofence, approach warnings) | Same flag; admins enable per-shift first |
| 4 | Multi-turn dialog + referent resolver | Same flag; requires existing voice channel enabled |

Each phase is independently revertable via flag or by removing the rules file.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Voice spam fatigues officers | Global 6s cooldown + per-rule cooldowns + severity preemption + user "pause 15 min" hotkey |
| Wrong referent resolution triggers wrong action | Log every rewrite to audit table; mutating commands still require 0.7+ confidence + confirmation |
| Edge-TTS outage | Existing fallback to browser SpeechSynthesis in `edgeTTS.ts` |
| WS broadcast flood on busy shift | Brain queue drops low-severity duplicates (same rule + entity within cooldown) before TTS |
| Officer utters dispatch action accidentally | Confirmation step for mutating commands (unchanged from current design) |
| SSD wear from transcript persistence | Optional feature, off by default; batches writes at shift-end only |

## Out of scope (YAGNI)

- Real-time translation / multilingual dispatch
- Sentiment-driven voice modulation beyond the existing stress analyzer
- On-device Whisper (stays server-side)
- Voice-driven report authoring ("dictate an incident narrative") — separate future project
