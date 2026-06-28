import { describe, it, expect } from 'vitest';
import { sanitizePdfText } from './pdfGenerator';

describe('sanitizePdfText', () => {
  it('strips emphasis markers by default (legacy callers unchanged)', () => {
    expect(sanitizePdfText('**bold** text')).toBe('BOLD TEXT');
  });
  it('preserves matched emphasis markers when preserveMarkers is set', () => {
    expect(sanitizePdfText('**bold**', { preserveMarkers: true })).toBe('**BOLD**');
    expect(sanitizePdfText('~~s~~', { preserveMarkers: true })).toBe('~~S~~');
  });
  it('still decodes entities and uppercases in preserveMarkers mode', () => {
    expect(sanitizePdfText('a &amp; **b**', { preserveMarkers: true })).toBe('A & **B**');
  });
  it('keeps leading indentation (list nesting depth) but collapses interior double-spaces', () => {
    expect(sanitizePdfText('  1. x', { preserveMarkers: true })).toBe('  1. X');
    expect(sanitizePdfText('    - deep', { preserveMarkers: true })).toBe('    - DEEP');
    expect(sanitizePdfText('a   b', { preserveMarkers: true })).toBe('A B');
  });
});
