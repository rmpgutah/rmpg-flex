import { describe, it, expect } from 'vitest';
import {
  tokenizeInline,
  classifyLine,
  computeListLines,
  stripStrayMarkers,
  INDENT_UNIT,
} from './noteFormatting';

describe('tokenizeInline', () => {
  it('returns a single plain token for unmarked text', () => {
    expect(tokenizeInline('hello world')).toEqual([{ text: 'hello world' }]);
  });
  it('parses bold, italic, underline, strike', () => {
    expect(tokenizeInline('**b**')).toEqual([{ text: 'b', bold: true }]);
    expect(tokenizeInline('*i*')).toEqual([{ text: 'i', italic: true }]);
    expect(tokenizeInline('__u__')).toEqual([{ text: 'u', underline: true }]);
    expect(tokenizeInline('~~s~~')).toEqual([{ text: 's', strike: true }]);
  });
  it('keeps plain text around marks', () => {
    expect(tokenizeInline('a **b** c')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' c' },
    ]);
  });
  it('does not treat ** as italic *', () => {
    expect(tokenizeInline('**x**')).toEqual([{ text: 'x', bold: true }]);
  });
});

describe('classifyLine', () => {
  it('detects bullets by leading dash', () => {
    expect(classifyLine('- item')).toMatchObject({ kind: 'bullet', depth: 0, content: 'item' });
  });
  it('detects ordered items by N.', () => {
    expect(classifyLine('1. item')).toMatchObject({ kind: 'ordered', depth: 0, content: 'item' });
  });
  it('computes depth from indentation (2 spaces per level)', () => {
    expect(classifyLine('    - deep')).toMatchObject({ kind: 'bullet', depth: 2, content: 'deep' });
  });
  it('classifies non-list text as plain', () => {
    expect(classifyLine('just text')).toMatchObject({ kind: 'plain', depth: 0 });
  });
  it('exposes INDENT_UNIT as 2', () => {
    expect(INDENT_UNIT).toBe(2);
  });
});

describe('computeListLines outline numbering', () => {
  it('numbers nested ordered items as a dotted chain', () => {
    const text = ['1. a', '  1. b', '    1. c', '  1. d', '1. e'].join('\n');
    const markers = computeListLines(text).map((l) => l.marker);
    expect(markers).toEqual(['1', '1.1', '1.1.1', '1.2', '2']);
  });
  it('renders bullets with a dot marker and leaves ordered counters intact', () => {
    const text = ['1. a', '  - note', '1. b'].join('\n');
    const lines = computeListLines(text);
    expect(lines.map((l) => l.marker)).toEqual(['1', '•', '2']);
  });
  it('resets numbering after a top-level plain line', () => {
    const text = ['1. a', 'plain break', '1. b'].join('\n');
    expect(computeListLines(text).map((l) => l.marker)).toEqual(['1', '', '1']);
  });
});

describe('stripStrayMarkers', () => {
  it('removes unmatched emphasis markers', () => {
    expect(stripStrayMarkers('**oops and __x')).toBe('oops and x');
  });
});
