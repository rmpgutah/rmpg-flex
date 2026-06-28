# Unified Voice Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified voice channel that enriches dispatch alerts with full tactical narratives and enables officers to speak commands back to the system (status updates, queries, requests).

**Architecture:** New `narrativeComposer` builds rich spoken text from all call fields. A `voiceChannel` state machine manages IDLE→ALERTING→LISTENING→PROCESSING→RESPONDING→IDLE transitions. Hybrid STT uses Browser Web Speech API for fast commands and server-side Whisper for complex input. A new `/api/voice/command` endpoint handles transcription + command execution.

**Tech Stack:** Edge-TTS (existing), Web Speech API (browser), OpenAI Whisper API (via aiProvider.ts), WebSocket (existing), localStorage + user_preferences DB (existing)

---

### Task 1: Narrative Composer — Rich Tactical Alert Builder

**Files:**
- Create: `client/src/utils/narrativeComposer.ts`

**Step 1: Create the narrative composer module**

```typescript
// client/src/utils/narrativeComposer.ts
// ============================================================
// RMPG Flex — Dispatch Narrative Composer
// Builds rich tactical spoken narratives from call data.
// Fields are ordered by officer safety priority:
//   1. Call ID + type + priority
//   2. Location (full address, apartment, building)
//   3. Zone/beat/section
//   4. Suspect/vehicle description
//   5. Safety flags (weapons, warrants, pursuit, DV, etc.)
//   6. Service requests (EMS, K9)
//   7. Assigned units
// Empty fields are silently skipped.
// ============================================================

import { toPhonetic } from './voiceAlerts';

export type NarrativeDetail = 'minimal' | 'standard' | 'full';

interface CallData {
  call_number?: string;
  call_type?: string;
  incident_type?: string;
  nature?: string;
  priority?: string;
  status?: string;
  // Location
  location?: string;
  location_address?: string;
  apartment?: string;
  location_room?: string;
  property_name?: string;
  business_name?: string;
  client_name?: string;
  cross_street?: string;
  // Zone/Beat
  zone?: string;
  beat?: string;
  zone_beat?: string;
  section_name?: string;
  beat_descriptor?: string;
  // Descriptions
  suspect_description?: string;
  subject_description?: string;
  vehicle_description?: string;
  narrative?: string;
  description?: string;
  // Safety flags
  weapons_involved?: string | boolean;
  domestic_violence?: boolean;
  mental_health_crisis?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  gang_related?: boolean;
  hazmat?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  ems_requested?: boolean;
  k9_requested?: boolean;
  drugs_involved?: boolean;
  alcohol_involved?: boolean;
  injuries_reported?: boolean;
  // Units
  assigned_units?: string[];
  // Caller
  caller_name?: string;
  caller_phone?: string;
  // Source
  source?: string;
  call_source?: string;
}

/** Get the user's preferred detail level from localStorage */
export function getDetailLevel(): NarrativeDetail {
  const stored = localStorage.getItem('rmpg-voice-detail');
  if (stored === 'minimal' || stored === 'standard' || stored === 'full') return stored;
  return 'full'; // default
}

export function setDetailLevel(level: NarrativeDetail): void {
  localStorage.setItem('rmpg-voice-detail', level);
}

/**
 * Compose a full tactical dispatch narrative from call data.
 * Returns a single string suitable for TTS, with natural punctuation
 * for proper pacing. Empty/null fields are silently omitted.
 */
export function composeDispatchNarrative(call: CallData, detail?: NarrativeDetail): string {
  const level = detail || getDetailLevel();
  const parts: string[] = [];

  // ── 1. Call identification ──
  const type = call.call_type || call.incident_type || call.nature || 'Unknown call';
  const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (level === 'minimal') {
    parts.push(`${typeName} at ${resolveLocation(call)}.`);
    return parts.join(' ');
  }

  // Standard and full both get call number + type + priority
  if (call.call_number) {
    parts.push(`Dispatch, call ${call.call_number}.`);
  } else {
    parts.push('Dispatch.');
  }
  parts.push(`${typeName}.`);

  // Priority
  if (call.priority === 'P1') parts.push('Priority one.');
  else if (call.priority === 'P2') parts.push('Priority two.');

  // ── 2. Location ──
  const loc = resolveLocation(call);
  if (loc) parts.push(loc + '.');

  const room = call.apartment || call.location_room;
  if (room) parts.push(`Apartment ${room}.`);

  const building = call.property_name || call.business_name || call.client_name;
  if (building) parts.push(`At ${building}.`);

  if (call.cross_street) parts.push(`Cross street: ${call.cross_street}.`);

  // ── 3. Zone/Beat (standard+) ──
  const zone = call.zone || (call.zone_beat ? call.zone_beat.split('/')[0]?.replace(/^Z/i, '') : '');
  const beat = call.beat || (call.zone_beat ? call.zone_beat.split('/')[1]?.replace(/^B/i, '') : '');
  if (zone || beat) {
    const zbParts: string[] = [];
    if (zone) zbParts.push(`Zone ${zone}`);
    if (beat) zbParts.push(`Beat ${beat}`);
    parts.push(zbParts.join(', ') + '.');
  }

  // ── 4. Suspect/vehicle description (full only) ──
  if (level === 'full') {
    const suspect = call.suspect_description || call.subject_description;
    if (suspect) parts.push(`Suspect: ${suspect}.`);

    if (call.vehicle_description) {
      // Check if vehicle description contains a plate
      const plateMatch = call.vehicle_description.match(/\b([A-Z]{2,4})[- ]?(\d{1,5})\b/i);
      if (plateMatch) {
        const platePhonetic = toPhonetic(plateMatch[1] + plateMatch[2]);
        const descWithoutPlate = call.vehicle_description.replace(plateMatch[0], '').trim();
        parts.push(`Vehicle: ${descWithoutPlate || 'Unknown'}. Plate: ${platePhonetic}.`);
      } else {
        parts.push(`Vehicle: ${call.vehicle_description}.`);
      }
    }
  }

  // ── 5. Safety flags ──
  const flags: string[] = [];

  // Critical flags first
  if (call.weapons_involved && call.weapons_involved !== 'None' && call.weapons_involved !== false) {
    const weaponType = typeof call.weapons_involved === 'string' && call.weapons_involved !== 'true'
      ? call.weapons_involved : '';
    flags.push(weaponType ? `Armed subject, ${weaponType}.` : 'Armed subject.');
  }
  if (call.felony_in_progress) flags.push('Felony in progress.');
  if (call.officer_safety_caution) flags.push('Officer safety caution.');
  if (call.vehicle_pursuit) flags.push('Vehicle pursuit in progress.');
  if (call.foot_pursuit) flags.push('Foot pursuit in progress.');
  if (call.domestic_violence) flags.push('Domestic violence.');
  if (call.gang_related) flags.push('Gang related.');
  if (call.hazmat) flags.push('Hazmat situation.');

  // High flags
  if (call.mental_health_crisis) flags.push('Mental health crisis.');
  if (call.injuries_reported) flags.push('Injuries reported.');
  if (call.drugs_involved) flags.push('Drugs involved.');

  if (flags.length > 0) parts.push(...flags);

  // ── 6. Service requests ──
  if (call.ems_requested) parts.push('E.M.S. requested.');
  if (call.k9_requested) parts.push('K-9 requested.');

  // ── 7. Assigned units ──
  if (call.assigned_units && call.assigned_units.length > 0) {
    parts.push(`Assigned: ${call.assigned_units.join(', ')}.`);
  }

  // ── 8. Brief narrative excerpt (full only, first sentence) ──
  if (level === 'full') {
    const narr = call.narrative || call.description;
    if (narr) {
      const firstSentence = narr.split(/[.!?]/)[0]?.trim();
      if (firstSentence && firstSentence.length > 10 && firstSentence.length < 150) {
        parts.push(`Info: ${firstSentence}.`);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Compose a concise status update narrative.
 */
export function composeStatusNarrative(callSign: string, status: string): string {
  const statusMap: Record<string, string> = {
    'en_route': 'en route',
    'on_scene': 'on scene',
    'available': 'available',
    'busy': 'busy',
    'out_of_service': 'out of service',
    'dispatched': 'dispatched',
    'off_duty': 'off duty',
    'break': 'on break',
  };
  const spoken = statusMap[status] || status.replace(/_/g, ' ');
  return `Unit ${callSign}, now ${spoken}.`;
}

/**
 * Compose a panic alert narrative.
 */
export function composePanicNarrative(officerName: string, location?: string, callSign?: string): string {
  const parts = ['Panic alert!'];
  if (callSign) parts.push(`Unit ${callSign}.`);
  parts.push(`${officerName} has activated panic.`);
  if (location) parts.push(`Location: ${location}.`);
  parts.push('All units respond.');
  return parts.join(' ');
}

/**
 * Compose a BOLO narrative.
 */
export function composeBoloNarrative(data: {
  title?: string;
  subject?: string;
  description?: string;
  vehicle?: string;
  priority?: string;
}): string {
  const parts = ['Attention all units. B.O.L.O.'];
  if (data.title) parts.push(`${data.title}.`);
  if (data.description) {
    const first = data.description.split(/[.!?]/)[0]?.trim();
    if (first && first.length < 150) parts.push(`${first}.`);
  }
  if (data.vehicle) parts.push(`Vehicle: ${data.vehicle}.`);
  return parts.join(' ');
}

/**
 * Compose a backup request narrative.
 */
export function composeBackupNarrative(unit: string, location: string, callNumber?: string): string {
  const parts = [`Backup requested by ${unit} at ${location}.`];
  if (callNumber) parts.push(`Reference call ${callNumber}.`);
  parts.push('All available units respond.');
  return parts.join(' ');
}

/**
 * Compose a pursuit narrative.
 */
export function composePursuitNarrative(data: {
  unit?: string;
  direction?: string;
  location?: string;
  speed?: string;
  vehicle?: string;
}): string {
  const parts = ['Pursuit in progress.'];
  if (data.unit) parts.push(`Unit ${data.unit}.`);
  if (data.location) parts.push(`Location: ${data.location}.`);
  if (data.direction) parts.push(`Direction: ${data.direction}.`);
  if (data.speed) parts.push(`Speed: ${data.speed} miles per hour.`);
  if (data.vehicle) parts.push(`Vehicle: ${data.vehicle}.`);
  return parts.join(' ');
}

// ── Helpers ──

function resolveLocation(call: CallData): string {
  return call.location || call.location_address || 'unknown location';
}
```

