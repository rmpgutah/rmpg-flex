import { describe, it, expect } from 'vitest';
import { formatPageNumber, resolvePageLabel } from '../pageNumbering';
import type { PageLabelRule } from '../types';

describe('formatPageNumber', () => {
  it('formats decimal (default)', () => {
    expect(formatPageNumber(7)).toBe('7');
    expect(formatPageNumber(7, 'decimal')).toBe('7');
  });
  it('formats lower/upper roman', () => {
    expect(formatPageNumber(4, 'roman')).toBe('iv');
    expect(formatPageNumber(9, 'Roman')).toBe('IX');
    expect(formatPageNumber(2026, 'Roman')).toBe('MMXXVI');
  });
  it('formats lower/upper alpha (spreadsheet-style)', () => {
    expect(formatPageNumber(1, 'alpha')).toBe('a');
    expect(formatPageNumber(26, 'alpha')).toBe('z');
    expect(formatPageNumber(27, 'alpha')).toBe('aa');
    expect(formatPageNumber(28, 'Alpha')).toBe('AB');
  });
});

describe('resolvePageLabel', () => {
  const rules: PageLabelRule[] = [
    { id: '1', from: 1, to: 3, prefix: '', style: 'Roman', start: 1 },
    { id: '2', from: 4, to: 10, prefix: '', style: 'decimal', start: 1 },
  ];
  it('returns plain decimal when no rules', () => {
    expect(resolvePageLabel(undefined, 5)).toBe('5');
    expect(resolvePageLabel([], 5)).toBe('5');
  });
  it('applies the matching rule with its start offset', () => {
    expect(resolvePageLabel(rules, 1)).toBe('I');
    expect(resolvePageLabel(rules, 3)).toBe('III');
    expect(resolvePageLabel(rules, 4)).toBe('1'); // decimal restart
    expect(resolvePageLabel(rules, 6)).toBe('3');
  });
  it('honors a prefix and a non-1 start', () => {
    expect(resolvePageLabel([{ id: 'x', from: 1, to: 5, prefix: 'A-', style: 'decimal', start: 100 }], 2)).toBe('A-101');
  });
  it('lets a later overlapping rule win', () => {
    const overlap: PageLabelRule[] = [
      { id: 'a', from: 1, to: 5, prefix: 'old', style: 'decimal', start: 1 },
      { id: 'b', from: 3, to: 5, prefix: 'new', style: 'decimal', start: 1 },
    ];
    expect(resolvePageLabel(overlap, 4)).toBe('new2');
  });
});
