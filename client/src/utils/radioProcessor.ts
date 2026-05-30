// ============================================================
// RMPG Flex — Radio Processor (shared P25 "radio haze" chain)
// ============================================================
// The single source of truth for the Motorola APX / P25 voice
// coloration used across the app. Extracted from edgeTTS.ts so the
// SAME chain colors three different audio paths:
//
//   1. TTS dispatch alerts          (edgeTTS.ts → buildRadioVoiceChain)
//   2. Saved transmission playback  (RadioHazePlayer, radio tab)
//   3. Live AI-dispatcher replies   (RadioHazePlayer, voice channel)
//
// The chain models an IMBE/AMBE digital vocoder rather than analog FM:
//   • 300–3400Hz bandpass (the vocoder's voice band)
//   • +4dB peaking shelf at 1.8kHz (the "metallic" codec presence)
//   • 12-bit bitcrusher (codec quantization grit, via AudioWorklet)
//   • -40dB noise gate + AGC compressor (levels the talker)
//   • a faint band-limited pink-noise bed (receiver-path hiss) that
//     fades in under the voice and ends in a short squelch-tail burst
//
// Worklet registration is per-AudioContext and idempotent. When
// AudioWorklet is unavailable (older Safari, locked-down WebViews) the
// chain degrades gracefully to the filter-only path — never silent.
// ============================================================

// ─── AudioWorklet processor source (inlined as Blob URLs) ───
// Kept here so every consumer of the chain registers identical DSP.

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

// Registration is per-context — a WeakSet lets the context be GC'd
// without us pinning it, and avoids re-adding modules (which throws).
const registeredCtx = new WeakSet<AudioContext>();

/**
 * Register the noise-gate + bitcrusher worklets on a context.
 * Idempotent and safe to call before every playback.
 * @returns true if the worklet nodes are available, false if we must
 *          fall back to the filter-only chain.
 */
export async function ensureRadioWorklets(ctx: AudioContext): Promise<boolean> {
  if (registeredCtx.has(ctx)) return true;
  if (!ctx.audioWorklet) return false; // AudioWorklet not supported
  try {
    for (const code of [NOISE_GATE_CODE, BITCRUSHER_CODE]) {
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
    }
    registeredCtx.add(ctx);
    return true;
  } catch (err) {
    console.warn('[radio] AudioWorklet registration failed, using fallback chain:', err);
    return false;
  }
}

// ─── Voice coloring chain ───────────────────────────────────

export interface RadioChainNodes {
  /** Connect your source node here. */
  input: AudioNode;
  /** Connect this to ctx.destination (or a further node). */
  output: AudioNode;
}

/**
 * Build the P25 voice-coloring graph and return its head/tail so the
 * caller wires up its own source and destination.
 *
 *   source → [NoiseGate] → AGC → HP(300) → LP(3400)
 *          → Presence(1.8k +4dB) → [Bitcrusher 12-bit] → Gain(0.85) → output
 *
 * `hasWorklets` toggles the gate/bitcrusher; pass the result of
 * ensureRadioWorklets(ctx).
 */
// ─── Org-configurable haze settings (Admin → Radio) ─────────
// A module-level config the operator console sets from /api/radio/settings.
// DEFAULTS reproduce the historical sound EXACTLY (standard intensity, the
// original near-silent noise bed, chain enabled) — so behavior is unchanged
// until an admin moves a slider.
export type HazeIntensity = 'clean' | 'light' | 'standard' | 'heavy';

export interface RadioHazeConfig {
  /** Run playback through the P25 chain at all (tts_over_radio). */
  enabled: boolean;
  /** Strength of the codec-presence coloring. 'standard' == legacy sound. */
  intensity: HazeIntensity;
  /** Operator noise-bed knob, 0–1 (0.15 == legacy near-silent hiss). */
  noiseLevel: number;
}

// 'standard' maps to 1.0 → presence gain 4dB (the original value).
const INTENSITY_SCALE: Record<HazeIntensity, number> = { clean: 0, light: 0.5, standard: 1, heavy: 1.6 };
// Maps the 0–1 operator knob onto the actual pink-noise level. 0.15 → ~0.004
// (the original near-silent P25 bed), so the default is a perfect no-op.
const NOISE_LEVEL_MAX = 0.027;

let hazeConfig: RadioHazeConfig = { enabled: true, intensity: 'standard', noiseLevel: 0.15 };

/** Set the org haze config (called once from the radio console on load). */
export function setRadioHazeConfig(patch: Partial<RadioHazeConfig>): void {
  hazeConfig = { ...hazeConfig, ...patch };
}
/** Current haze config (defaults reproduce the legacy sound). */
export function getRadioHazeConfig(): RadioHazeConfig {
  return hazeConfig;
}

export function buildRadioVoiceChain(ctx: AudioContext, hasWorklets: boolean): RadioChainNodes {
  // IMBE/AMBE vocoder band: ~300Hz–3400Hz.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 300;
  highpass.Q.value = 0.7;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3400;
  lowpass.Q.value = 0.7;

  // Metallic codec presence — slightly higher than analog comms. Scaled by
  // the org haze intensity (standard == 4dB, the legacy value).
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1800;
  presence.Q.value = 1.4;
  presence.gain.value = 4 * INTENSITY_SCALE[hazeConfig.intensity];

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0.85;

  // AGC — levels out volume spikes/dips so quiet and loud talkers
  // arrive at the listener at a comparable level.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  // Common spine: AGC → HP → LP → Presence
  compressor.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(presence);

  if (hasWorklets) {
    const noiseGate = new AudioWorkletNode(ctx, 'noise-gate-processor');
    const bitcrusher = new AudioWorkletNode(ctx, 'bitcrusher-processor');
    noiseGate.connect(compressor);
    presence.connect(bitcrusher);
    bitcrusher.connect(voiceGain);
    return { input: noiseGate, output: voiceGain };
  }

  presence.connect(voiceGain);
  return { input: compressor, output: voiceGain };
}

