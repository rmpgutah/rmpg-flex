import { describe, it, expect } from 'vitest';
import { normalizeVoicePrefs } from '../src/routes/voicePersona';

describe('normalizeVoicePrefs', () => {
  it('returns only the provided fields', () => {
    const r = normalizeVoicePrefs({ voice_persona: 'en-US-JennyNeural' });
    expect(r).toEqual({ values: { voice_persona: 'en-US-JennyNeural' } });
  });

  it('ignores undefined/null fields', () => {
    const r = normalizeVoicePrefs({ voice_persona: null, voice_rate: undefined });
    expect(r).toEqual({ values: {} });
  });

  it('rejects an over-long persona', () => {
    const r = normalizeVoicePrefs({ voice_persona: 'x'.repeat(101) });
    expect(r).toEqual({ error: 'invalid voice_persona' });
  });

  it('enforces the terseness enum', () => {
    expect(normalizeVoicePrefs({ voice_terseness: 'terse' })).toEqual({ values: { voice_terseness: 'terse' } });
    expect(normalizeVoicePrefs({ voice_terseness: 'chatty' })).toEqual({ error: 'invalid voice_terseness' });
  });

  it('bounds rate to 0.7–1.4', () => {
    expect(normalizeVoicePrefs({ voice_rate: 1.0 })).toEqual({ values: { voice_rate: 1.0 } });
    expect(normalizeVoicePrefs({ voice_rate: 2 })).toEqual({ error: 'voice_rate out of range' });
    expect(normalizeVoicePrefs({ voice_rate: 0.5 })).toEqual({ error: 'voice_rate out of range' });
  });

  it('bounds pitch to ±20', () => {
    expect(normalizeVoicePrefs({ voice_pitch: -20 })).toEqual({ values: { voice_pitch: -20 } });
    expect(normalizeVoicePrefs({ voice_pitch: 21 })).toEqual({ error: 'voice_pitch out of range' });
  });

  it('coerces brain_enabled booleans and ints to 0/1', () => {
    expect(normalizeVoicePrefs({ voice_brain_enabled: true })).toEqual({ values: { voice_brain_enabled: 1 } });
    expect(normalizeVoicePrefs({ voice_brain_enabled: false })).toEqual({ values: { voice_brain_enabled: 0 } });
    expect(normalizeVoicePrefs({ voice_brain_enabled: 0 })).toEqual({ values: { voice_brain_enabled: 0 } });
    expect(normalizeVoicePrefs({ voice_brain_enabled: 'yes' })).toEqual({ error: 'invalid voice_brain_enabled' });
  });

  it('collects multiple valid fields together', () => {
    const r = normalizeVoicePrefs({ voice_persona: 'v', voice_rate: 1.1, voice_terseness: 'standard', voice_brain_enabled: 1 });
    expect(r).toEqual({ values: { voice_persona: 'v', voice_rate: 1.1, voice_terseness: 'standard', voice_brain_enabled: 1 } });
  });
});