**Step 2: Verify the module compiles**

Run: `cd "/Users/rmpgutah/RMPG Flex/client" && npx tsc --noEmit src/utils/narrativeComposer.ts 2>&1 | head -20`
Expected: No errors (or only ambient type issues from missing tsconfig context — that's fine)

**Step 3: Commit**

```bash
git add client/src/utils/narrativeComposer.ts
git commit -m "feat: add narrative composer for rich tactical dispatch alerts"
```

---

### Task 2: Integrate Narrative Composer Into Voice Alerts Hook

**Files:**
- Modify: `client/src/hooks/useDispatchVoiceAlerts.ts`

**Step 1: Replace terse Edge-TTS messages with rich narratives**

In `useDispatchVoiceAlerts.ts`, update the `dispatch_update` handler to use `composeDispatchNarrative` instead of inline template strings.

Replace the `call_created` block (lines ~94-103):
```typescript
// OLD:
if (isEdgeTTSEnabled()) {
  const text = `New call: ${call.call_type || call.nature || 'Unknown'} at ${call.location || 'unknown location'}`;
  announceWithSeverity(text, severity);
}

// NEW:
if (isEdgeTTSEnabled()) {
  const text = composeDispatchNarrative(call);
  announceWithSeverity(text, severity);
}
```

Replace the `call_status_changed` dispatched block (lines ~115-118):
```typescript
// OLD:
const units = Array.isArray(call.assigned_units) ? call.assigned_units.join(', ') : '';
const text = `Dispatched${units ? ` ${units}` : ''} to ${call.call_type || 'call'} at ${call.location || 'unknown location'}`;

// NEW:
const text = composeDispatchNarrative(call);
```

Replace the panic_alert handler (lines ~155-157):
```typescript
// OLD:
announceWithSeverity(`Panic alert! ${officerName} has activated panic.`, 'major');

// NEW:
const loc = data.location || data.gps_address || '';
const cs = data.call_sign || data.unit || '';
announceWithSeverity(composePanicNarrative(officerName, loc, cs), 'major');
```

Replace the bolo_alert handler (lines ~170):
```typescript
// OLD:
announceWithSeverity(`BOLO alert: ${boloTitle}`, 'moderate');

// NEW:
announceWithSeverity(composeBoloNarrative({
  title: boloTitle,
  description: data.description || data.details || '',
  vehicle: data.vehicle_description || data.vehicle || '',
  priority: data.priority,
}), 'moderate');
```

Replace the backup_request handler (lines ~199):
```typescript
// OLD:
announceWithSeverity(`Backup requested by ${unit} at ${loc}`, 'moderate');

// NEW:
announceWithSeverity(composeBackupNarrative(unit, loc, data.call_number), 'moderate');
```

Replace the pursuit_update handler (lines ~213-214):
```typescript
// OLD:
announceWithSeverity(`Pursuit update: ${unit}${direction ? ` heading ${direction}` : ''}`, 'major');

// NEW:
announceWithSeverity(composePursuitNarrative({
  unit,
  direction,
  location: data.location || '',
  speed: data.speed || '',
  vehicle: data.vehicle_description || '',
}), 'major');
```

Add import at top:
```typescript
import {
  composeDispatchNarrative,
  composePanicNarrative,
  composeBoloNarrative,
  composeBackupNarrative,
  composePursuitNarrative,
} from '../utils/narrativeComposer';
```

**Step 2: Verify build compiles**

Run: `cd "/Users/rmpgutah/RMPG Flex/client" && npx vite build 2>&1 | tail -10`
Expected: Build success

**Step 3: Commit**

```bash
git add client/src/hooks/useDispatchVoiceAlerts.ts
git commit -m "feat: integrate rich narrative composer into dispatch voice alerts"
```

---

### Task 3: Increase TTS Character Limit for Longer Narratives

**Files:**
- Modify: `server/src/routes/tts.ts` (line 46)

**Step 1: Raise the 500-character limit to 1500**

Full narratives with suspect descriptions and safety flags can exceed 500 chars. The Edge-TTS service handles long text fine.

In `server/src/routes/tts.ts` line 46, change:
```typescript
// OLD:
if (text.length > 500) {
  res.status(400).json({ error: 'text must be 500 characters or less' });

// NEW:
if (text.length > 1500) {
  res.status(400).json({ error: 'text must be 1500 characters or less' });
```

**Step 2: Commit**

```bash
git add server/src/routes/tts.ts
git commit -m "feat: raise TTS character limit to 1500 for rich dispatch narratives"
```

---

### Task 4: Voice Channel State Machine

**Files:**
- Create: `client/src/utils/voiceChannel.ts`

**Step 1: Create the state machine**

```typescript
// client/src/utils/voiceChannel.ts
// ============================================================
// RMPG Flex — Unified Voice Channel State Machine
// Manages the alert→listen→process→respond cycle.
//
// States: IDLE → ALERTING → LISTENING → PROCESSING → RESPONDING → IDLE
//                              ↓
//                           TIMEOUT → IDLE
//
// Listen modes (per-user preference):
//   - auto:    mic opens after every alert
//   - wake:    mic listens for wake word, then activates
//   - manual:  mic only opens on keybind (V key)
// ============================================================

import { announceWithSeverity, speak, clearQueue } from './edgeTTS';
import type { AlertSeverity } from './alertSeverity';

// ─── Types ──────────────────────────────────────────────────

export type VoiceChannelState = 'idle' | 'alerting' | 'listening' | 'processing' | 'responding';
export type ListenMode = 'auto' | 'wake' | 'manual';

export interface VoiceChannelConfig {
  listenMode: ListenMode;
  listenDurationMs: number;
  wakeWord: string;
  confirmationMode: 'speak' | 'beep' | 'silent';
}

export interface VoiceChannelCallbacks {
  onStateChange: (state: VoiceChannelState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onCommandResult: (result: CommandResult) => void;
  onError: (error: string) => void;
}

export interface CommandResult {
  success: boolean;
  action: string;
  message: string;
  data?: any;
}

// ─── Storage Keys ───────────────────────────────────────────

const LISTEN_MODE_KEY = 'rmpg-voice-listen-mode';
const LISTEN_DURATION_KEY = 'rmpg-voice-listen-duration';
const WAKE_WORD_KEY = 'rmpg-voice-wake-word';
const CONFIRM_MODE_KEY = 'rmpg-voice-confirm-mode';
const VOICE_CHANNEL_ENABLED_KEY = 'rmpg-voice-channel-enabled';

// ─── Config Helpers ─────────────────────────────────────────

export function getVoiceChannelConfig(): VoiceChannelConfig {
  return {
    listenMode: (localStorage.getItem(LISTEN_MODE_KEY) as ListenMode) || 'manual',
    listenDurationMs: parseInt(localStorage.getItem(LISTEN_DURATION_KEY) || '5000', 10),
    wakeWord: localStorage.getItem(WAKE_WORD_KEY) || 'dispatch',
    confirmationMode: (localStorage.getItem(CONFIRM_MODE_KEY) as 'speak' | 'beep' | 'silent') || 'speak',
  };
}

export function setVoiceChannelConfig(partial: Partial<VoiceChannelConfig>): void {
  if (partial.listenMode) localStorage.setItem(LISTEN_MODE_KEY, partial.listenMode);
  if (partial.listenDurationMs) localStorage.setItem(LISTEN_DURATION_KEY, String(partial.listenDurationMs));
  if (partial.wakeWord) localStorage.setItem(WAKE_WORD_KEY, partial.wakeWord);
  if (partial.confirmationMode) localStorage.setItem(CONFIRM_MODE_KEY, partial.confirmationMode);
}

export function isVoiceChannelEnabled(): boolean {
  return localStorage.getItem(VOICE_CHANNEL_ENABLED_KEY) !== 'false';
}

export function setVoiceChannelEnabled(enabled: boolean): void {
  localStorage.setItem(VOICE_CHANNEL_ENABLED_KEY, String(enabled));
}

// ─── Voice Channel Class ────────────────────────────────────

export class VoiceChannel {
  private state: VoiceChannelState = 'idle';
  private config: VoiceChannelConfig;
  private callbacks: VoiceChannelCallbacks;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  private recognition: any = null; // SpeechRecognition instance
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  constructor(callbacks: VoiceChannelCallbacks) {
    this.config = getVoiceChannelConfig();
    this.callbacks = callbacks;
  }

  getState(): VoiceChannelState {
    return this.state;
  }

  refreshConfig(): void {
    this.config = getVoiceChannelConfig();
  }

  // ── State Transitions ──

  private setState(newState: VoiceChannelState): void {
    const prevState = this.state;
    this.state = newState;
    this.callbacks.onStateChange(newState);
    console.log(`[VoiceChannel] ${prevState} → ${newState}`);
  }

  /**
   * Called when a dispatch alert arrives.
   * Speaks the narrative, then transitions based on listen mode.
   */
  async alert(narrative: string, severity: AlertSeverity): Promise<void> {
    // Major alert preempts current listening
    if (this.state === 'listening') {
      this.stopListening();
    }

    // If already alerting, queue will handle it
    if (this.state !== 'idle' && this.state !== 'alerting') {
      // Already processing or responding — just queue the speech
      await speak(narrative, severity);
      return;
    }

    this.setState('alerting');

    try {
      await announceWithSeverity(narrative, severity);
    } catch {
      // TTS failed, still transition
    }

    // After alert, decide on listen mode
    if (!isVoiceChannelEnabled()) {
      this.setState('idle');
      return;
    }

    this.refreshConfig();

    if (this.config.listenMode === 'auto') {
      this.startListening();
    } else if (this.config.listenMode === 'wake') {
      this.startWakeWordDetection();
    } else {
      // manual — go back to idle, user must press key
      this.setState('idle');
    }
  }

  /**
   * Manually activate listening (V key or button press).
   * Works from any state except processing/responding.
   */
  activateManualListen(): void {
    if (this.state === 'processing' || this.state === 'responding') return;
    if (this.state === 'alerting') return; // can't interrupt alert
    this.startListening();
  }

  /**
   * Start listening for voice input via Web Speech API (fast, browser-native).
   */
  private startListening(): void {
    this.setState('listening');

    // Set timeout for listen window
    this.listenTimer = setTimeout(() => {
      if (this.state === 'listening') {
        this.stopListening();
        this.setState('idle');
      }
    }, this.config.listenDurationMs);

    // Start browser speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.callbacks.onError('Speech recognition not available in this browser');
      this.setState('idle');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 3;

    // Also start recording for server-side Whisper (parallel path)
    this.startAudioCapture();

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (interimTranscript) {
        this.callbacks.onTranscript(interimTranscript, false);
      }

      if (finalTranscript) {
        this.callbacks.onTranscript(finalTranscript, true);
        this.processCommand(finalTranscript, 'browser');
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Normal timeout — no speech detected
      } else if (event.error === 'not-allowed') {
        this.callbacks.onError('Microphone permission denied');
      } else {
        this.callbacks.onError(`Speech error: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      // Recognition ended naturally (no speech detected)
      if (this.state === 'listening') {
        this.stopListening();
        this.setState('idle');
      }
    };

    try {
      this.recognition.start();
    } catch (err) {
      this.callbacks.onError('Failed to start speech recognition');
      this.setState('idle');
    }
  }

  /**
   * Start wake word detection (light listening for "Dispatch" or custom word).
   */
  private startWakeWordDetection(): void {
    this.setState('listening'); // visual shows "listening for wake word"

    this.listenTimer = setTimeout(() => {
      if (this.state === 'listening') {
        this.stopListening();
        this.setState('idle');
      }
    }, this.config.listenDurationMs);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.setState('idle');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.toLowerCase() || '';
      if (transcript.includes(this.config.wakeWord.toLowerCase())) {
        // Wake word detected — switch to full command listening
        this.stopListening();
        this.startListening();
      }
    };

    this.recognition.onend = () => {
      if (this.state === 'listening') {
        this.stopListening();
        this.setState('idle');
      }
    };

    try {
      this.recognition.start();
    } catch {
      this.setState('idle');
    }
  }

  private stopListening(): void {
    if (this.listenTimer) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
      this.recognition = null;
    }
    this.stopAudioCapture();
  }

  // ── Audio Capture for Server-Side Whisper ──

  private async startAudioCapture(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.start(500); // 500ms chunks
    } catch {
      // Mic not available — browser STT still works, just no Whisper fallback
    }
  }

  private stopAudioCapture(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.mediaRecorder = null;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  /**
   * Get the recorded audio as a Blob for server-side transcription.
   */
  private getAudioBlob(): Blob | null {
    if (this.audioChunks.length === 0) return null;
    return new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
  }

  // ── Command Processing ──

  private serverTranscriptPending = false;
  private browserResult: string | null = null;

  /**
   * Process a voice command from either browser STT or server Whisper.
   * Browser results are fast but less accurate.
   * Server results take 1-2s but handle noise/accents better.
   */
  private async processCommand(transcript: string, source: 'browser' | 'server'): Promise<void> {
    this.stopListening();
    this.setState('processing');

    if (source === 'browser') {
      this.browserResult = transcript;

      // Try to match as a quick command first
      const quickMatch = matchQuickCommand(transcript);
      if (quickMatch) {
        // Execute immediately — no need to wait for server
        await this.executeCommand(quickMatch);
        return;
      }

      // For complex commands, send audio to server for better transcription
      const audioBlob = this.getAudioBlob();
      if (audioBlob && audioBlob.size > 0) {
        this.serverTranscriptPending = true;
        try {
          const serverResult = await this.sendToServer(audioBlob);
          if (serverResult) {
            await this.executeCommand(serverResult);
            return;
          }
        } catch {
          // Server unavailable — use browser result
        }
      }

      // Fall back to parsing browser transcript as complex command
      await this.executeCommand({ action: 'parse', transcript });
    }
  }

  private async sendToServer(audioBlob: Blob): Promise<CommandResult | null> {
    const token = localStorage.getItem('rmpg-token');
    const formData = new FormData();
    formData.append('audio', audioBlob, 'command.webm');

    const res = await fetch('/api/voice/command', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) return null;
    return res.json();
  }

  private async executeCommand(command: CommandResult | { action: string; transcript: string }): Promise<void> {
    this.setState('responding');

    let result: CommandResult;
    if ('success' in command) {
      result = command;
    } else {
      // Parse the transcript into a command on the server
      const token = localStorage.getItem('rmpg-token');
      try {
        const res = await fetch('/api/voice/parse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ transcript: command.transcript }),
        });
        result = res.ok ? await res.json() : { success: false, action: 'unknown', message: 'Command not recognized. Say again.' };
      } catch {
        result = { success: false, action: 'unknown', message: 'Voice command service unavailable.' };
      }
    }

    this.callbacks.onCommandResult(result);

    // Speak confirmation based on user preference
    if (this.config.confirmationMode === 'speak' && result.message) {
      await speak(result.message);
    }

    this.setState('idle');
  }

  // ── Cleanup ──

  destroy(): void {
    this.stopListening();
    clearQueue();
    this.setState('idle');
  }
}

