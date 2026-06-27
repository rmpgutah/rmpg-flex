// ============================================================
// AI dispatcher — voice-output realism (humanizeForSpeech)
// ============================================================
// Pure-function tests for the TTS text normalizer: NATO-phonetic identifier
// readback (plates/DL/VIN/warrant/case), call-sign digit-spelling, and the
// CLOCK-time fix that no longer mangles years / street numbers / plates.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  humanizeForSpeech,
  spellAlnum,
  clampSpoken,
  sayAgainReadback,
  resolveAura2Voice,
  shapeDelivery,
} from '../src/utils/aiDispatcher';

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

describe('clampSpoken — no mid-word / mid-sentence cutoff', () => {
  it('returns the text unchanged when within budget', () => {
    expect(clampSpoken('12-Adam, copy, show you out.', 400)).toBe('12-Adam, copy, show you out.');
  });
  it('cuts at the last sentence terminator within budget', () => {
    const t = 'Copy that. Stand by for the warrant return. There is an active felony warrant out of Salt Lake County.';
    const out = clampSpoken(t, 45);
    expect(out).toBe('Copy that. Stand by for the warrant return.');
  });
  it('never splits a word when no sentence end is available', () => {
    const t = 'unitcalling proceed to the northbound on-ramp immediately and advise on arrival status';
    const out = clampSpoken(t, 40);
    expect(out.endsWith('-')).toBe(false);
    // Last token must be whole — the clamp lands on a space boundary.
    expect(t.startsWith(out)).toBe(true);
    expect(t[out.length] === ' ' || out.length === t.length).toBe(true);
  });
  it('trims trailing whitespace on the cut', () => {
    const out = clampSpoken('one two three four five six seven eight', 20);
    expect(out).toBe(out.trim());
  });
});

describe('sayAgainReadback — 10-9 confirm what dispatch heard', () => {
  it('repeats the heard text and asks to say again', () => {
    const out = sayAgainReadback('D19', 'can you update my mileage');
    expect(out).toContain('D19');
    expect(out).toContain('10-9');
    expect(out).toContain('can you update my mileage');
    expect(out.toLowerCase()).toContain('say again');
  });
  it('voices "10-9" as "ten nine" after humanizing', () => {
    const out = humanizeForSpeech(sayAgainReadback('D19', 'update my mileage'));
    expect(out).toContain('ten nine');
  });
  it('handles a missing call-sign and empty transcript', () => {
    const out = sayAgainReadback(null, '   ');
    expect(out).toContain('Unit calling');
    expect(out).toContain('10-9');
    expect(out).not.toContain('""'); // no empty quoted readback
  });
  it('truncates a very long transcript to keep the readback brief', () => {
    const long = 'word '.repeat(60).trim();
    const out = sayAgainReadback('12-Adam', long);
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(180);
  });
});

describe('resolveAura2Voice — coerce to a valid Aura-2 speaker', () => {
  it('passes through a valid Aura-2 voice (case-insensitive)', () => {
    expect(resolveAura2Voice('Luna')).toBe('luna');
    expect(resolveAura2Voice('orion')).toBe('orion');
  });
  it('coerces an Aura-1-only or unknown name to the default', () => {
    expect(resolveAura2Voice('stella')).toBe('asteria'); // aura-1 only → default
    expect(resolveAura2Voice('en-US-JennyNeural')).toBe('asteria'); // browser persona → default
    expect(resolveAura2Voice('')).toBe('asteria');
    expect(resolveAura2Voice(null)).toBe('asteria');
  });
  it('honors an explicit fallback', () => {
    expect(resolveAura2Voice('nope', 'luna')).toBe('luna');
  });
});

describe('shapeDelivery — emotion / stress / enforcement tone', () => {
  const reply = 'All units, hold your traffic. Help is en route.';

  it('is a no-op with no profile (flat delivery preserved)', () => {
    expect(shapeDelivery(reply)).toBe(reply);
    expect(shapeDelivery(reply, undefined)).toBe(reply);
  });

  it('normal stress leaves the text calm/unchanged', () => {
    expect(shapeDelivery(reply, { stress: 'normal' })).toBe(reply);
  });

  it('elevated emphasizes command words without an exclamation', () => {
    const out = shapeDelivery(reply, { stress: 'elevated' });
    expect(out).toContain('ALL UNITS');
    expect(out).toContain('HOLD YOUR TRAFFIC');
    expect(out).toContain('EN ROUTE');
    expect(out.endsWith('.')).toBe(true); // no emergency exclamation at 'elevated'
  });

  it('high emphasizes command words AND hardens the close to "!"', () => {
    const out = shapeDelivery(reply, { stress: 'high' });
    expect(out).toContain('ALL UNITS');
    expect(out).toContain('HOLD YOUR TRAFFIC');
    expect(out.endsWith('!')).toBe(true);
  });

  it('only caps WHOLE command phrases — humanizeForSpeech never spells them out', () => {
    // "UNITS" must stay a word (not "U. N. I. T. S.") after the acronym pass.
    const out = humanizeForSpeech(shapeDelivery(reply, { stress: 'high' }));
    expect(out).toContain('UNITS');
    expect(out).not.toContain('U. N. I. T. S.');
  });

  it('leaves ordinary words untouched', () => {
    const plain = 'Show you out at the gateway mall lot.';
    expect(shapeDelivery(plain, { stress: 'high' })).toBe('Show you out at the gateway mall lot!');
  });
});
