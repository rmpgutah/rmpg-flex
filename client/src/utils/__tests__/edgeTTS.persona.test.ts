import { describe, it, expect, beforeEach } from 'vitest';
import { getEdgeTTSPayload } from '../edgeTTS';

// Unit tests for the pure persona -> Edge-TTS payload helper added in Task 1.4.
// Exercises localStorage-backed persona with urgent boost arithmetic and
// defensive handling for garbage stored values.

describe('getEdgeTTSPayload', () => {
  beforeEach(() => localStorage.clear());

  it('returns Edge-TTS defaults when nothing is stored', () => {
    const p = getEdgeTTSPayload('hello');
    expect(p.voice).toBe('en-US-JennyNeural');
    expect(p.rate).toBe('+0%');
    expect(p.pitch).toBe('+0Hz');
    expect(p.text).toBe('hello');
    expect(p.urgent).toBe(false);
  });

  it('honors persona stored in localStorage', () => {
    localStorage.setItem('rmpg-voice-persona', 'en-US-GuyNeural');
    localStorage.setItem('rmpg-voice-rate', '1.2');
    localStorage.setItem('rmpg-voice-pitch', '-5');
    const p = getEdgeTTSPayload('hi');
    expect(p.voice).toBe('en-US-GuyNeural');
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
