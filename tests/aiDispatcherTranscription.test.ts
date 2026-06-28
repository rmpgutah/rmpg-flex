// ============================================================
// AI dispatcher — Whisper transcription prompt builder
// ============================================================
// buildTranscriptionPrompt() composes the initial_prompt that biases
// Whisper toward RMPG's vocabulary + live channel context. These tests
// pin the contract the VoiceHubDO relies on: the domain glossary is
// always present, live context is appended, dupes are collapsed, and the
// whole thing is bounded so it stays inside Whisper's prompt budget.
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildTranscriptionPrompt, STT_DOMAIN_GLOSSARY } from '../src/utils/aiDispatcher';

describe('buildTranscriptionPrompt', () => {
  it('returns the domain glossary alone when given no context', () => {
    expect(buildTranscriptionPrompt()).toBe(STT_DOMAIN_GLOSSARY);
    expect(buildTranscriptionPrompt({})).toBe(STT_DOMAIN_GLOSSARY);
  });

  it('always includes the agency + the "mileage" term that was being misheard', () => {
    const p = buildTranscriptionPrompt();
    expect(p).toContain('Rocky Mountain Protective Group');
    expect(p).toContain('mileage');
  });

  it('appends operator vocabulary under a labeled clause', () => {
    const p = buildTranscriptionPrompt({ vocabulary: 'Penney Avenue, SSL-A1, Gateway Mall' });
    expect(p).toContain('Local terms: Penney Avenue, SSL-A1, Gateway Mall');
  });

  it('lists live call-signs and de-duplicates them', () => {
    const p = buildTranscriptionPrompt({ callSigns: ['D19', '12-Adam', 'D19', '', '  '] });
    expect(p).toContain('Units on the air: D19, 12-Adam.');
    // 'D19' appears once in the units clause (plus possibly inside the glossary example).
    expect(p.match(/Units on the air: [^.]*D19/)).toBeTruthy();
  });

  it('keeps only the two most-recent transmissions, in order, at the tail', () => {
    const p = buildTranscriptionPrompt({
      recent: ['first old line', 'second line', 'most recent line'],
    });
    expect(p).not.toContain('first old line');
    expect(p).toContain('second line most recent line');
    expect(p.trimEnd().endsWith('most recent line')).toBe(true);
  });

  it('bounds the prompt and preserves the live tail when over budget', () => {
    const p = buildTranscriptionPrompt({
      vocabulary: 'x'.repeat(5000),
      callSigns: ['D19'],
      recent: ['the very last transmission on the channel'],
    });
    expect(p.length).toBeLessThanOrEqual(900);
    // Front-truncation keeps the clip-specific context (most predictive).
    expect(p).toContain('the very last transmission on the channel');
  });

  it('ignores blank/whitespace-only context fields', () => {
    expect(buildTranscriptionPrompt({ vocabulary: '   ', callSigns: ['', ' '], recent: ['', '  '] }))
      .toBe(STT_DOMAIN_GLOSSARY);
  });
});