// ─── Pink-noise receiver bed ─────────────────────────────────

export interface NoiseBedOptions {
  /** ctx.currentTime baseline for the envelope. */
  startTime: number;
  /** When the hiss reaches its sustain level (align with voice start). */
  attackAt: number;
  /** When the voice ends — the hiss begins its squelch tail here. */
  holdUntil: number;
  /** Sustain level of the receiver hiss (P25 is near-silent: ~0.004). */
  level?: number;
  /** Add a short louder "ksshht" squelch burst at un-key. Default true. */
  squelchTail?: boolean;
}

/**
 * Create the band-limited pink-noise bed that sits under a transmission
 * and closes with a squelch tail. Returns the started source node so the
 * caller can stop() it on teardown. Self-connects to ctx.destination.
 */
export function createRadioNoiseBed(ctx: AudioContext, opts: NoiseBedOptions): AudioBufferSourceNode {
  const level = opts.level ?? 0.004;
  const squelchTail = opts.squelchTail ?? true;
  const tailLen = 0.4;
  const totalLen = Math.max(0.1, opts.holdUntil - opts.startTime + tailLen);

  const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * totalLen), ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  // Paul Kellet pink-noise filter — warm, radio-like hiss (not white).
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;

  // Band-limit the hiss to the radio band (400–3000Hz).
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 400;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, opts.startTime);
  gain.gain.linearRampToValueAtTime(level, opts.attackAt);
  gain.gain.setValueAtTime(level, opts.holdUntil);
  if (squelchTail) {
    // Brief "ksshht" burst as the carrier drops, then silence.
    gain.gain.linearRampToValueAtTime(level * 5, opts.holdUntil + 0.04);
    gain.gain.linearRampToValueAtTime(0, opts.holdUntil + 0.18);
  } else {
    gain.gain.linearRampToValueAtTime(0, opts.holdUntil + 0.1);
  }

  src.connect(hp);
  hp.connect(lp);
  lp.connect(gain);
  gain.connect(ctx.destination);
  src.start(opts.startTime);
  src.stop(opts.startTime + totalLen);
  return src;
}

// ─── Shared playback context ─────────────────────────────────
// One reused context for all recording/dispatcher playback. Reusing it
// (rather than new AudioContext per click) avoids the browser's ~6-context
// ceiling and keeps worklets registered once. We never close it; we only
// stop the source nodes.

let sharedCtx: AudioContext | null = null;

function getRadioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

// ─── RadioHazePlayer ─────────────────────────────────────────

/**
 * One-shot player that decodes an encoded clip (WebM/Opus from a real
 * transmission, or MP3 from the dispatcher's TTS) and plays it through
 * the full radio haze chain. One clip at a time per instance.
 */
export class RadioHazePlayer {
  private source: AudioBufferSourceNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private endCb: (() => void) | null = null;

  /** Fetch and play an audio URL (e.g. /api/radio/transmissions/:id/audio). */
  async playUrl(url: string, onEnded?: () => void): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`radio audio fetch failed: ${res.status}`);
    await this.playBytes(await res.arrayBuffer(), onEnded);
  }

  /** Play already-fetched encoded audio bytes (any decodeAudioData format). */
  async playBytes(data: ArrayBuffer, onEnded?: () => void): Promise<void> {
    this.stop();
    const ctx = getRadioContext();
    const hasWorklets = await ensureRadioWorklets(ctx);
    // slice(0) — decodeAudioData detaches the buffer; keep the caller's copy intact.
    const audioBuffer = await ctx.decodeAudioData(data.slice(0));

    const now = ctx.currentTime;
    const lead = 0.06; // tiny squelch-open gap before voice
    const dur = audioBuffer.duration;
    const cfg = hazeConfig;

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    this.source = src;
    this.endCb = onEnded ?? null;

    if (!cfg.enabled) {
      // tts_over_radio off — play the clean voice with no P25 chain/noise.
      src.connect(ctx.destination);
      this.noise = null;
    } else {
      const { input, output } = buildRadioVoiceChain(ctx, hasWorklets);
      output.connect(ctx.destination);
      src.connect(input);
      this.noise = createRadioNoiseBed(ctx, {
        startTime: now,
        attackAt: now + lead,
        holdUntil: now + lead + dur,
        // Map the 0–1 operator knob onto the real pink-noise level.
        level: Math.max(0, Math.min(cfg.noiseLevel, 1)) * NOISE_LEVEL_MAX,
      });
    }

    src.onended = () => {
      const cb = this.endCb;
      this.cleanup();
      cb?.();
    };
    src.start(now + lead);
  }

  /** Stop playback without firing the onEnded callback. */
  stop(): void {
    this.endCb = null;
    this.cleanup();
  }

  private cleanup(): void {
    for (const node of [this.source, this.noise]) {
      if (node) { try { node.onended = null; node.stop(); } catch { /* already stopped */ } }
    }
    this.source = null;
    this.noise = null;
  }
}
