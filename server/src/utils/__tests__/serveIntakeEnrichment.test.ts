import { describe, it, expect } from 'vitest';
import { extractUnitNumber } from '../serveIntakeEnrichment';

describe('serveIntakeEnrichment', () => {
  describe('extractUnitNumber', () => {
    it('extracts Apt #', () => {
      expect(extractUnitNumber('123 Main St Apt 4B, SLC, UT 84101')).toBe('4B');
    });
    it('extracts Unit', () => {
      expect(extractUnitNumber('500 S State Unit 12, SLC')).toBe('12');
    });
    it('extracts Suite', () => {
      expect(extractUnitNumber('1 Federal Plaza Suite 200, SLC')).toBe('200');
    });
    it('extracts # after comma', () => {
      expect(extractUnitNumber('99 Elm Ave, #305, Layton UT')).toBe('305');
    });
    it('returns null when no unit pattern present', () => {
      expect(extractUnitNumber('100 Main St, SLC, UT')).toBeNull();
    });
    it('handles empty/falsy input', () => {
      expect(extractUnitNumber('')).toBeNull();
      expect(extractUnitNumber(undefined as unknown as string)).toBeNull();
    });
    it('uppercases alphanumeric units', () => {
      expect(extractUnitNumber('77 Pine St Apt a3, SLC')).toBe('A3');
    });
  });
});
