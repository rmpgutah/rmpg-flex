import { describe, it, expect } from 'vitest';
import { cleanOcrText } from '../serveIntakeOcrCleanup';

describe('cleanOcrText', () => {
  it('rejoins hyphenated line-breaks', () => {
    expect(cleanOcrText('assess-\nment')).toBe('assessment');
  });

  it('does not rejoin when next char is uppercase (proper hyphen)', () => {
    expect(cleanOcrText('Campbell-\nRyce')).toBe('Campbell-\nRyce');
  });

  it('normalizes fi/fl ligatures', () => {
    expect(cleanOcrText('of\uFB01ce')).toBe('office');
    expect(cleanOcrText('af\uFB02uent')).toBe('affluent');
  });

  it('normalizes smart quotes and em dashes', () => {
    expect(cleanOcrText('\u201Chello\u201D')).toBe('"hello"');
    expect(cleanOcrText('\u2018world\u2019')).toBe("'world'");
    expect(cleanOcrText('a\u2014b')).toBe('a-b');
  });

  it('fixes OCR 0→O substitution at word boundary', () => {
    expect(cleanOcrText('0ak Street')).toBe('Oak Street');
    expect(cleanOcrText('0live Avenue')).toBe('Olive Avenue');
  });

  it('does not fix 0 in numbers', () => {
    expect(cleanOcrText('84101')).toBe('84101');
    expect(cleanOcrText('Room 0')).toBe('Room 0');
  });

  it('fixes OCR 1→L substitution at word boundary', () => {
    expect(cleanOcrText('1ake City')).toBe('Lake City');
  });

  it('collapses 3+ spaces into 2', () => {
    expect(cleanOcrText('hello     world')).toBe('hello  world');
  });

  it('strips null bytes and control chars', () => {
    expect(cleanOcrText('hello\x00world\x01!')).toBe('helloworld!');
  });

  it('preserves normal text unchanged', () => {
    const normal = '123 Main Street, Salt Lake City, UT 84101';
    expect(cleanOcrText(normal)).toBe(normal);
  });
});
