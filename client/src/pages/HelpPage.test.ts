import { describe, it, expect } from 'vitest';
import { searchHelpContent } from './HelpPage';

describe('searchHelpContent', () => {
  it('returns nothing for empty/short queries', () => {
    expect(searchHelpContent('')).toEqual([]);
    expect(searchHelpContent('a')).toEqual([]);
    expect(searchHelpContent('  ')).toEqual([]);
  });

  it('finds shortcut by key combo', () => {
    const hits = searchHelpContent('Ctrl+K');
    expect(hits.length).toBeGreaterThan(0);
    const ck = hits.find(h => h.kind === 'shortcut' && h.title === 'Ctrl+K');
    expect(ck).toBeTruthy();
    expect(ck?.section).toBe('shortcuts');
  });

  it('finds shortcut by description', () => {
    const hits = searchHelpContent('global search');
    expect(hits.some(h => h.kind === 'shortcut' && /search/i.test(h.detail))).toBe(true);
  });

  it('finds module by name', () => {
    const hits = searchHelpContent('dispatch');
    expect(hits.some(h => h.kind === 'module' && h.title === 'Dispatch')).toBe(true);
  });

  it('finds module by feature substring', () => {
    const hits = searchHelpContent('skip trace');
    expect(hits.some(h => h.kind === 'module')).toBe(true);
  });

  it('finds FAQ by question keyword and attaches faqIdx', () => {
    const hits = searchHelpContent('password');
    const faq = hits.find(h => h.kind === 'faq');
    expect(faq).toBeTruthy();
    expect(faq?.faqIdx).toBeTypeOf('number');
    expect(faq?.section).toBe('faq');
  });

  it('is case-insensitive', () => {
    const lower = searchHelpContent('dispatch');
    const upper = searchHelpContent('DISPATCH');
    expect(upper.length).toBe(lower.length);
  });

  it('trims whitespace before searching', () => {
    const trimmed = searchHelpContent('  dispatch  ');
    const direct = searchHelpContent('dispatch');
    expect(trimmed.length).toBe(direct.length);
  });
});
