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

// ─── AudioWorklet Registration ─────────────────────────────
// Inline processor code as Blob URLs to avoid separate public files.
// Registration is idempotent — only loads once per AudioContext.

let workletsRegistered = false;

const NOISE_GATE_CODE = `
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -40, minValue: -100, maxValue: 0 }];
  }
  constructor() { super(); this.envelope = 0; this.attack = 0.01; this.release = 0.1; }
  process(inputs, outputs, parameters) {
    const input = inputs[0]; const output = outputs[0];
    if (!input || !input[0]) return true;
    const threshold = parameters.threshold[0];
    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch]; const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        const amplitude = Math.abs(inp[i]);
        const db = 20 * Math.log10(amplitude + 1e-10);
        this.envelope = db > threshold
          ? Math.min(1, this.envelope + this.attack)
          : Math.max(0, this.envelope - this.release);
        out[i] = inp[i] * this.envelope;
      }
    }
    return true;
  }
}
registerProcessor('noise-gate-processor', NoiseGateProcessor);
`;

const BITCRUSHER_CODE = `
class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'bitDepth', defaultValue: 12, minValue: 1, maxValue: 16 }];
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0]; const output = outputs[0];
    if (!input || !input[0]) return true;
    const bits = parameters.bitDepth[0];
    const step = 1 / Math.pow(2, bits);
    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch]; const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        out[i] = Math.round(inp[i] / step) * step;
      }
    }
    return true;
  }
}
registerProcessor('bitcrusher-processor', BitcrusherProcessor);
`;

async function registerWorklets(ctx: AudioContext): Promise<boolean> {
  if (workletsRegistered) return true;
  if (!ctx.audioWorklet) return false; // AudioWorklet not supported

  try {
    const noiseBlob = new Blob([NOISE_GATE_CODE], { type: 'application/javascript' });
    const noiseUrl = URL.createObjectURL(noiseBlob);
    await ctx.audioWorklet.addModule(noiseUrl);
    URL.revokeObjectURL(noiseUrl);

    const crushBlob = new Blob([BITCRUSHER_CODE], { type: 'application/javascript' });
    const crushUrl = URL.createObjectURL(crushBlob);
    await ctx.audioWorklet.addModule(crushUrl);
    URL.revokeObjectURL(crushUrl);

    workletsRegistered = true;
    return true;
  } catch (err) {
    console.warn('AudioWorklet registration failed, using fallback chain:', err);
    return false;
  }
}

// ─── AudioContext ───────────────────────────────────────────

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    workletsRegistered = false; // New context needs fresh registration
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

// ─── Radio Squelch Beep Generator ───────────────────────────
// Authentic police radio open/close beep — short dual-tone burst

function playSquelchBeep(ctx: AudioContext, startTime: number, type: 'open' | 'close'): void {
  // Open squelch: rising tone (900→1400Hz over 80ms)
  // Close squelch: falling tone (1400→900Hz over 80ms)
  const duration = 0.08;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc2.type = 'sine';

  if (type === 'open') {
    osc1.frequency.setValueAtTime(900, startTime);
    osc1.frequency.linearRampToValueAtTime(1400, startTime + duration);
    osc2.frequency.setValueAtTime(1800, startTime);
    osc2.frequency.linearRampToValueAtTime(2200, startTime + duration);
  } else {
    osc1.frequency.setValueAtTime(1400, startTime);
    osc1.frequency.linearRampToValueAtTime(900, startTime + duration);
    osc2.frequency.setValueAtTime(2200, startTime);
    osc2.frequency.linearRampToValueAtTime(1800, startTime + duration);
  }

  // Quick envelope: fade in 5ms, hold, fade out 10ms
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.12, startTime + 0.005);
  gain.gain.setValueAtTime(0.12, startTime + duration - 0.01);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(startTime);
  osc1.stop(startTime + duration + 0.01);
  osc2.start(startTime);
  osc2.stop(startTime + duration + 0.01);
}

// ─── Edge-TTS Fetch + Radio Processing ──────────────────────

async function fetchAndPlay(text: string): Promise<void> {
  const token = localStorage.getItem('rmpg_token');
  const ctx = getAudioContext();

  // Register AudioWorklet processors (idempotent, graceful fallback)
  const hasWorklets = await registerWorklets(ctx);

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

    const now = ctx.currentTime;
    const voiceDelay = 0.15; // Start voice 150ms after open squelch
    const voiceDuration = audioBuffer.duration;

    // ── 1. OPEN SQUELCH BEEP ──────────────────────────────
    playSquelchBeep(ctx, now, 'open');

    // ── 2. RADIO FREQUENCY PROCESSING ─────────────────────
    // Bandpass filter: 300Hz–3400Hz (standard radio bandwidth)
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 300;
    highpass.Q.value = 0.7;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3400;
    lowpass.Q.value = 0.7;

    // Presence/clarity boost at 1.5kHz (radio intelligibility)
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1500;
    presence.Q.value = 1.0;
    presence.gain.value = 3;

    // Slight compression feel via gain staging
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.85;

    // ── 2a. AGC (DynamicsCompressor) ──────────────────────
    // Automatic gain control — levels out volume spikes/dips
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // ── 3. RADIO STATIC / BACKGROUND NOISE ────────────────
    // Pink noise — continuous hiss during transmission
    const noiseLen = voiceDuration + voiceDelay + 0.4;
    const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * noiseLen), ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
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
    noiseSource.buffer = noiseBuf;

    // Bandpass the noise too (radio-band static only)
    const noiseHP = ctx.createBiquadFilter();
    noiseHP.type = 'highpass';
    noiseHP.frequency.value = 400;

    const noiseLP = ctx.createBiquadFilter();
    noiseLP.type = 'lowpass';
    noiseLP.frequency.value = 3000;

    // Noise volume — audible but not overpowering
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    // Fade in with squelch open
    noiseGain.gain.linearRampToValueAtTime(0.018, now + 0.05);
    // Hold during voice
    noiseGain.gain.setValueAtTime(0.018, now + voiceDelay + voiceDuration);
    // Fade out after voice ends
    noiseGain.gain.linearRampToValueAtTime(0, now + voiceDelay + voiceDuration + 0.3);

    // Noise chain: source → HP → LP → gain → output
    noiseSource.connect(noiseHP);
    noiseHP.connect(noiseLP);
    noiseLP.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + noiseLen);

    // ── 4. VOICE CHAIN ────────────────────────────────────
    // Full chain: Source → NoiseGate → AGC → HP → LP → Presence → Bitcrusher → VoiceGain → Output
    // Fallback (no AudioWorklet): Source → AGC → HP → LP → Presence → VoiceGain → Output
    if (hasWorklets) {
      const noiseGate = new AudioWorkletNode(ctx, 'noise-gate-processor');
      const bitcrusher = new AudioWorkletNode(ctx, 'bitcrusher-processor');

      source.connect(noiseGate);
      noiseGate.connect(compressor);
      compressor.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(presence);
      presence.connect(bitcrusher);
      bitcrusher.connect(voiceGain);
      voiceGain.connect(ctx.destination);
    } else {
      // Graceful fallback — skip worklet nodes, keep AGC + filters
      source.connect(compressor);
      compressor.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(presence);
      presence.connect(voiceGain);
      voiceGain.connect(ctx.destination);
    }

    // ── 5. CLOSE SQUELCH BEEP (after voice ends) ──────────
    const closeTime = now + voiceDelay + voiceDuration + 0.1;
    playSquelchBeep(ctx, closeTime, 'close');

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
