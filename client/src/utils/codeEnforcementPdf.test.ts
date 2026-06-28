import { describe, it, expect } from 'vitest';
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  wrapText,
  classifySeverity,
} from './codeEnforcementPdf';

describe('codeEnforcementPdf helpers', () => {
  describe('fmtDate', () => {
    it('returns em-dash for empty / null / undefined', () => {
      expect(fmtDate('')).toBe('—');
      expect(fmtDate(null)).toBe('—');
      expect(fmtDate(undefined)).toBe('—');
    });
    it('formats a valid ISO date', () => {
      const out = fmtDate('2026-06-22T12:00:00Z');
      // Format depends on MT_TZ but should at least contain the year + month abbreviation
      expect(out).toMatch(/2026/);
      expect(out).toMatch(/Jun/);
    });
    it('does NOT throw on unparseable input (defers to parseTimestamp tolerance)', () => {
      // parseTimestamp falls back to `new Date()` for garbage input by design
      // across the codebase, so fmtDate returns *some* string rather than
      // throwing. We only assert non-empty + no throw.
      expect(() => fmtDate('not-a-date')).not.toThrow();
      expect(fmtDate('not-a-date')).toBeTruthy();
    });
  });

  describe('fmtDateTime', () => {
    it('returns em-dash for empty input', () => {
      expect(fmtDateTime('')).toBe('—');
      expect(fmtDateTime(undefined)).toBe('—');
    });
    it('appends MT timezone suffix to valid datetimes', () => {
      const out = fmtDateTime('2026-06-22T12:00:00Z');
      expect(out).toMatch(/MT$/);
    });
    it('does NOT crash on garbage input', () => {
      expect(() => fmtDateTime('garbage')).not.toThrow();
    });
  });

  describe('fmtMoney', () => {
    it('handles null / undefined / empty string as em-dash', () => {
      expect(fmtMoney(undefined)).toBe('—');
      expect(fmtMoney(null)).toBe('—');
      expect(fmtMoney('')).toBe('—');
    });
    it('formats positive numbers with two decimals', () => {
      expect(fmtMoney(150)).toBe('$150.00');
      expect(fmtMoney(150.5)).toBe('$150.50');
      expect(fmtMoney('250.75')).toBe('$250.75');
    });
    it('returns em-dash for NaN string', () => {
      expect(fmtMoney('not-a-number')).toBe('—');
    });
    it('handles zero', () => {
      expect(fmtMoney(0)).toBe('$0.00');
    });
  });

  describe('wrapText', () => {
    it('returns one-element [empty] for empty input', () => {
      expect(wrapText('', 50)).toEqual(['']);
    });
    it('preserves explicit newlines', () => {
      expect(wrapText('a\nb\nc', 80)).toEqual(['a', 'b', 'c']);
    });
    it('wraps long lines at the char boundary on word breaks', () => {
      const long = 'one two three four five six seven eight nine ten';
      const lines = wrapText(long, 12);
      // Each line should be <= 12 chars (approximately, allowing for trailing word)
      for (const l of lines) {
        expect(l.length).toBeLessThanOrEqual(14); // some slack for the last word
      }
      // Round-trip preserves all words
      expect(lines.join(' ')).toBe(long);
    });
    it('handles a single very-long word without splitting it', () => {
      const lines = wrapText('supercalifragilisticexpialidocious', 10);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('supercalifragilisticexpialidocious');
    });
  });

  describe('classifySeverity', () => {
    it('treats critical/high/major as the critical-banner trigger', () => {
      expect(classifySeverity('critical').isCritical).toBe(true);
      expect(classifySeverity('high').isCritical).toBe(true);
      expect(classifySeverity('major').isCritical).toBe(true);
      expect(classifySeverity('CRITICAL').isCritical).toBe(true);
    });
    it('treats low/medium/moderate/minor as non-critical', () => {
      expect(classifySeverity('low').isCritical).toBe(false);
      expect(classifySeverity('medium').isCritical).toBe(false);
      expect(classifySeverity('moderate').isCritical).toBe(false);
      expect(classifySeverity('minor').isCritical).toBe(false);
    });
    it('em-dashes empty / null / undefined and is not critical', () => {
      expect(classifySeverity('').label).toBe('—');
      expect(classifySeverity(null).label).toBe('—');
      expect(classifySeverity(undefined).label).toBe('—');
      expect(classifySeverity('').isCritical).toBe(false);
    });
    it('title-cases arbitrary input rather than throwing', () => {
      expect(classifySeverity('catastrophic').label).toBe('Catastrophic');
    });
  });
});
