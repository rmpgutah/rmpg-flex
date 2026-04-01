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

    // ── Subtle radio dispatch effect ──────────────────────
    // Not aggressive — just enough to feel like it's coming
    // through a radio. Voice stays clear and natural.

    // 1. Gentle high-shelf rolloff (softens highs, like a radio speaker)
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 3000;
    highShelf.gain.value = -4; // mild cut, not harsh

    // 2. Gentle low-shelf rolloff (reduces bass rumble)
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'highpass';
    lowShelf.frequency.value = 250; // cuts below 250Hz gently
    lowShelf.Q.value = 0.5; // very gentle slope

    // 3. Mild presence boost (radio "crispness" around 1.5-2kHz)
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1800;
    presence.Q.value = 0.8;
    presence.gain.value = 2; // subtle boost

    // 4. Very quiet static noise (pink noise, barely audible)
    const noiseLength = audioBuffer.duration + 0.3;
    const noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * noiseLength), ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    // Pink noise approximation — filtered white noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < noiseData.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      noiseData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Noise volume — very quiet (just a hint of static)
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.012; // barely audible

    // Voice volume — stays clear
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.92;

    // 5. Optional squelch click at start (very brief, subtle)
    const squelchOsc = ctx.createOscillator();
    squelchOsc.type = 'sine';
    squelchOsc.frequency.value = 1200;
    const squelchGain = ctx.createGain();
    squelchGain.gain.value = 0;
    // Quick fade in/out: 0→0.08→0 over 60ms
    const now = ctx.currentTime;
    squelchGain.gain.setValueAtTime(0, now);
    squelchGain.gain.linearRampToValueAtTime(0.06, now + 0.015);
    squelchGain.gain.linearRampToValueAtTime(0, now + 0.06);
    squelchOsc.connect(squelchGain);
    squelchGain.connect(ctx.destination);
    squelchOsc.start(now);
    squelchOsc.stop(now + 0.08);

    // Chain: voice → highpass → presence → highshelf → voiceGain → output
    source.connect(lowShelf);
    lowShelf.connect(presence);
    presence.connect(highShelf);
    highShelf.connect(voiceGain);
    voiceGain.connect(ctx.destination);

    // Noise: noiseSource → noiseGain → output (parallel, not in voice chain)
    noiseSource.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseSource.start();
    noiseSource.stop(ctx.currentTime + noiseLength);

    source.onended = () => {
      currentSource = null;
      // Fade out noise after voice ends
      noiseGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      setTimeout(() => {
        try { noiseSource.stop(); } catch { /* already stopped */ }
      }, 300);
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
