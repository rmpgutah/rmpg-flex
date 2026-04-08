import { describe, it, expect } from 'vitest';
import { localNow, localToday, SQL_NOW } from '../../src/utils/timeUtils';

describe('timeUtils', () => {
  describe('localNow', () => {
    it('returns ISO 8601 format with timezone offset', () => {
      const result = localNow();
      // Pattern: YYYY-MM-DDTHH:MM:SS±HH:MM
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it('produces a valid Date when parsed', () => {
      const result = localNow();
      const parsed = new Date(result);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('is within 2 seconds of Date.now()', () => {
      const before = Date.now();
      const result = localNow();
      const after = Date.now();
      const parsed = new Date(result).getTime();
      expect(parsed).toBeGreaterThanOrEqual(before - 1000);
      expect(parsed).toBeLessThanOrEqual(after + 1000);
    });

    it('pads single-digit months and days with zeros', () => {
      const result = localNow();
      const [datePart] = result.split('T');
      const [year, month, day] = datePart.split('-');
      expect(year).toHaveLength(4);
      expect(month).toHaveLength(2);
      expect(day).toHaveLength(2);
    });
  });

  describe('localToday', () => {
    it('returns YYYY-MM-DD format', () => {
      const result = localToday();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('matches the current local date', () => {
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(localToday()).toBe(expected);
    });
  });

  describe('SQL_NOW', () => {
    it('is a SQLite datetime expression', () => {
      expect(SQL_NOW).toBe("datetime('now', 'localtime')");
    });
  });
});
