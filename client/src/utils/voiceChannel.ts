// ============================================================
// RMPG Flex — Voice Channel State Machine
//
// Manages the unified alert→listen→process→respond cycle for
// hands-free voice interaction. Supports three listen modes:
//   auto   — mic opens automatically after every alert
//   wake   — mic listens for wake word before activating
//   manual — mic only opens on keybind (V key)
//
// Uses hybrid STT: browser Web Speech API in parallel with
// MediaRecorder capture (WebM/Opus) for server-side Whisper.
//
// This is a plain TypeScript state machine — NOT a React
// component. Wrap with useVoiceChannel hook for React usage.
// ============================================================

import { announceWithSeverity, speak, clearQueue } from './edgeTTS';
import type { AlertSeverity } from './alertSeverity';
import { createStressAnalyzer, type StressResult } from './stressAnalyzer';
import * as conversationMemory from './conversationMemory';
import { resolveReferents } from './referentResolver';
import { getBrainContext, isBrainEnabled } from './dispatcherBrain';
import { renderCallNarrative } from './narrativeRenderer';

// ─── Types ──────────────────────────────────────────────────

export type VoiceChannelState =
  | 'idle'
  | 'alerting'
  | 'listening'
  | 'processing'
  | 'responding';

export type ListenMode = 'auto' | 'wake' | 'manual';

export type ConfirmMode = 'speak' | 'beep' | 'silent';

export interface VoiceChannelConfig {
  listenMode: ListenMode;
  listenDuration: number;       // ms, default 5000
  wakeWord: string;             // default "dispatch"
  confirmMode: ConfirmMode;     // default "speak"
  enabled: boolean;             // master toggle, default false
}

