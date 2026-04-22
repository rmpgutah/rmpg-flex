// ============================================================
// RMPG Flex — Voice Stress Analyzer
//
// Analyzes mic audio for stress indicators using Web Audio
// API's AnalyserNode. Tracks pitch deviation, volume spikes,
// and speech rate changes to estimate officer distress level.
//
// Usage:
//   const analyzer = createStressAnalyzer(audioContext);
//   analyzer.connectSource(micSource);
//   // ... after sufficient samples ...
//   const result = analyzer.getResult();
//   analyzer.disconnect();
// ============================================================

// ─── Types ──────────────────────────────────────────────────

export interface StressResult {
  isStressed: boolean;
  confidence: number;       // 0–1
  pitchDeviation: number;   // % above baseline (e.g. 0.25 = 25%)
  volumeSpike: boolean;
  rateDeviation: number;    // % deviation from baseline rate
}

// ─── Constants ──────────────────────────────────────────────

const BASELINE_PITCH_HZ = 180;
const PITCH_STRESS_THRESHOLD = 1.20;     // 20% above baseline
const PITCH_HIGH_STRESS_THRESHOLD = 1.30; // 30% above baseline
const BASELINE_RMS = 0.15;
const VOLUME_SPIKE_THRESHOLD = 2.0;       // 2x baseline RMS
const MIN_SAMPLES = 10;
const SAMPLE_INTERVAL_MS = 100;
const FFT_SIZE = 2048;

// ─── Sample storage ─────────────────────────────────────────

interface AudioSample {
  dominantFrequency: number;
  rms: number;
  timestamp: number;
}

// ─── Factory ────────────────────────────────────────────────

export function createStressAnalyzer(audioContext: AudioContext) {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;

  const frequencyData = new Float32Array(analyser.frequencyBinCount);
  const timeDomainData = new Float32Array(analyser.fftSize);

  const samples: AudioSample[] = [];
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // ── Helpers ─────────────────────────────────────────────

  function getDominantFrequency(): number {
    analyser.getFloatFrequencyData(frequencyData);

    let maxValue = -Infinity;
    let maxIndex = 0;

    for (let i = 0; i < frequencyData.length; i++) {
      if (frequencyData[i] > maxValue) {
        maxValue = frequencyData[i];
        maxIndex = i;
      }
    }

    // Convert bin index to frequency in Hz
    const nyquist = audioContext.sampleRate / 2;
    return (maxIndex / frequencyData.length) * nyquist;
  }

  function getRMS(): number {
    analyser.getFloatTimeDomainData(timeDomainData);

    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      sumSquares += timeDomainData[i] * timeDomainData[i];
    }
    return Math.sqrt(sumSquares / timeDomainData.length);
  }

  function takeSample(): void {
    samples.push({
      dominantFrequency: getDominantFrequency(),
      rms: getRMS(),
      timestamp: Date.now(),
    });
  }

  // ── Public API ──────────────────────────────────────────

  function connectSource(source: MediaStreamAudioSourceNode): void {
    source.connect(analyser);
    samples.length = 0;
    intervalId = setInterval(takeSample, SAMPLE_INTERVAL_MS);
  }

  function getResult(): StressResult {
    // Not enough data — return neutral result
    if (samples.length < MIN_SAMPLES) {
      return {
        isStressed: false,
        confidence: 0,
        pitchDeviation: 0,
        volumeSpike: false,
        rateDeviation: 0,
      };
    }

    // Compute averages
    let pitchSum = 0;
    let rmsSum = 0;
    let hasVolumeSpike = false;

    for (const s of samples) {
      pitchSum += s.dominantFrequency;
      rmsSum += s.rms;
      if (s.rms > BASELINE_RMS * VOLUME_SPIKE_THRESHOLD) {
        hasVolumeSpike = true;
      }
    }

    const avgPitch = pitchSum / samples.length;
    const avgVolume = rmsSum / samples.length;
    const pitchRatio = avgPitch / BASELINE_PITCH_HZ;
    const pitchDeviation = Math.max(0, pitchRatio - 1);

    // Estimate rate deviation from sample timing variance
    // (faster speech = more energy fluctuations in shorter intervals)
    let rmsVariance = 0;
    for (const s of samples) {
      rmsVariance += (s.rms - avgVolume) ** 2;
    }
    rmsVariance /= samples.length;
    const rateDeviation = Math.min(1, Math.sqrt(rmsVariance) / BASELINE_RMS);

    // ── Stress scoring ──────────────────────────────────
    let score = 0;

    if (pitchRatio > PITCH_STRESS_THRESHOLD) score += 0.4;
    if (pitchRatio > PITCH_HIGH_STRESS_THRESHOLD) score += 0.2;
    if (hasVolumeSpike) score += 0.2;
    if (avgVolume > BASELINE_RMS * 1.5) score += 0.1;
    if (rateDeviation > 0.3) score += 0.1;

    const confidence = Math.min(1, score);

    return {
      isStressed: score >= 0.5,
      confidence,
      pitchDeviation,
      volumeSpike: hasVolumeSpike,
      rateDeviation,
    };
  }

  function disconnect(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    try {
      analyser.disconnect();
    } catch {
      // already disconnected
    }
    samples.length = 0;
  }

  return { connectSource, getResult, disconnect };
}
