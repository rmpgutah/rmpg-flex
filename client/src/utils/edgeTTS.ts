// ============================================================
// RMPG Flex — Edge-TTS Client Audio Player
//
// Fetches neural TTS audio from the server's /api/tts endpoint and
// processes it through a P25 Motorola APX-style chain:
//   - 800Hz triple-chirp talk-permit on key-up
//   - IMBE/AMBE-style bandpass (300-3400Hz) + 1.8kHz metallic presence
//   - 12-bit bitcrusher for codec quantization color
//   - Near-silent noise floor (digital, not analog hiss)
//   - Short band-limited squelch-tail burst on un-key
// Manages a priority queue where major alerts interrupt lower ones.
//
// Falls back to browser SpeechSynthesis if the server is unreachable.
// ============================================================

import { playToneAsync } from './dispatchTones';
import type { AlertSeverity } from './alertSeverity';
import { getToneForSeverity, shouldPlayAudio } from './alertSeverity';
import type { ToneType } from './dispatchTones';
import { ensureRadioWorklets, buildRadioVoiceChain, createRadioNoiseBed } from './radioProcessor';

// ─── Types ──────────────────────────────────────────────────

export type VoiceMode = 'conversational' | 'spillman_flat';

interface QueueEntry {
  text: string;
  severity: AlertSeverity;
  urgent: boolean;
  voiceMode: VoiceMode;
  resolve: () => void;
}

// ─── State ──────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
const queue: QueueEntry[] = [];
let processing = false;
let currentSource: AudioBufferSourceNode | null = null;

// Preferred female voices for SpeechSynthesis fallback
const PREFERRED_VOICES = ['Samantha', 'Karen', 'Zira', 'Jenny'];

// ─── Persona payload helper (Task 1.4) ──────────────────────
// Reads voice persona from localStorage (written by useVoicePersona.ts)
// and produces the server-facing payload with rate/pitch already
// formatted as Edge-TTS strings. Urgent adds a fixed boost
// (+10% rate, +5Hz pitch) on top of the persona baseline.

export interface EdgeTTSPayload {
  text: string;
  urgent: boolean;
  voice: string;
  rate: string;   // e.g. '+10%', '-5%'
  pitch: string;  // e.g. '+5Hz', '-10Hz'
}

function safeNum(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getEdgeTTSPayload(
  text: string,
  urgent: boolean = false,
  voiceMode: VoiceMode = 'conversational',
): EdgeTTSPayload {
  // Spillman flat = clipped CAD-terminal voice. Use a more neutral male
  // voice at slightly faster rate with flat pitch — mimics the Motorola
  // Premier CAD announcer cadence. Conversational uses the user's persona.
  const voice = voiceMode === 'spillman_flat'
    ? (localStorage.getItem('rmpg-voice-spillman') || 'en-US-GuyNeural')
    : (localStorage.getItem('rmpg-voice-persona') || 'en-US-JennyNeural');
  const rateNum = safeNum(localStorage.getItem('rmpg-voice-rate'), 1.0);
  const pitchNum = safeNum(localStorage.getItem('rmpg-voice-pitch'), 0);

  let ratePct = Math.round((rateNum - 1) * 100);
  let pitchHz = Math.round(pitchNum);
  if (urgent) {
    ratePct += 10;
    pitchHz += 5;
  }
  if (voiceMode === 'spillman_flat') {
    ratePct += 5;     // slightly clipped
    pitchHz = 0;      // flat — no expressive pitch movement
  }

  const rate = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;
  const pitch = `${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz`;

  return { text, urgent, voice, rate, pitch };
}

// ─── AudioContext ───────────────────────────────────────────
// The P25 coloring chain + its AudioWorklet processors (noise gate,
// bitcrusher) now live in utils/radioProcessor.ts so TTS, saved-clip
// playback, and the AI dispatcher all share one source of truth.

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// ─── Helpers ────────────────────────────────────────────────

function isSoundEnabled(): boolean {
  return (
    localStorage.getItem('rmpg-sound') !== 'false' &&
    localStorage.getItem('rmpg-voice-alerts') !== 'false'
  );
}

/** Returns true unless the user has explicitly chosen browser speech. */
export function isEdgeTTSEnabled(): boolean {
  return localStorage.getItem('rmpg-voice-engine') !== 'browser';
}

// ─── Browser SpeechSynthesis Fallback ───────────────────────

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  for (const name of PREFERRED_VOICES) {
    const match = voices.find(v => v.name.includes(name));
    if (match) return match;
  }
  // Fall back to first English female-sounding voice, or just first English
  return (
    voices.find(v => v.lang.startsWith('en') && /female/i.test(v.name)) ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  );
}

