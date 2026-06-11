import { describe, it, expect } from 'vitest';
import { sanitizePdfText } from '../pdfGenerator';

// Formal-output guarantees (PS-201 artifacts caught 2026-06-11): emoji and
// their invisible modifiers must vanish — never surface as literal "?".
describe('sanitizePdfText — formal output', () => {
  it('strips the variation selector after ⚠️ (no trailing "?")', () => {
    expect(sanitizePdfText('⚠️ OFFICER SAFETY')).toBe('[!] OFFICER SAFETY');
  });

  it('drops surrogate-pair emoji instead of rendering "??"', () => {
    expect(sanitizePdfText('\u{1F4CB} PROCESS SERVICE')).toBe('PROCESS SERVICE');
  });

  it('renders the middle-dot separator as a dash, not a stray period', () => {
    expect(sanitizePdfText('ENTRY 1 OF 2 · 06/11/2026')).toBe('ENTRY 1 OF 2 - 06/11/2026');
  });

  it('never emits "?" for unknown non-Latin-1 characters', () => {
    expect(sanitizePdfText('CASE 中文 NOTE')).toBe('CASE NOTE');
  });
});
