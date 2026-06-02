// ============================================================
// AI dispatcher — voice-output realism (humanizeForSpeech)
// ============================================================
// Pure-function tests for the TTS text normalizer: NATO-phonetic identifier
// readback (plates/DL/VIN/warrant/case), call-sign digit-spelling, and the
// CLOCK-time fix that no longer mangles years / street numbers / plates.
// ============================================================

import { describe, it, expect } from 'vitest';
import { humanizeForSpeech, spellAlnum } from '../src/utils/aiDispatcher';

describe('spellAlnum — phonetic identifier readback', () => {
  it('spells letters NATO + digits spoken (niner for 9)', () => {
    expect(spellAlnum('ABC123')).toBe('Alpha Bravo Charlie one two three');
    expect(spellAlnum('7X9')).toBe('seven X-ray niner');
  });
  it('drops separators', () => {
    expect(spellAlnum('AB-12')).toBe('Alpha Bravo one two');
  });
});

describe('humanizeForSpeech — phonetic in context', () => {
  it('spells a plate after the keyword', () => {
    expect(humanizeForSpeech('Plate ABC123 comes back clear.'))
      .toContain('Plate Alpha Bravo Charlie one two three');
  });
  it('spells a standalone plate-like token', () => {
    // 7XYZ901 has both letters and digits, 7 chars, not hyphenated → spelled.
    expect(humanizeForSpeech('Vehicle on 7XYZ901 is clear'))
      .toContain('seven X-ray Yankee Zulu niner zero one');
  });
  it('spells a DL number after "DL"', () => {
    expect(humanizeForSpeech('DL D1234567')).toContain('Delta one two three four five six seven');
  });
  it('keeps the word but spells the number in a call-sign', () => {
    expect(humanizeForSpeech('12-Adam, copy')).toContain('one two Adam');
  });
});

describe('humanizeForSpeech — clock-time fix (no year/street mangling)', () => {
  it('voices a colon clock time as hours', () => {
    expect(humanizeForSpeech('show you out, time is 14:32'))
      .toContain('14 32 hours');
  });
  it('does NOT mangle a 4-digit year', () => {
    const out = humanizeForSpeech('registered 2024 Honda');
    expect(out).not.toContain('hours');
    expect(out).toContain('2024');
  });
  it('does NOT mangle a street number', () => {
    const out = humanizeForSpeech('respond to the 1200 block of Main');
    expect(out).not.toContain('12 00 hours');
  });
});

describe('humanizeForSpeech — existing behavior preserved', () => {
  it('still expands 10-codes', () => {
    expect(humanizeForSpeech('10-4')).toBe('ten four');
  });
  it('still expands priority codes', () => {
    expect(humanizeForSpeech('P1 call')).toContain('Priority One');
  });
});