function speakFallback(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof speechSynthesis === 'undefined') {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

// ─── P25 Motorola Key-In / Key-Out Tones ────────────────────
// Authentic Motorola APX P25 channel-grant ("talk-permit") and
// end-of-transmission squelch tail. This is digital-radio behavior,
// not analog FM — no rising/falling sweep, no continuous hiss.

/**
 * P25 talk-permit tone — the sound an APX radio plays when the
 * trunked system grants the channel. Three rapid 800Hz sine chirps,
 * ~35ms each with ~25ms gaps. Total duration ~155ms.
 */
function playP25KeyUp(ctx: AudioContext, startTime: number): void {
  const beepDur = 0.035;
  const gap = 0.025;
  for (let i = 0; i < 3; i++) {
    const t0 = startTime + i * (beepDur + gap);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t0);

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.003);
    g.gain.setValueAtTime(0.18, t0 + beepDur - 0.003);
    g.gain.linearRampToValueAtTime(0, t0 + beepDur);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + beepDur + 0.005);
  }
}

/** Total duration of playP25KeyUp — used to align voice start. */
const P25_KEYUP_DURATION = 0.035 * 3 + 0.025 * 2; // 0.155s

/**
 * Spillman classic CAD announcer chime — two-tone descending "bing-bong"
 * (1100Hz → 880Hz, ~120ms each, 30ms gap), the signature Motorola/Spillman
 * Premier CAD attention tone played before terminal target-announcer
 * readbacks. Triangle waves give it the slightly metallic plastic-speaker
 * timbre, distinct from the P25 trunked talk-permit chirps.
 */
function playSpillmanChime(ctx: AudioContext, startTime: number): void {
  const tones: Array<[number, number]> = [[1100, 0.12], [880, 0.13]];
  let t = startTime;
  for (const [freq, dur] of tones) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.008);
    g.gain.setValueAtTime(0.22, t + dur - 0.012);
    g.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.005);
    t += dur + 0.03; // 30ms gap between tones
  }
}

/** Total duration of playSpillmanChime — used to align voice start. */
const SPILLMAN_CHIME_DURATION = 0.12 + 0.13 + 0.03; // 0.28s

/**
 * P25 end-of-transmission courtesy beep — a single soft 600Hz sine
 * pip (~80ms) signaling "over" to other units. Common on Motorola
 * profiles where the system is configured to emit an audible EOT
 * tone rather than a silent drop or noise-tail.
 */
function playP25KeyDown(ctx: AudioContext, startTime: number): void {
  const dur = 0.08;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, startTime);

  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(0.14, startTime + 0.005);
  g.gain.setValueAtTime(0.14, startTime + dur - 0.005);
  g.gain.linearRampToValueAtTime(0, startTime + dur);

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + dur + 0.01);
}

// ─── Edge-TTS Fetch + Radio Processing ──────────────────────

async function fetchAndPlay(
  text: string,
  urgent: boolean = false,
  voiceMode: VoiceMode = 'conversational',
): Promise<void> {
  const token = localStorage.getItem('rmpg_token');
  const ctx = getAudioContext();

  // Register AudioWorklet processors (idempotent, graceful fallback)
  const hasWorklets = await ensureRadioWorklets(ctx);

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(getEdgeTTSPayload(text, urgent, voiceMode)),
  });

  if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  return new Promise<void>((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    currentSource = source;

    const now = ctx.currentTime;
    // Spillman terminal announcer uses the classic 2-tone chime (~280ms);
    // conversational/officer-speech path uses the P25 trunked talk-permit
    // triple-chirp (~155ms). Voice starts after a 20ms gap.
    const introDuration = voiceMode === 'spillman_flat'
      ? SPILLMAN_CHIME_DURATION
      : P25_KEYUP_DURATION;
    const voiceDelay = introDuration + 0.02;
    const voiceDuration = audioBuffer.duration;

    // ── 1. INTRO TONE ─────────────────────────────────────
    if (voiceMode === 'spillman_flat') {
      playSpillmanChime(ctx, now);
    } else {
      playP25KeyUp(ctx, now);
    }

    // ── 2. RADIO HAZE CHAIN (shared P25 coloring) ─────────
    // AGC → 300–3400Hz bandpass → 1.8kHz presence → 12-bit bitcrusher,
    // the exact graph used for saved-clip + AI-dispatcher playback.
    // See utils/radioProcessor.ts — one source of truth for the sound.
    const { input, output } = buildRadioVoiceChain(ctx, hasWorklets);
    source.connect(input);
    output.connect(ctx.destination);

    // ── 3. RADIO STATIC / RECEIVER BED ────────────────────
    // Faint band-limited pink-noise hiss under the voice. squelchTail
    // is off here because the conversational path emits its own P25
    // courtesy beep below (step 5); doubling them sounds wrong.
    const noiseSource = createRadioNoiseBed(ctx, {
      startTime: now,
      attackAt: now + voiceDelay,
      holdUntil: now + voiceDelay + voiceDuration,
      squelchTail: false,
    });

    // ── 5. P25 SQUELCH TAIL (KEY-DOWN / un-key) ───────────
    // Only for the conversational / radio-channel path. Terminal
    // announcers don't carry a P25 un-key tail.
    if (voiceMode !== 'spillman_flat') {
      const closeTime = now + voiceDelay + voiceDuration + 0.05;
      playP25KeyDown(ctx, closeTime);
    }

    source.onended = () => {
      currentSource = null;
      // Let the close squelch + noise fade finish before resolving
      setTimeout(() => {
        try { noiseSource.stop(); } catch { /* already stopped */ }
        resolve();
      }, 400);
    };

    // Start voice after squelch open completes
    source.start(now + voiceDelay);
  });
}