// ─── Quick Command Matching (Client-Side) ────────────────────

interface QuickCommand {
  patterns: RegExp[];
  action: string;
  extractData?: (match: RegExpMatchArray) => Record<string, string>;
}

const QUICK_COMMANDS: QuickCommand[] = [
  // Status updates
  {
    patterns: [/\b(?:show me |go |mark )?en ?route\b/i, /\b10-?76\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'en_route' }),
  },
  {
    patterns: [/\b(?:show me |mark )?on ?scene\b/i, /\b10-?97\b/i, /\barrived?\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'on_scene' }),
  },
  {
    patterns: [/\b(?:show me |mark )?available\b/i, /\b10-?8\b/i, /\bclear(?:ed)?\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'available' }),
  },
  {
    patterns: [/\b(?:show me |go )?out of service\b/i, /\b10-?7\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'out_of_service' }),
  },
  {
    patterns: [/\b(?:show me |go )?on ?break\b/i, /\b10-?10\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'break' }),
  },
  {
    patterns: [/\b(?:show me )?busy\b/i, /\b10-?6\b/i],
    action: 'status_update',
    extractData: () => ({ status: 'busy' }),
  },
  // Acknowledgments
  {
    patterns: [/\bcopy\b/i, /\b10-?4\b/i, /\broger\b/i, /\backnowledge\b/i, /\baffirmative\b/i],
    action: 'acknowledge',
  },
  // Requests
  {
    patterns: [/\brequest(?:ing)? ?backup\b/i, /\bneed(?:s?)? ?backup\b/i],
    action: 'request_backup',
  },
  {
    patterns: [/\brequest(?:ing)? ?(?:e\.?m\.?s\.?|ems|ambulance|medic)\b/i],
    action: 'request_ems',
  },
  {
    patterns: [/\brequest(?:ing)? ?(?:k-?9|canine)\b/i],
    action: 'request_k9',
  },
  // Plate queries
  {
    patterns: [/\brun (?:a )?plate ?([\w ]+)/i],
    action: 'run_plate',
    extractData: (m) => ({ plate: m[1].trim() }),
  },
  // Pursuit
  {
    patterns: [/\bstart(?:ing)? ?pursuit\b/i, /\bin ?pursuit\b/i],
    action: 'start_pursuit',
  },
];