export interface CommandResult {
  success: boolean;
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface VoiceChannelCallbacks {
  onStateChange: (state: VoiceChannelState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onCommandResult: (result: CommandResult) => void;
  onError: (error: string) => void;
  onStressDetected?: (result: StressResult) => void;
}

// ─── localStorage Keys ──────────────────────────────────────

const LS_LISTEN_MODE = 'rmpg-voice-listen-mode';
const LS_LISTEN_DURATION = 'rmpg-voice-listen-duration';
const LS_WAKE_WORD = 'rmpg-voice-wake-word';
const LS_CONFIRM_MODE = 'rmpg-voice-confirm-mode';
const LS_ENABLED = 'rmpg-voice-channel-enabled';

// ─── Config Accessors ───────────────────────────────────────

const DEFAULTS: VoiceChannelConfig = {
  listenMode: 'manual',
  listenDuration: 5000,
  wakeWord: 'dispatch',
  confirmMode: 'speak',
  enabled: false,
};

export function getVoiceChannelConfig(): VoiceChannelConfig {
  try {
    return {
      listenMode: (localStorage.getItem(LS_LISTEN_MODE) as ListenMode) || DEFAULTS.listenMode,
      listenDuration: parseInt(localStorage.getItem(LS_LISTEN_DURATION) || '', 10) || DEFAULTS.listenDuration,
      wakeWord: localStorage.getItem(LS_WAKE_WORD) || DEFAULTS.wakeWord,
      confirmMode: (localStorage.getItem(LS_CONFIRM_MODE) as ConfirmMode) || DEFAULTS.confirmMode,
      enabled: localStorage.getItem(LS_ENABLED) === 'true',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setVoiceChannelConfig(partial: Partial<VoiceChannelConfig>): void {
  try {
    if (partial.listenMode !== undefined) localStorage.setItem(LS_LISTEN_MODE, partial.listenMode);
    if (partial.listenDuration !== undefined) localStorage.setItem(LS_LISTEN_DURATION, String(partial.listenDuration));
    if (partial.wakeWord !== undefined) localStorage.setItem(LS_WAKE_WORD, partial.wakeWord);
    if (partial.confirmMode !== undefined) localStorage.setItem(LS_CONFIRM_MODE, partial.confirmMode);
    if (partial.enabled !== undefined) localStorage.setItem(LS_ENABLED, String(partial.enabled));
  } catch {
    // localStorage unavailable
  }
}

export function isVoiceChannelEnabled(): boolean {
  // Default ON: the V dispatch panel is the primary natural-language
  // surface and should be discoverable to every user. Only an explicit
  // 'false' in localStorage disables it; an unset key returns true.
  try {
    return localStorage.getItem(LS_ENABLED) !== 'false';
  } catch {
    return true;
  }
}

export function setVoiceChannelEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_ENABLED, String(enabled));
  } catch {
    // localStorage unavailable
  }
}

// ─── Quick Command Matching ─────────────────────────────────
//
// Fast client-side regex patterns for common radio commands.
// Returns a CommandResult if matched, or null for server fallback.

interface QuickCommandPattern {
  pattern: RegExp;
  action: string;
  message: string;
  data?: (match: RegExpMatchArray) => Record<string, unknown>;
}

const QUICK_COMMANDS: QuickCommandPattern[] = [
  // ── Status Changes ──
  {
    pattern: /\b(?:en\s*route|10[- ]?76|responding|en route)\b/i,
    action: 'status_change',
    message: 'Status: En Route',
    data: () => ({ status: 'en_route', code: '10-76' }),
  },
  {
    pattern: /\b(?:on\s*scene|10[- ]?97|arrived|on scene)\b/i,
    action: 'status_change',
    message: 'Status: On Scene',
    data: () => ({ status: 'on_scene', code: '10-97' }),
  },
  {
    pattern: /\b(?:available|10[- ]?8|cleared|clear|in service)\b/i,
    action: 'status_change',
    message: 'Status: Available',
    data: () => ({ status: 'available', code: '10-8' }),
  },
  {
    pattern: /\b(?:out\s*of\s*service|10[- ]?7)\b/i,
    action: 'status_change',
    message: 'Status: Out of Service',
    data: () => ({ status: 'out_of_service', code: '10-7' }),
  },
  {
    pattern: /\b(?:on\s*break|10[- ]?10)\b/i,
    action: 'status_change',
    message: 'Status: On Break',
    data: () => ({ status: 'on_break', code: '10-10' }),
  },
  {
    pattern: /\b(?:busy|10[- ]?6)\b/i,
    action: 'status_change',
    message: 'Status: Busy',
    data: () => ({ status: 'busy', code: '10-6' }),
  },

  // ── Acknowledgments ──
  {
    pattern: /\b(?:copy|10[- ]?4|roger|affirmative)\b/i,
    action: 'acknowledge',
    message: 'Acknowledged',
  },

  // ── Requests ──
  {
    pattern: /\b(?:request\s*backup|need\s*backup|send\s*backup)\b/i,
    action: 'request_backup',
    message: 'Backup requested',
  },
  {
    pattern: /\b(?:request\s*(?:ems|ambulance|medic)|need\s*(?:ems|ambulance|medic)|send\s*(?:ems|ambulance|medic))\b/i,
    action: 'request_ems',
    message: 'EMS requested',
  },
  {
    pattern: /\b(?:request\s*(?:k[- ]?9|canine)|need\s*(?:k[- ]?9|canine)|send\s*(?:k[- ]?9|canine))\b/i,
    action: 'request_k9',
    message: 'K-9 unit requested',
  },

  // ── Queries ──
  {
    pattern: /\b(?:run\s*(?:plate|tag|registration))\s+([A-Z0-9]{2,8})\b/i,
    action: 'run_plate',
    message: 'Running plate lookup',
    data: (m) => ({ plate: m[1].toUpperCase() }),
  },
  {
    pattern: /\b(?:what(?:'s| is)\s*my\s*next\s*call|next\s*call)\b/i,
    action: 'next_call',
    message: 'Checking next pending call',
  },

  // ── Dispatch Actions ──
  {
    pattern: /\b(?:start\s*pursuit|in\s*pursuit|vehicle\s*pursuit)\b/i,
    action: 'start_pursuit',
    message: 'Pursuit initiated',
  },
  {
    pattern: /\b(?:mark\s*evidence|evidence\s*(?:at|here)|tag\s*evidence)\b/i,
    action: 'mark_evidence',
    message: 'Evidence marked at current location',
  },

  // ── Situation Awareness ──
  {
    pattern: /\b(?:sitrep|sit\s*rep|situation\s*report|status\s*report)\b/i,
    action: 'sitrep',
    message: 'Generating situation report',
  },
  {
    pattern: /\b(?:area\s*check|area\s*scan)\b/i,
    action: 'area_check',
    message: 'Checking area activity',
  },

  // ── Emergency — DISABLED ──
  // Voice-driven panic alarms produced phantom triggers in normal radio
  // traffic (the dispatcher saying "panic alarm just came in", training
  // discussions, TTS playback re-entering the mic). Panic must fire only
  // from a deliberate manual press of the PanicButton.
  // {
  //   pattern: /\b(?:officer\s*down|shots?\s*fired|10[- ]?99|panic|emergency\s*traffic)\b/i,
  //   action: 'officer_down',
  //   message: 'EMERGENCY — Officer down broadcast transmitted',
  // },

  // ── Conversational queries (Phase 4) ──
  // After the resolver rewrites "that call" -> "call CN-26-0457",
  // these patterns consume the explicit reference. They match the
  // resolver's output format exactly ("call <call_number>"), so a
  // raw "tell me about that call" becomes "tell me about call
  // CN-26-0457" and matches here.
  {
    pattern: /\b(?:tell me (?:more )?about|describe|what(?:'s| is) the status of)\s+call\s+([A-Za-z0-9-]+)/i,
    action: 'describe_call',
    message: 'Describing call',
    data: (m) => ({ call_number: m[1] }),
  },
  {
    pattern: /\bwho(?:'s| is)?\s+(?:assigned|on)(?:\s+to)?\s+call\s+([A-Za-z0-9-]+)/i,
    action: 'who_is_assigned',
    message: 'Checking assigned units',
    data: (m) => ({ call_number: m[1] }),
  },
];

/**
 * Match a transcript against quick command patterns.
 * Returns a CommandResult if matched, or null for server fallback.
 */
export function matchQuickCommand(transcript: string): CommandResult | null {
  const text = transcript.trim();
  if (!text) return null;

  for (const cmd of QUICK_COMMANDS) {
    const match = text.match(cmd.pattern);
    if (match) {
      return {
        success: true,
        action: cmd.action,
        message: cmd.message,
        data: cmd.data ? cmd.data(match) : undefined,
      };
    }
  }
  return null;
}

// ─── Audio Helpers ──────────────────────────────────────────

/** Play a short "roger" beep — 1200Hz for 80ms. */
function playRogerBeep(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 1200;
      gain.gain.value = 0.15;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
      osc.onended = () => {
        ctx.close().catch(() => {});
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

/** Small delay utility. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Server API Helpers ─────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('rmpg_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Send recorded audio to the server for Whisper transcription + command parsing.
 * Endpoint: POST /api/voice/command
 */
async function sendAudioToServer(audioBlob: Blob): Promise<CommandResult> {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'voice-command.webm');

    const res = await fetch('/api/voice/command', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { success: false, action: 'error', message: 'Voice command endpoint not available yet' };
      }
      return { success: false, action: 'error', message: `Server error: ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    return { success: false, action: 'error', message: 'Failed to reach voice command server' };
  }
}

/**
 * Send transcript text to the dialogue agent. Primary path for natural-language
 * voice: the agent plans + executes actions and returns a synthesized reply
 * along with a voice_mode the TTS layer should use.
 *
 * Endpoint: POST /api/voice/dialogue
 *
 * source='announcer' is for terminal-triggered target announcers (Spillman flat
 * voice + classic chime). source='speech' is for free-form officer speech to
 * dispatch (conversational human voice). Defaults to 'speech'.
 */
export async function sendDialogueToServer(
  text: string,
  source: 'announcer' | 'speech' = 'speech',
): Promise<CommandResult & { voice_mode?: 'spillman_flat' | 'conversational'; pending_followup?: { kind: string; prompt: string } | null }> {
  try {
    const res = await fetch('/api/voice/dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ transcript: text, source }),
    });

    if (!res.ok) {
      // 404 = endpoint not deployed yet; let caller fall back to /parse.
      return { success: false, action: 'error', message: '' };
    }

    const data = await res.json();
    return {
      success: true,
      action: 'dialogue',
      message: data.reply || '',
      data: { actions: data.actions, off_topic: data.off_topic, latency_ms: data.latency_ms },
      voice_mode: data.voice_mode,
      pending_followup: data.pending_followup,
    };
  } catch {
    return { success: false, action: 'error', message: '' };
  }
}

/**
 * Send transcript text to the legacy regex/NLU parser.
 * Endpoint: POST /api/voice/parse
 */
async function sendTextToServer(text: string): Promise<CommandResult> {
  try {
    const res = await fetch('/api/voice/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { success: false, action: 'error', message: 'Voice parse endpoint not available yet' };
      }
      return { success: false, action: 'error', message: `Server error: ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    return { success: false, action: 'error', message: 'Failed to reach voice parse server' };
  }
}

// ─── Voice Channel Class ────────────────────────────────────

/**
 * VoiceChannel — unified voice channel state machine.
 *
 * States: idle → alerting → listening → processing → responding → idle
 *                               ↓
 *                           timeout → idle
 */
export class VoiceChannel {
  private state: VoiceChannelState = 'idle';
  private config: VoiceChannelConfig;
  private callbacks: VoiceChannelCallbacks;

  // Listening infrastructure
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recognition: InstanceType<NonNullable<typeof window.SpeechRecognition>> | null = null;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  // Radio PTT cross-integration
  private radioActive = false;
  // Push-to-talk hold mode: when true, the auto-listen window timer is
  // suppressed and the mic stays open until endHoldToTalk() fires.
  private holdMode = false;
  // Drive mode (Option A): when active, the channel re-opens the mic
  // automatically after each dialogue reply for continuous turn-taking
  // — "who's nearest?" → reply → "send them my 20" with no second hold.
  private driveMode = false;
  // Stand-by filler timer (C): scheduled in processTranscript, cleared
  // when respond() fires the real reply. Never both — TTS queue would
  // serialize anyway, but cancelling early avoids wasted Edge-TTS calls.
  private standbyFillerTimer: ReturnType<typeof setTimeout> | null = null;

  // Barge-in watcher (B): keeps a separate mic stream open while dispatch
  // TTS is playing. Watches RMS volume; if sustained loud audio is
  // detected for ≥600ms, aborts the TTS queue and starts a fresh listen.
  // Independent from the main mic capture so it doesn't fight the active
  // SpeechRecognition session, and uses echoCancellation + a high
  // threshold to reject TTS bleeding back through the speakers.
  private bargeInStream: MediaStream | null = null;
  private bargeInAudioContext: AudioContext | null = null;
  private bargeInRafId: number | null = null;
  private bargeInAboveSinceMs: number | null = null;
  // Set by fireBargeIn so respond()'s tail logic short-circuits — the
  // mic is already reopened and we don't want to override that state.
  private bargedIn = false;

  // Track the latest transcript from Web Speech API
  private lastTranscript = '';
  private hasSpeechDetected = false;

  // Pending alert that should preempt listening
  private pendingAlert: { narrative: string; severity: AlertSeverity } | null = null;

  // Stress analysis
  private stressAnalyzer: ReturnType<typeof createStressAnalyzer> | null = null;
  private stressAudioContext: AudioContext | null = null;

  constructor(callbacks: VoiceChannelCallbacks) {
    this.callbacks = callbacks;
    this.config = getVoiceChannelConfig();
  }

  // ─── Public API ─────────────────────────────────────────

  getState(): VoiceChannelState {
    return this.state;
  }

  refreshConfig(): void {
    this.config = getVoiceChannelConfig();
  }

  /** Call when radio PTT starts or ends on any channel */
  setRadioActive(active: boolean): void {
    this.radioActive = active;
    if (active && this.state === 'listening') {
      // Pause listen timer — don't timeout while radio is busy
      this.clearListenTimer();
    } else if (!active && this.state === 'listening') {
      // Resume listen timer
      this.resetListenTimer();
    }
  }

  isRadioBusy(): boolean {
    return this.radioActive;
  }

  /**
   * Trigger an alert announcement. If currently listening,
   * major alerts preempt the listen window.
   */
  async alert(narrative: string, severity: AlertSeverity): Promise<void> {
    if (this.destroyed) return;

    // Alert preemption: major alert during listening cancels listen window
    if (this.state === 'listening' && severity === 'major') {
      this.stopListening();
    }

    // If already alerting, queue via pendingAlert (major overrides)
    if (this.state === 'alerting') {
      if (severity === 'major') {
        clearQueue();
        this.pendingAlert = { narrative, severity };
      }
      return;
    }

    // If we're processing or responding, save for later
    if (this.state === 'processing' || this.state === 'responding') {
      this.pendingAlert = { narrative, severity };
      return;
    }

    await this.runAlert(narrative, severity);
  }

  /**
   * Push-to-talk: open the mic and KEEP it open until endHoldToTalk()
   * is called. Bypasses the auto-listen timer entirely. Used by the
   * V-button hold gesture and the V-key keydown→keyup pattern.
   */
  async startHoldToTalk(): Promise<void> {
    if (this.destroyed) return;
    if (!this.config.enabled) return;
    if (this.state === 'alerting') return;
    if (this.state === 'processing' || this.state === 'responding') return;
    if (this.state === 'listening') {
      // Already listening from a tap — convert to hold mode (cancel auto-end timer).
      this.clearListenTimer();
      this.holdMode = true;
      return;
    }
    this.holdMode = true;
    await this.startListening();
    // startListening() sets a normal listen-window timer; cancel it for hold mode.
    this.clearListenTimer();
  }

  /**
   * End the push-to-talk hold and process whatever was captured.
   * Safe to call when not in hold mode (no-op).
   */
  endHoldToTalk(): void {
    if (!this.holdMode) return;
    this.holdMode = false;
    if (this.state !== 'listening') return;
    void this.processTranscript();
  }

  // ─── Barge-in watcher (B) ────────────────────────────────
  // Listen to the mic in parallel with TTS playback. When the officer
  // speaks loudly enough for long enough, abort the reply and reopen
  // the listen window — like real radio half-duplex with PTT priority,
  // but driven by voice activity rather than a key.
  //
  // Tunables (TODO(chris): tunable after a real cab test):
  //   THRESHOLD: RMS amplitude (0..1) above which we count "speech".
  //              Higher = more TTS bleed-through tolerance, less sensitive.
  //   SUSTAIN_MS: how long the volume must stay above threshold to fire.
  //              Longer = fewer false-positives from coughs/road noise.
  private async startBargeInWatcher(): Promise<void> {
    if (this.bargeInStream) return;       // already running
    if (this.destroyed) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    const THRESHOLD = 0.06;     // RMS amplitude (0..1)
    const SUSTAIN_MS = 600;     // continuous time above threshold to trigger

    try {
      this.bargeInStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,    // critical — rejects TTS bleed-through
          noiseSuppression: true,
          autoGainControl: false,    // AGC would amplify silence — keep off
        },
      });
    } catch {
      // User denied permission, mic in use, etc. — barge-in unavailable; not fatal.
      this.bargeInStream = null;
      return;
    }

    if (this.destroyed || this.state !== 'responding') {
      // Race: state changed while we awaited getUserMedia
      this.bargeInStream.getTracks().forEach((t) => t.stop());
      this.bargeInStream = null;
      return;
    }

    const AudioCtxCtor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.bargeInAudioContext = new AudioCtxCtor();
    const source = this.bargeInAudioContext.createMediaStreamSource(this.bargeInStream);
    const analyser = this.bargeInAudioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    this.bargeInAboveSinceMs = null;

    const tick = () => {
      if (this.destroyed) return;
      if (this.state !== 'responding') return;
      analyser.getFloatTimeDomainData(buf);

      // Compute RMS volume — root-mean-square over the time-domain buffer.
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
      const rms = Math.sqrt(sumSq / buf.length);

      const now = Date.now();
      if (rms >= THRESHOLD) {
        if (this.bargeInAboveSinceMs == null) this.bargeInAboveSinceMs = now;
        if (now - this.bargeInAboveSinceMs >= SUSTAIN_MS) {
          // Sustained speech detected — barge in.
          this.fireBargeIn();
          return;
        }
      } else {
        this.bargeInAboveSinceMs = null;
      }

      this.bargeInRafId = requestAnimationFrame(tick);
    };
    this.bargeInRafId = requestAnimationFrame(tick);
  }

  private stopBargeInWatcher(): void {
    if (this.bargeInRafId != null) {
      cancelAnimationFrame(this.bargeInRafId);
      this.bargeInRafId = null;
    }
    if (this.bargeInStream) {
      this.bargeInStream.getTracks().forEach((t) => t.stop());
      this.bargeInStream = null;
    }
    if (this.bargeInAudioContext) {
      this.bargeInAudioContext.close().catch(() => { /* ignore */ });
      this.bargeInAudioContext = null;
    }
    this.bargeInAboveSinceMs = null;
  }

  private fireBargeIn(): void {
    // Abort the TTS queue — current playback stops, queued items drop.
    this.bargedIn = true;
    try { clearQueue(); } catch { /* ignore */ }
    this.stopBargeInWatcher();
    if (this.destroyed) return;
    // Reopen the mic for the officer to speak. setState('idle') first
    // so activateManualListen's guards pass.
    this.setState('idle');
    void this.activateManualListen();
  }

  /**
   * Submit a typed transcript directly to the dialogue pipeline.
   * Skips the mic / STT path entirely — used by the text-input box
   * in the enveloped voice panel for environments where speech is
   * unavailable (noisy, mic broken, dispatcher prefers typing).
   */
  async submitText(text: string): Promise<void> {
    if (this.destroyed) return;
    if (!this.config.enabled) return;
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    if (this.state === 'alerting' || this.state === 'processing' || this.state === 'responding') {
      return;
    }
    // Stop any active listen — the typed text supersedes mic input.
    if (this.state === 'listening') this.stopListening();

    // Mirror the transcript into the channel state so the UI shows it.
    this.lastTranscript = trimmed;
    this.audioChunks = [];
    this.callbacks.onTranscript(trimmed, true);
    await this.processTranscript();
  }

  /**
   * Manually activate the listen window (e.g., from V keybind).
   * Works regardless of listenMode setting.
   */
  async activateManualListen(): Promise<void> {
    if (this.destroyed) return;
    if (!this.config.enabled) return;

    // Can activate from idle or override from any non-alerting state
    if (this.state === 'alerting') return;

    // If already listening, extend the timer
    if (this.state === 'listening') {
      this.resetListenTimer();
      return;
    }

    // If processing/responding, skip — they'll complete first
    if (this.state === 'processing' || this.state === 'responding') return;

    await this.startListening();
  }

  /**
   * Clean up all resources. Call when unmounting.
   */
  destroy(): void {
    this.destroyed = true;
    this.stopListening();
    this.clearListenTimer();
    if (this.standbyFillerTimer) {
      clearTimeout(this.standbyFillerTimer);
      this.standbyFillerTimer = null;
    }
    this.stopBargeInWatcher();
    // Clean up stress analyzer
    this.stressAnalyzer?.disconnect();
    this.stressAnalyzer = null;
    if (this.stressAudioContext) {
      this.stressAudioContext.close().catch(() => {});
      this.stressAudioContext = null;
    }
    this.setState('idle');
  }

  // ─── Internal State Machine ─────────────────────────────

  private setState(next: VoiceChannelState): void {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange(next);
  }

  private async runAlert(narrative: string, severity: AlertSeverity): Promise<void> {
    this.setState('alerting');

    // If radio is active, wait up to 10s for it to clear before speaking
    if (this.radioActive) {
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          if (!this.radioActive) { clearInterval(check); resolve(); }
        }, 500);
        setTimeout(() => { clearInterval(check); resolve(); }, 10_000);
      });
    }

    try {
      await announceWithSeverity(narrative, severity);
    } catch {
      // TTS failed — still transition
    }

    if (this.destroyed) return;

    // Check for preempted alert
    if (this.pendingAlert) {
      const next = this.pendingAlert;
      this.pendingAlert = null;
      await this.runAlert(next.narrative, next.severity);
      return;
    }

    // After alert, determine whether to open mic
    const shouldListen = this.config.listenMode === 'auto';

    if (shouldListen) {
      await this.startListening();
    } else {
      this.setState('idle');
    }
  }

  // ─── Listening ──────────────────────────────────────────

  private async startListening(): Promise<void> {
    this.setState('listening');
    this.lastTranscript = '';
    this.hasSpeechDetected = false;
    this.audioChunks = [];

    // Play roger beep to indicate mic is open
    await playRogerBeep();
    await delay(100);

    if (this.destroyed || this.state !== 'listening') return;

    // Start mic capture
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.callbacks.onError('Microphone access denied or unavailable');
      this.setState('idle');
      return;
    }

    if (this.destroyed || this.state !== 'listening') {
      this.releaseMediaStream();
      return;
    }

    // MediaRecorder for server-side Whisper (WebM/Opus, 500ms chunks)
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };
      this.mediaRecorder.start(500); // 500ms chunks
    } catch (err) {
      // MediaRecorder not available — fall back to Web Speech API only
      console.warn('MediaRecorder unavailable, using Web Speech API only');
    }

    // Start stress analysis on the mic stream
    try {
      this.stressAudioContext = new AudioContext();
      const source = this.stressAudioContext.createMediaStreamSource(this.mediaStream!);
      this.stressAnalyzer = createStressAnalyzer(this.stressAudioContext);
      this.stressAnalyzer.connectSource(source);
    } catch { /* stress analysis non-critical */ }

    // Web Speech API for parallel real-time transcription
    this.startWebSpeechRecognition();

    // Start listen timeout
    this.resetListenTimer();
  }

  private startWebSpeechRecognition(): void {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      // Browser doesn't support Web Speech API — rely on server Whisper
      return;
    }

    try {
      this.recognition = new SpeechRecognitionCtor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (this.state !== 'listening') return;

        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }

        if (final) {
          this.hasSpeechDetected = true;
          this.lastTranscript = final.trim();
          this.callbacks.onTranscript(this.lastTranscript, true);

          // Wake word mode: check if transcript starts with wake word
          if (this.config.listenMode === 'wake') {
            const wakeWordLower = this.config.wakeWord.toLowerCase();
            if (!this.lastTranscript.toLowerCase().startsWith(wakeWordLower)) {
              // Not a wake-word-activated command — ignore
              return;
            }
            // Strip wake word from command
            this.lastTranscript = this.lastTranscript.slice(this.config.wakeWord.length).trim();
          }

          // We got a final transcript — proceed to processing
          this.clearListenTimer();
          this.processTranscript();
        } else if (interim) {
          this.hasSpeechDetected = true;
          this.callbacks.onTranscript(interim, false);
          // Reset timer — user is still speaking
          this.resetListenTimer();
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // 'no-speech' is normal timeout — not an error
        if (event.error === 'no-speech') return;
        if (event.error === 'aborted') return;
        console.warn('SpeechRecognition error:', event.error);
      };

      this.recognition.onend = () => {
        // If we're still in listening state, restart recognition
        if (this.state === 'listening' && !this.destroyed) {
          try {
            this.recognition?.start();
          } catch {
            // Already started or destroyed
          }
        }
      };

      this.recognition.start();
    } catch (err) {
      console.warn('Failed to start SpeechRecognition:', err);
    }
  }

  private resetListenTimer(): void {
    this.clearListenTimer();
    this.listenTimer = setTimeout(() => {
      if (this.state === 'listening') {
        this.handleListenTimeout();
      }
    }, this.config.listenDuration);
  }

  private clearListenTimer(): void {
    if (this.listenTimer) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
  }

  private handleListenTimeout(): void {
    if (this.hasSpeechDetected && this.lastTranscript) {
      // User was speaking — process what we have
      this.processTranscript();
    } else {
      // No speech detected — return to idle
      this.stopListening();
      this.setState('idle');
    }
  }

  private stopListening(): void {
    this.clearListenTimer();

    // Stop Web Speech API
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* already stopped */ }
      this.recognition = null;
    }

    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* already stopped */ }
    }
    this.mediaRecorder = null;

    // Release mic
    this.releaseMediaStream();
  }

  private releaseMediaStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  // ─── Processing ─────────────────────────────────────────

  private async processTranscript(): Promise<void> {
    const transcript = this.lastTranscript;
    const audioBlob = this.audioChunks.length > 0
      ? new Blob(this.audioChunks, { type: 'audio/webm' })
      : null;

    // Stop listening hardware
    this.stopListening();
    this.setState('processing');

    // ── C: Stand-by filler ──
    // If the dialogue agent takes longer than 1200ms (slow LLM, retry,
    // network hiccup), speak a brief "Stand by." so the officer hears
    // *something* and knows the system is working — fills the silence
    // with warmth instead of dead air. Cleared by respond() before its
    // own speak() fires, so the filler doesn't queue ahead of the real
    // reply if the agent comes back fast. The TTS queue serializes if
    // it does fire, so there's never overlap.
    this.standbyFillerTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (this.state !== 'processing') return;
      // Use the same TTS pipeline as replies — uses confirmMode='speak'
      // gating, voice persona, P25 chirp, etc. Silent if user has muted.
      if (this.config.confirmMode === 'speak') {
        // force=true: same rationale as the main reply — fillers are
        // intentional dialogue feedback, not passive alerts.
        speak('Stand by.', undefined, 'conversational', true).catch(() => { /* best-effort */ });
      }
    }, 1200);

    if (this.destroyed) return;

    // Check stress level from audio analysis
    const stress = this.stressAnalyzer?.getResult();
    if (stress?.isStressed && this.callbacks.onStressDetected) {
      this.callbacks.onStressDetected(stress);
    }

    // Add officer entry to conversation memory
    conversationMemory.addEntry({ role: 'officer', text: transcript });

    // Check for pending confirmation in conversation memory
    const pending = conversationMemory.getPendingConfirmation();
    if (pending && transcript) {
      if (conversationMemory.isConfirmation(transcript)) {
        // Re-send the pending action as confirmed
        // Fall through to normal processing with the original pending text
      } else if (conversationMemory.isDenial(transcript)) {
        conversationMemory.clearMemory();
        const cancelResult: CommandResult = { success: true, action: 'cancelled', message: 'Cancelled.' };
        this.callbacks.onCommandResult(cancelResult);
        await this.respond(cancelResult);
        return;
      }
    }

    // ── Phase 4: Referent resolver + conversational queries ──
    // When the Dispatcher Brain is enabled, rewrite pronouns/deictics
    // before pattern matching so "tell me about that call" becomes
    // "tell me about call CN-26-0457". If the resolver flags ambiguity
    // (e.g. "that call" with no prior context), short-circuit into a
    // clarification turn rather than falling through to server NLU.
    let effectiveTranscript = transcript;
    if (isBrainEnabled() && transcript) {
      const resolved = resolveReferents(transcript, getBrainContext());
      if (resolved.ambiguous) {
        const slotLabel = resolved.ambiguousSlot ?? 'that';
        const clarify: CommandResult = {
          success: false,
          action: 'clarify',
          message: `Which ${slotLabel} did you mean?`,
          data: { slot: slotLabel },
        };
        conversationMemory.addEntry({ role: 'system', text: clarify.message, action: clarify.action });
        this.callbacks.onCommandResult(clarify);
        await this.respond(clarify);
        return;
      }
      effectiveTranscript = resolved.text;
    }

    // 1. Try quick command match first (instant, client-side)
    let result = matchQuickCommand(effectiveTranscript);

    // Handle conversational queries locally — compose from BrainContext
    // rather than round-tripping through server NLU.
    if (result && (result.action === 'describe_call' || result.action === 'who_is_assigned')) {
      const ctx = getBrainContext();
      const call = ctx.lastCall;
      if (!call) {
        result = {
          success: false,
          action: 'clarify',
          message: 'Which call did you mean?',
          data: { slot: 'call' },
        };
      } else if (result.action === 'describe_call') {
        const spoken = renderCallNarrative(
          {
            call_number: call.call_number,
            location_address: call.location,
            incident_type: call.type,
          },
          'narrative',
        );
        result = { success: true, action: 'describe_call', message: spoken, data: { call_number: call.call_number } };
      } else if (result.action === 'who_is_assigned') {
        // BrainContext doesn't track assigned_units directly, but we do
        // track lastUnit — a best-effort response for Phase 4.
        const unit = ctx.lastUnit?.call_sign;
        result = unit
          ? { success: true, action: 'who_is_assigned', message: `${unit} is assigned to call ${call.call_number}.`, data: { call_number: call.call_number, unit } }
          : { success: true, action: 'who_is_assigned', message: `No units assigned to call ${call.call_number}.`, data: { call_number: call.call_number } };
      }
    }

    if (!result) {
      // 2. Try the natural-language dialogue agent first — handles free-form
      // questions, 10-codes with mileage prompts, and tool-calling.
      if (effectiveTranscript) {
        const dlg = await sendDialogueToServer(effectiveTranscript, 'speech');
        if (dlg.success && dlg.message) {
          result = dlg;
        }
      }

      // 3. Legacy regex/NLU parser fallback (if dialogue endpoint missing or empty)
      if ((!result || !result.success) && effectiveTranscript) {
        result = await sendTextToServer(effectiveTranscript);
      }

      // 4. If text path failed and we have audio, try audio endpoint
      if ((!result || !result.success) && audioBlob && audioBlob.size > 1000) {
        const audioResult = await sendAudioToServer(audioBlob);
        if (audioResult.success) {
          result = audioResult;
        }
      }
    }

    if (this.destroyed) return;

    // Default result if nothing worked
    if (!result) {
      result = {
        success: false,
        action: 'unrecognized',
        message: transcript
          ? `Unrecognized command: "${transcript}"`
          : 'No speech detected',
      };
    }

    // Record system response in conversation memory
    conversationMemory.addEntry({ role: 'system', text: result.message, action: result.action });

    this.callbacks.onCommandResult(result);
    await this.respond(result);
  }

  // ─── Responding ─────────────────────────────────────────

  private async respond(result: CommandResult): Promise<void> {
    if (this.destroyed) return;
    // Cancel the "stand by" filler — the real reply is about to play.
    if (this.standbyFillerTimer) {
      clearTimeout(this.standbyFillerTimer);
      this.standbyFillerTimer = null;
    }
    this.bargedIn = false;
    this.setState('responding');

    // Dialogue agent results carry a voice_mode hint:
    //   spillman_flat → terminal announcer voice + classic 2-tone chime
    //   conversational → human dispatcher voice + P25 trunked chirp
    const voiceMode: 'spillman_flat' | 'conversational' =
      (result as any).voice_mode === 'spillman_flat' ? 'spillman_flat' : 'conversational';

    // ── B: Barge-in watcher ──
    // Spin up a parallel mic listener so the officer can interrupt this
    // reply by speaking. Only meaningful when we're actually playing
    // speech (confirmMode === 'speak'). Skipped in silent/beep modes.
    if (this.config.confirmMode === 'speak') {
      void this.startBargeInWatcher();
    }

    try {
      switch (this.config.confirmMode) {
        case 'speak':
          // force=true: dialogue replies bypass the global voice-alerts
          // master mute. Typed AND spoken inputs both receive audible
          // feedback when confirmMode is 'speak'. Mute via the panel
          // 🔊/🔇 toggle, not via the global alerts switch.
          await speak(result.message, undefined, voiceMode, true);
          break;
        case 'beep':
          await playRogerBeep();
          break;
        case 'silent':
          // No audio confirmation
          break;
      }
    } catch {
      // Confirmation audio failed — not critical
    } finally {
      // Always tear down the barge-in watcher when speech ends naturally.
      // If barge-in fired, this is a no-op (already stopped).
      this.stopBargeInWatcher();
    }

    if (this.destroyed) return;
    // If barge-in fired, fireBargeIn already reopened the mic — don't
    // step on it with the auto-loop or pending-alert tail below.
    if (this.bargedIn) {
      this.bargedIn = false;
      return;
    }

    // Check for pending alert
    if (this.pendingAlert) {
      const next = this.pendingAlert;
      this.pendingAlert = null;
      await this.runAlert(next.narrative, next.severity);
      return;
    }

    // ── Drive-mode auto-loop ──
    // When the officer is moving in a vehicle, re-open the mic right
    // after a reply so the conversation can flow without another hold
    // gesture. Skipped if the radio is currently keyed (avoid catching
    // unrelated radio traffic) or hold-mode is engaged on the V button.
    if (this.driveMode && !this.radioActive && !this.holdMode) {
      this.setState('idle');
      // Defer to next tick so the responding state finalizes cleanly
      // before the listen path tears down/spins up the mic.
      setTimeout(() => {
        if (this.destroyed) return;
        if (this.state !== 'idle') return;
        void this.activateManualListen();
      }, 50);
      return;
    }

    this.setState('idle');
  }

  /**
   * Tell the channel whether the officer is currently driving.
   * Drives the auto-loop behavior in respond() and is read by the
   * indicator UI to morph the V pill / hold-to-open threshold.
   */
  setDriveMode(active: boolean): void {
    this.driveMode = active;
  }

  /** Read the channel's current drive-mode flag. */
  isDriveMode(): boolean {
    return this.driveMode;
  }
}