// ─── Queue Processing ───────────────────────────────────────

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    try {
      if (isEdgeTTSEnabled()) {
        await fetchAndPlay(entry.text, entry.urgent, entry.voiceMode);
      } else {
        await speakFallback(entry.text);
      }
    } catch {
      // Edge-TTS failed — fall back to browser speech
      try {
        await speakFallback(entry.text);
      } catch {
        // Speech completely unavailable, skip
      }
    }
    entry.resolve();
  }

  processing = false;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Speak text via Edge-TTS with radio bandpass filter.
 * Respects sound/voice-alert toggles and severity minimum tier.
 * Major severity interrupts lower-priority queued items.
 */
export async function speak(
  text: string,
  severity?: AlertSeverity,
  voiceMode: VoiceMode = 'conversational',
  force = false,
): Promise<void> {
  // `force` bypasses the global voice-alerts master mute. The dialogue
  // agent's replies are intentional, user-initiated feedback (a direct
  // answer to a typed or spoken query) — they should always be audible
  // unless the user explicitly mutes the panel via 🔇 (confirmMode).
  // Passive alerts still respect the global mute.
  if (!force && !isSoundEnabled()) return;
  if (severity && !shouldPlayAudio(severity)) return;

  // Mirror every spoken line into the transcript buffer so the
  // DispatcherTranscript drawer and ARIA live regions stay in sync.
  // Dynamic import avoids a circular module load (edgeTTS -> hook -> React).
  import('../hooks/useDispatchTranscript')
    .then((m) => m.pushTranscriptEntry({
      text,
      severity: severity ?? 'minor',
      source: 'system',
    }))
    .catch(() => { /* transcript is best-effort */ });

  const urgent = severity === 'major';

  // Major alerts clear non-major items from the queue
  if (urgent) {
    // Stop currently playing audio if it exists
    if (currentSource) {
      try { currentSource.stop(); } catch { /* already stopped */ }
      currentSource = null;
    }
    // Remove non-major entries from queue
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!queue[i].urgent) {
        queue[i].resolve();
        queue.splice(i, 1);
      }
    }
  }

  return new Promise<void>((resolve) => {
    queue.push({ text, severity: severity || 'minor', urgent, voiceMode, resolve });
    processQueue();
  });
}

/**
 * Full dispatch announcement pipeline:
 *   1. Play the severity-appropriate dispatch tone
 *      (major: repeat tone 3x with 150ms gaps)
 *   2. 400ms pause
 *   3. Speak the text via Edge-TTS
 */
export async function announceWithSeverity(
  text: string,
  severity: AlertSeverity,
): Promise<void> {
  if (!isSoundEnabled()) return;
  if (!shouldPlayAudio(severity)) return;

  const toneName = getToneForSeverity(severity) as ToneType;

  if (severity === 'major') {
    // Repeat tone 3x with 150ms gaps
    for (let i = 0; i < 3; i++) {
      await playToneAsync(toneName);
      if (i < 2) await delay(150);
    }
  } else if (toneName) {
    await playToneAsync(toneName);
  }

  // 400ms pause between tone and speech
  await delay(400);

  await speak(text, severity);
}

/** Clear all pending speech from the queue. */
export function clearQueue(): void {
  // Stop currently playing audio
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  // Resolve and remove all queued entries
  while (queue.length > 0) {
    const entry = queue.shift()!;
    entry.resolve();
  }
}

// ─── Utility ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
