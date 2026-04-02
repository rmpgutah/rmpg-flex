// ============================================================
// RMPG Flex — Edge-TTS Client Audio Player
//
// Fetches neural TTS audio from the server's /api/tts endpoint,
// applies a radio bandpass filter (1350Hz, Q 2.5) for authentic
// dispatch sound, and manages a priority queue where major alerts
// interrupt lower-priority audio.
//
// Falls back to browser SpeechSynthesis if the server is unreachable.
// ============================================================

import { playToneAsync } from './dispatchTones';
import type { AlertSeverity } from './alertSeverity';
import { getToneForSeverity, shouldPlayAudio } from './alertSeverity';
import type { ToneType } from './dispatchTones';

// ─── Types ──────────────────────────────────────────────────

interface QueueEntry {
  text: string;
  severity: AlertSeverity;
  urgent: boolean;
  resolve: () => void;
}

// ─── State ──────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
const queue: QueueEntry[] = [];
let processing = false;
let currentSource: AudioBufferSourceNode | null = null;

// Preferred female voices for SpeechSynthesis fallback
const PREFERRED_VOICES = ['Samantha', 'Karen', 'Zira', 'Jenny'];

// ─── AudioContext ───────────────────────────────────────────

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

// ─── Edge-TTS Fetch + Bandpass Playback ─────────────────────

async function fetchAndPlay(text: string): Promise<void> {
  const token = localStorage.getItem('rmpg_token');
  const ctx = getAudioContext();

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  return new Promise<void>((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    currentSource = source;

    // Clean, natural voice — no radio effects, no filters
    // Just play the Edge TTS neural voice directly
    source.connect(ctx.destination);

    source.onended = () => {
      currentSource = null;
      resolve();
    };
    source.start();
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
        await fetchAndPlay(entry.text);
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
export async function speak(text: string, severity?: AlertSeverity): Promise<void> {
  if (!isSoundEnabled()) return;
  if (severity && !shouldPlayAudio(severity)) return;

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
    queue.push({ text, severity: severity || 'minor', urgent, resolve });
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