// ─── Terminal Target Announcer ──────────────────────────────
//
// Public helper for any UI that performs a target lookup from the CAD
// terminal (plate query, name search, person dossier, beat lookup, etc.)
// and wants the result spoken back in the Spillman flat voice with the
// classic CAD chime — distinct from the conversational voice used when
// an officer talks to dispatch over the radio.
//
// Usage from a search result handler:
//   import { announceTarget } from '../utils/voiceChannel';
//   await announceTarget(`run plate ${plate}`);
//
// The transcript is sent to /api/voice/dialogue with source='announcer',
// the agent fetches live data via the appropriate tool, the synthesized
// reply comes back with voice_mode='spillman_flat', and the chime + flat
// voice render automatically.

/** Announce a target lookup via the dialogue agent in Spillman flat voice. */
export async function announceTarget(transcript: string): Promise<{
  reply: string;
  voice_mode: 'spillman_flat' | 'conversational';
} | null> {
  if (!transcript || !transcript.trim()) return null;
  const result = await sendDialogueToServer(transcript.trim(), 'announcer');
  if (!result.success || !result.message) return null;

  const voiceMode = result.voice_mode === 'conversational' ? 'conversational' : 'spillman_flat';
  try {
    await speak(result.message, undefined, voiceMode);
  } catch {
    /* TTS failed — caller still gets the text reply for a screen render */
  }
  return { reply: result.message, voice_mode: voiceMode };
}