/**
 * Try to match a transcript against known quick commands.
 * Returns a CommandResult if matched, null otherwise.
 */
function matchQuickCommand(transcript: string): CommandResult | null {
  for (const cmd of QUICK_COMMANDS) {
    for (const pattern of cmd.patterns) {
      const match = transcript.match(pattern);
      if (match) {
        const data = cmd.extractData ? cmd.extractData(match) : {};
        return {
          success: true,
          action: cmd.action,
          message: '', // Will be filled by server response
          data,
        };
      }
    }
  }
  return null;
}

export { matchQuickCommand };
```

**Step 2: Commit**

```bash
git add client/src/utils/voiceChannel.ts
git commit -m "feat: add unified voice channel state machine with hybrid STT"
```

---

### Task 5: Command Parser — Client-Side Quick Matching

This is already included in Task 4 (the `matchQuickCommand` function and `QUICK_COMMANDS` array at the bottom of `voiceChannel.ts`). No separate file needed — YAGNI.

---

### Task 6: React Hook for Voice Channel

**Files:**
- Create: `client/src/hooks/useVoiceChannel.ts`

**Step 1: Create the hook**

```typescript
// client/src/hooks/useVoiceChannel.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  VoiceChannel,
  VoiceChannelState,
  isVoiceChannelEnabled,
  type CommandResult,
} from '../utils/voiceChannel';

