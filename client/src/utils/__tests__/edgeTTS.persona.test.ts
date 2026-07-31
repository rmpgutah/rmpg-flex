import { describe, it, expect, beforeEach } from 'vitest';
import { getEdgeTTSPayload } from '../edgeTTS';

// Unit tests for the pure persona -> TTS payload helper.
// Exercises localStorage-backed persona with urgent boost arithmetic and
// defensive handling for garbage stored values.
//
// 2026-07-31: the default voice is now the Aura-2 speaker 'harmonia' from
// voiceCatalog, not the Edge-TTS id 'en-US-JennyNeural'. The server runs
// Deepgram Aura-2 and rejects Edge-TTS names, so the old default only
// "worked" because resolveAura2Voice() coerced it server-side.

describe('getEdgeTTSPayload', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the catalog dispatch voice when nothing is stored', () => {
    const p = getEdgeTTSPayload('hello');
    expect(p.voice).toBe('harmonia');
    expect(p.rate).toBe('+0%');
    expect(p.pitch).toBe('+0Hz');
    expect(p.text).toBe('hello');
    expect(p.urgent).toBe(false);
  });

  it('honors persona stored in localStorage', () => {
    localStorage.setItem('rmpg-voice-persona', 'zeus');
    localStorage.setItem('rmpg-voice-rate', '1.2');
    localStorage.setItem('rmpg-voice-pitch', '-5');
    const p = getEdgeTTSPayload('hi');
    expect(p.voice).toBe('zeus');
    expect(p.rate).toBe('+20%'); // (1.2 - 1) * 100 = +20
    expect(p.pitch).toBe('-5Hz');
  });

  it('applies urgent boost (+10% rate, +5Hz pitch) on top of the baseline', () => {
    localStorage.setItem('rmpg-voice-rate', '1.0');
    localStorage.setItem('rmpg-voice-pitch', '0');
    const p = getEdgeTTSPayload('hi', true);
    expect(p.rate).toBe('+10%');
    expect(p.pitch).toBe('+5Hz');
    expect(p.urgent).toBe(true);
  });

  it('stacks urgent boost on top of a slow persona', () => {
    localStorage.setItem('rmpg-voice-rate', '0.9'); // -10% baseline
    const p = getEdgeTTSPayload('hi', true);
    expect(p.rate).toBe('+0%'); // -10 + 10 = 0
  });

  it('rejects NaN rate from garbage localStorage and falls back to neutral', () => {
    localStorage.setItem('rmpg-voice-rate', 'fast');
    const p = getEdgeTTSPayload('hi');
    expect(p.rate).toBe('+0%');
  });

  it('rejects NaN pitch from garbage localStorage and falls back to 0Hz', () => {
    localStorage.setItem('rmpg-voice-pitch', 'high');
    const p = getEdgeTTSPayload('hi');
    expect(p.pitch).toBe('+0Hz');
  });

  it('formats negative pitch correctly', () => {
    localStorage.setItem('rmpg-voice-pitch', '-15');
    const p = getEdgeTTSPayload('hi');
    expect(p.pitch).toBe('-15Hz');
  });
});