export interface UseVoiceChannelResult {
  state: VoiceChannelState;
  transcript: string;
  lastCommand: CommandResult | null;
  error: string | null;
  activateManualListen: () => void;
  /** Feed an alert narrative into the voice channel */
  alert: (narrative: string, severity: 'minor' | 'moderate' | 'major') => void;
  enabled: boolean;
}

export function useVoiceChannel(): UseVoiceChannelResult {
  const [state, setState] = useState<VoiceChannelState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled] = useState(() => isVoiceChannelEnabled());

  const channelRef = useRef<VoiceChannel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const channel = new VoiceChannel({
      onStateChange: setState,
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          // Clear transcript after a delay
          setTimeout(() => setTranscript(''), 3000);
        }
      },
      onCommandResult: (result) => {
        setLastCommand(result);
        setError(null);
        // Clear after display
        setTimeout(() => setLastCommand(null), 5000);
      },
      onError: (err) => {
        setError(err);
        setTimeout(() => setError(null), 5000);
      },
    });

    channelRef.current = channel;

    // Keyboard shortcut: V key activates manual listen
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Don't trigger if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if ((e.target as HTMLElement)?.isContentEditable) return;

        e.preventDefault();
        channel.activateManualListen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      channel.destroy();
    };
  }, [enabled]);

  const activateManualListen = useCallback(() => {
    channelRef.current?.activateManualListen();
  }, []);

  const alert = useCallback((narrative: string, severity: 'minor' | 'moderate' | 'major') => {
    channelRef.current?.alert(narrative, severity);
  }, []);

  return { state, transcript, lastCommand, error, activateManualListen, alert, enabled };
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/useVoiceChannel.ts
git commit -m "feat: add useVoiceChannel React hook with V-key shortcut"
```

---

### Task 7: Voice Channel Visual Indicator Component

**Files:**
- Create: `client/src/components/VoiceChannelIndicator.tsx`

**Step 1: Create the indicator component**

```tsx
// client/src/components/VoiceChannelIndicator.tsx
import { useVoiceChannel } from '../hooks/useVoiceChannel';

const STATE_LABELS: Record<string, string> = {
  idle: '',
  alerting: 'ALERT',
  listening: 'LISTENING',
  processing: 'PROCESSING',
  responding: 'RESPONSE',
};

const STATE_COLORS: Record<string, string> = {
  idle: '',
  alerting: 'bg-red-600',
  listening: 'bg-green-600',
  processing: 'bg-yellow-600',
  responding: 'bg-blue-600',
};

export function VoiceChannelIndicator() {
  const { state, transcript, lastCommand, error, activateManualListen, enabled } = useVoiceChannel();

  if (!enabled) return null;
  if (state === 'idle' && !error && !lastCommand) return null;

  return (
    <div className="fixed bottom-8 right-4 z-[9999] flex flex-col items-end gap-1 max-w-sm">
      {/* State badge */}
      {state !== 'idle' && (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${STATE_COLORS[state]} text-white text-xs font-mono uppercase tracking-wider shadow-lg`}>
          {/* Pulsing mic icon for listening state */}
          {state === 'listening' && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-200"></span>
            </span>
          )}
          <span>{STATE_LABELS[state]}</span>
          {state === 'listening' && (
            <span className="text-[10px] opacity-70">Press V or speak</span>
          )}
        </div>
      )}

      {/* Live transcript */}
      {transcript && (
        <div className="bg-[#1a2636] border border-[#2a3a4e] rounded px-3 py-1.5 text-green-400 text-xs font-mono shadow-lg">
          &gt; {transcript}
        </div>
      )}

      {/* Command result */}
      {lastCommand && (
        <div className={`border rounded px-3 py-1.5 text-xs font-mono shadow-lg ${
          lastCommand.success
            ? 'bg-[#1a2636] border-green-600/50 text-green-400'
            : 'bg-[#1a2636] border-red-600/50 text-red-400'
        }`}>
          {lastCommand.message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-[#1a2636] border border-red-600/50 rounded px-3 py-1.5 text-red-400 text-xs font-mono shadow-lg">
          {error}
        </div>
      )}

      {/* Manual activate button (always visible when voice channel enabled) */}
      {state === 'idle' && (
        <button
          onClick={activateManualListen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1a2636] border border-[#2a3a4e] hover:border-[#1a5a9e] text-gray-400 hover:text-white text-xs font-mono transition-colors"
          title="Voice Command (V)"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
          <span>V</span>
        </button>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/VoiceChannelIndicator.tsx
git commit -m "feat: add VoiceChannelIndicator overlay component"
```

---

### Task 8: Server-Side Voice Command Route

**Files:**
- Create: `server/src/routes/voice.ts`

**Step 1: Create the voice command API**

```typescript
// server/src/routes/voice.ts
// ============================================================
// RMPG Flex — Voice Command Processing API
// POST /api/voice/command — Receives audio, transcribes via Whisper, executes command
// POST /api/voice/parse — Receives text transcript, parses and executes command
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate, broadcastUnitUpdate } from '../utils/websocket';
import multer from 'multer';

const router = Router();
router.use(authenticateToken);

// Multer for audio upload (in-memory, max 5MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Rate limit: 10 commands per minute per user
const rateLimits = new Map<number, { count: number; resetAt: number }>();

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// ─── Whisper Transcription ──────────────────────────────

async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/webm' });
  formData.append('file', blob, 'command.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'text');

  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!resp.ok) {
      console.error(`[Voice] Whisper error: ${resp.status}`);
      return null;
    }
    return (await resp.text()).trim();
  } catch (err: any) {
    console.error('[Voice] Whisper transcription failed:', err?.message);
    return null;
  }
}

// ─── Command Parser ─────────────────────────────────────

interface ParsedCommand {
  action: string;
  data: Record<string, any>;
  confirmation?: string;
}

const COMMAND_PATTERNS: Array<{
  patterns: RegExp[];
  action: string;
  extract?: (m: RegExpMatchArray) => Record<string, any>;
}> = [
  // Status updates
  { patterns: [/\b(?:show me |go |mark )?en ?route\b/i, /\b10-?76\b/i], action: 'status_update', extract: () => ({ status: 'en_route' }) },
  { patterns: [/\b(?:show me |mark )?on ?scene\b/i, /\b10-?97\b/i], action: 'status_update', extract: () => ({ status: 'on_scene' }) },
  { patterns: [/\b(?:show me |mark )?available\b/i, /\b10-?8\b/i, /\bclear(?:ed)?\b/i], action: 'status_update', extract: () => ({ status: 'available' }) },
  { patterns: [/\b(?:show me |go )?out of service\b/i, /\b10-?7\b/i], action: 'status_update', extract: () => ({ status: 'out_of_service' }) },
  { patterns: [/\b(?:show me )?busy\b/i, /\b10-?6\b/i], action: 'status_update', extract: () => ({ status: 'busy' }) },
  { patterns: [/\b(?:show me |go )?on ?break\b/i, /\b10-?10\b/i], action: 'status_update', extract: () => ({ status: 'break' }) },
  // Acknowledgments
  { patterns: [/\bcopy\b/i, /\b10-?4\b/i, /\broger\b/i], action: 'acknowledge' },
  // Requests
  { patterns: [/\brequest(?:ing)? ?backup\b/i, /\bneed(?:s?)? ?backup\b/i], action: 'request_backup' },
  { patterns: [/\brequest(?:ing)? ?(?:e\.?m\.?s\.?|ems|ambulance|medic)\b/i], action: 'request_ems' },
  { patterns: [/\brequest(?:ing)? ?(?:k-?9|canine)\b/i], action: 'request_k9' },
  // Queries
  { patterns: [/\brun (?:a )?plate ?([\w ]+)/i], action: 'run_plate', extract: (m) => ({ plate: m[1].trim() }) },
  { patterns: [/\b(?:what(?:'s| is) my )?next call\b/i], action: 'next_call' },
  // Dispatch actions
  { patterns: [/\bstart(?:ing)? ?pursuit\b/i, /\bin ?pursuit\b/i], action: 'start_pursuit' },
  { patterns: [/\bmark evidence (?:at )?(?:my )?(?:location|here)\b/i], action: 'mark_evidence' },
];

function parseCommand(transcript: string): ParsedCommand | null {
  const lower = transcript.toLowerCase().trim();

  for (const cmd of COMMAND_PATTERNS) {
    for (const pattern of cmd.patterns) {
      const match = lower.match(pattern);
      if (match) {
        return {
          action: cmd.action,
          data: cmd.extract ? cmd.extract(match) : {},
        };
      }
    }
  }

  return null;
}

// ─── Command Executors ──────────────────────────────────

async function executeCommand(
  parsed: ParsedCommand,
  userId: number,
  userName: string,
): Promise<{ success: boolean; message: string; data?: any }> {
  const db = getDb();

  switch (parsed.action) {
    case 'status_update': {
      const newStatus = parsed.data.status;
      // Find the user's unit
      const unit = db.prepare(
        `SELECT id, call_sign FROM dispatch_units WHERE officer_user_id = ? AND status != 'off_duty'`
      ).get(userId) as any;

      if (!unit) {
        return { success: false, message: 'You are not assigned to a unit.' };
      }

      db.prepare('UPDATE dispatch_units SET status = ? WHERE id = ?').run(newStatus, unit.id);
      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: newStatus } });
      auditLog({ user: { userId } } as any, 'VOICE_COMMAND', 'dispatch_units', unit.id, null, { status: newStatus });

      const statusName = newStatus.replace(/_/g, ' ');
      return { success: true, message: `Copy, ${unit.call_sign} now showing ${statusName}.` };
    }

    case 'acknowledge': {
      return { success: true, message: 'Acknowledged.' };
    }

    case 'request_backup': {
      const unit = db.prepare(
        `SELECT call_sign, status FROM dispatch_units WHERE officer_user_id = ?`
      ).get(userId) as any;

      const callSign = unit?.call_sign || userName;

      // Get unit's current GPS for location
      const gps = db.prepare(
        `SELECT latitude, longitude, address FROM gps_locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1`
      ).get(userId) as any;

      const location = gps?.address || 'unknown location';

      broadcastDispatchUpdate({
        action: 'backup_request',
        call_sign: callSign,
        location,
        user_name: userName,
      });
      auditLog({ user: { userId } } as any, 'VOICE_COMMAND', 'backup_request', null, null, { call_sign: callSign, location });

      return { success: true, message: `Backup request transmitted for ${callSign} at ${location}.` };
    }

    case 'request_ems': {
      return { success: true, message: 'E.M.S. request transmitted.' };
    }

    case 'request_k9': {
      return { success: true, message: 'K-9 request transmitted.' };
    }

    case 'run_plate': {
      const plate = (parsed.data.plate || '').replace(/\s+/g, '').toUpperCase();
      if (!plate || plate.length < 3) {
        return { success: false, message: 'Could not understand the plate number. Say again.' };
      }

      // Search local vehicle records
      const vehicle = db.prepare(
        `SELECT plate_number, make, model, year, color, owner_name FROM vehicles
         WHERE UPPER(REPLACE(plate_number, ' ', '')) = ?`
      ).get(plate) as any;

      if (vehicle) {
        return {
          success: true,
          message: `Plate ${plate}. Registered to ${vehicle.year || ''} ${vehicle.color || ''} ${vehicle.make || ''} ${vehicle.model || ''}. Owner: ${vehicle.owner_name || 'unknown'}.`,
          data: vehicle,
        };
      }

      return { success: true, message: `Plate ${plate}. No local records found.` };
    }

    case 'next_call': {
      const unit = db.prepare(
        `SELECT id, call_sign, current_call_id FROM dispatch_units WHERE officer_user_id = ?`
      ).get(userId) as any;

      if (!unit) {
        return { success: false, message: 'You are not assigned to a unit.' };
      }

      // Find pending calls assigned to this unit or unassigned P1/P2
      const nextCall = db.prepare(
        `SELECT call_number, incident_type, priority, location_address
         FROM calls_for_service
         WHERE status IN ('pending', 'dispatched') AND archived = 0
         ORDER BY
           CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
           created_at ASC
         LIMIT 1`
      ).get() as any;

      if (!nextCall) {
        return { success: true, message: 'No pending calls in the queue.' };
      }

      const type = (nextCall.incident_type || '').replace(/_/g, ' ');
      return {
        success: true,
        message: `Next call: ${nextCall.call_number}. ${type}. ${nextCall.priority}. At ${nextCall.location_address || 'unknown'}.`,
        data: nextCall,
      };
    }

    case 'start_pursuit': {
      const unit = db.prepare(
        `SELECT call_sign FROM dispatch_units WHERE officer_user_id = ?`
      ).get(userId) as any;
      const callSign = unit?.call_sign || userName;

      broadcastDispatchUpdate({
        action: 'pursuit_started',
        call_sign: callSign,
        user_name: userName,
      });
      auditLog({ user: { userId } } as any, 'VOICE_COMMAND', 'pursuit', null, null, { call_sign: callSign });

      return { success: true, message: `Pursuit logged for ${callSign}. All units notified.` };
    }

    case 'mark_evidence': {
      const gps = db.prepare(
        `SELECT latitude, longitude, address FROM gps_locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1`
      ).get(userId) as any;

      if (!gps) {
        return { success: false, message: 'GPS location not available.' };
      }

      return { success: true, message: `Evidence marker placed at ${gps.address || `${gps.latitude}, ${gps.longitude}`}.` };
    }

    default:
      return { success: false, message: 'Command not recognized. Say again.' };
  }
}

// ─── Routes ─────────────────────────────────────────────

/**
 * POST /api/voice/command
 * Receives audio blob, transcribes via Whisper, parses and executes command.
 */
router.post('/command', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userName = req.user!.username || 'Unknown';

    if (!checkRateLimit(userId)) {
      res.status(429).json({ success: false, action: 'rate_limited', message: 'Too many voice commands. Try again in a minute.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, action: 'error', message: 'No audio provided.' });
      return;
    }

    // Transcribe
    const transcript = await transcribeAudio(req.file.buffer);
    if (!transcript) {
      res.status(200).json({ success: false, action: 'no_speech', message: 'Could not transcribe audio. Say again.' });
      return;
    }

    // Parse
    const parsed = parseCommand(transcript);
    if (!parsed) {
      auditLog(req, 'VOICE_COMMAND_UNKNOWN', 'voice', null, null, { transcript });
      res.json({ success: false, action: 'unknown', message: 'Command not recognized. Say again.', data: { transcript } });
      return;
    }

    // Execute
    const result = await executeCommand(parsed, userId, userName);
    auditLog(req, 'VOICE_COMMAND', 'voice', null, null, { transcript, action: parsed.action, result: result.success });
    res.json({ ...result, action: parsed.action, data: { ...result.data, transcript } });
  } catch (err: any) {
    console.error('[Voice] Command processing error:', err?.message);
    res.status(500).json({ success: false, action: 'error', message: 'Voice command failed.' });
  }
});

/**
 * POST /api/voice/parse
 * Receives text transcript (from browser STT), parses and executes command.
 * No Whisper needed — browser already transcribed.
 */
router.post('/parse', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userName = req.user!.username || 'Unknown';

    if (!checkRateLimit(userId)) {
      res.status(429).json({ success: false, action: 'rate_limited', message: 'Too many voice commands.' });
      return;
    }

    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      res.status(400).json({ success: false, action: 'error', message: 'No transcript provided.' });
      return;
    }

    const parsed = parseCommand(transcript);
    if (!parsed) {
      res.json({ success: false, action: 'unknown', message: 'Command not recognized. Say again.' });
      return;
    }

    const result = await executeCommand(parsed, userId, userName);
    auditLog(req, 'VOICE_COMMAND', 'voice', null, null, { transcript, action: parsed.action, result: result.success });
    res.json({ ...result, action: parsed.action });
  } catch (err: any) {
    console.error('[Voice] Parse error:', err?.message);
    res.status(500).json({ success: false, action: 'error', message: 'Voice command failed.' });
  }
});

export default router;
```

**Step 2: Register the route in server index**

In `server/src/index.ts`, add after the tts route import (around line 42 area):
```typescript
import voiceRoutes from './routes/voice';
```

And in the route registration section (after line 384):
```typescript
app.use('/api/voice', voiceRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/voice.ts server/src/index.ts
git commit -m "feat: add voice command API with Whisper transcription and command execution"
```

---

### Task 9: Mount Voice Channel in Layout

**Files:**
- Modify: `client/src/components/Layout.tsx`

**Step 1: Add VoiceChannelIndicator to Layout**

At top of Layout.tsx, add import:
```typescript
import { VoiceChannelIndicator } from './VoiceChannelIndicator';
```

Inside the Layout return, add the indicator component (after the main content area, before the closing fragment or wrapper div):
```tsx
<VoiceChannelIndicator />
```

**Step 2: Wire voice channel into dispatch alert hook**

The existing `useDispatchVoiceAlerts` in Layout already handles alert announcements. The `VoiceChannelIndicator` internally uses `useVoiceChannel` which creates the voice channel instance. To connect them, we need the voice channel's `alert` method to be called instead of the raw `announceWithSeverity`.

Update `useDispatchVoiceAlerts.ts` to accept an optional `voiceChannel` alert function:

In the hook signature, add:
```typescript
export function useDispatchVoiceAlerts(options?: {
  onAlert?: (alert: AlertBannerItem) => void;
  voiceAlert?: (narrative: string, severity: AlertSeverity) => void;
}): void {
```

Then in each Edge-TTS branch, check for `voiceAlert` first:
```typescript
if (isEdgeTTSEnabled()) {
  const text = composeDispatchNarrative(call);
  if (options?.voiceAlert) {
    options.voiceAlert(text, severity);
  } else {
    announceWithSeverity(text, severity);
  }
}
```

In Layout.tsx, pass the voice channel's alert function:
```tsx
const { alert: voiceAlert } = useVoiceChannel();
useDispatchVoiceAlerts({ onAlert: handleAlert, voiceAlert });
```

**Step 3: Build and verify**

Run: `cd "/Users/rmpgutah/RMPG Flex/client" && npx vite build 2>&1 | tail -10`
Expected: Build success

**Step 4: Commit**

```bash
git add client/src/components/Layout.tsx client/src/hooks/useDispatchVoiceAlerts.ts
git commit -m "feat: mount voice channel in Layout with dispatch alert integration"
```

---

### Task 10: Voice Channel Settings UI

**Files:**
- Modify: `client/src/pages/AdminPage.tsx` (or wherever sound/voice settings live)

**Step 1: Find existing voice settings location**

Search for where `rmpg-voice-alerts` or `rmpg-voice-engine` toggles are rendered in the UI. Add the new voice channel settings nearby:

- **Voice Channel Enabled** toggle (on/off)
- **Listen Mode** dropdown (Auto / Wake Word / Manual Only)
- **Listen Duration** dropdown (3s / 5s / 8s / 10s)
- **Wake Word** text input (default: "Dispatch")
- **Confirmation Mode** dropdown (Speak / Beep / Silent)
- **Alert Detail Level** dropdown (Minimal / Standard / Full Tactical)

Use existing settings patterns (localStorage + optional server sync).

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add voice channel settings to admin/preferences panel"
```

---

### Task 11: Full Integration Test

**Step 1: Start the dev server**

Run: `cd "/Users/rmpgutah/RMPG Flex" && npm run dev`

**Step 2: Test narrative composer**

Open browser console and test:
```javascript
// Import and test narrative composer
import('/src/utils/narrativeComposer.ts').then(m => {
  console.log(m.composeDispatchNarrative({
    call_number: '2024-0847',
    incident_type: 'domestic_disturbance',
    priority: 'P1',
    location_address: '450 South State Street',
    apartment: '204',
    property_name: 'State Street Apartments',
    suspect_description: 'White male, 30s, brown hair, wearing red jacket',
    weapons_involved: 'knife',
    domestic_violence: true,
    injuries_reported: true,
    ems_requested: true,
    assigned_units: ['Unit 3', 'Unit 7'],
    zone: '3',
    beat: '1',
  }));
});
```

Expected output: Full tactical narrative with all fields.

**Step 3: Test voice channel (manual mode)**

1. Press `V` key on any page
2. Verify the listening indicator appears (green pulsing)
3. Say "show me available"
4. Verify the command processes and confirmation speaks

**Step 4: Test via API directly**

```bash
curl -X POST https://localhost:3001/api/voice/parse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"transcript": "show me en route"}'
```

Expected: `{ "success": true, "action": "status_update", "message": "Copy, <call_sign> now showing en route." }`

**Step 5: Commit final**

```bash
git add -A
git commit -m "feat: unified voice channel — complete implementation"
```
