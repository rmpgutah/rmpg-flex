import { describe, it, expect } from 'vitest';
import {
  formatPhone,
  formatSSN,
  formatCurrency,
  formatFileSize,
  formatDuration,
  formatShiftDuration,
  formatNumber,
  formatPercent,
  formatVIN,
  formatPlate,
  formatName,
  formatAddress,
  truncate,
  toTitleCase,
  toDisplayLabel,
  pluralize,
  formatCoordinates,
  formatDistance,
} from '../../src/utils/formatters';

describe('formatters', () => {
  describe('formatPhone', () => {
    it('formats a 10-digit number', () => {
      expect(formatPhone('8015551234')).toBe('(801) 555-1234');
    });

    it('formats an 11-digit number with leading 1', () => {
      expect(formatPhone('18015551234')).toBe('(801) 555-1234');
    });

    it('strips non-digit characters', () => {
      expect(formatPhone('(801) 555-1234')).toBe('(801) 555-1234');
    });

    it('returns raw value for non-10-digit numbers', () => {
      expect(formatPhone('12345')).toBe('12345');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatPhone(null)).toBe('');
      expect(formatPhone(undefined)).toBe('');
    });
  });

  describe('formatSSN', () => {
    it('masks SSN by default (***-**-1234)', () => {
      expect(formatSSN('123456789')).toBe('***-**-6789');
    });

    it('shows full SSN when requested', () => {
      expect(formatSSN('123456789', { full: true })).toBe('123-45-6789');
    });

    it('handles dashed input', () => {
      expect(formatSSN('123-45-6789')).toBe('***-**-6789');
    });

    it('returns raw value for invalid length', () => {
      expect(formatSSN('12345')).toBe('12345');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatSSN(null)).toBe('');
    });
  });

  describe('formatCurrency', () => {
    it('formats basic amounts', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('formats negative amounts', () => {
      expect(formatCurrency(-99.99)).toBe('-$99.99');
    });

    it('defaults to $0.00 for null/undefined/NaN', () => {
      expect(formatCurrency(null)).toBe('$0.00');
      expect(formatCurrency(undefined)).toBe('$0.00');
      expect(formatCurrency(NaN)).toBe('$0.00');
    });

    it('supports custom decimal places', () => {
      expect(formatCurrency(10, { decimals: 0 })).toBe('$10');
    });

    it('supports sign display', () => {
      expect(formatCurrency(50, { showSign: true })).toBe('+$50.00');
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1.0 GB');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(45)).toBe('45s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('formats minutes without trailing zero seconds', () => {
      expect(formatDuration(120)).toBe('2m');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(3900)).toBe('1h 5m');
    });

    it('formats hours without trailing zero minutes', () => {
      expect(formatDuration(3600)).toBe('1h');
    });

    it('handles negative values as 0s', () => {
      expect(formatDuration(-10)).toBe('0s');
    });
  });

  describe('formatShiftDuration', () => {
    it('formats minutes as hours:minutes', () => {
      expect(formatShiftDuration(510)).toBe('8:30 hrs');
      expect(formatShiftDuration(60)).toBe('1:00 hrs');
      expect(formatShiftDuration(0)).toBe('0:00 hrs');
    });
  });

  describe('formatNumber', () => {
    it('formats with comma separators', () => {
      expect(formatNumber(1234567)).toBe('1,234,567');
    });

    it('returns "0" for null/undefined/NaN', () => {
      expect(formatNumber(null)).toBe('0');
      expect(formatNumber(undefined)).toBe('0');
      expect(formatNumber(NaN)).toBe('0');
    });
  });

  describe('formatPercent', () => {
    it('formats with default 1 decimal', () => {
      expect(formatPercent(85.5)).toBe('85.5%');
    });

    it('supports custom decimal places', () => {
      expect(formatPercent(85.555, 2)).toBe('85.56%');
      expect(formatPercent(100, 0)).toBe('100%');
    });
  });

  describe('formatVIN', () => {
    it('formats a valid 17-character VIN', () => {
      expect(formatVIN('1HGBH41JXMN109186')).toBe('1HGBH 41JXMN1 09186');
    });

    it('returns uppercase for non-17-char input', () => {
      expect(formatVIN('abc123')).toBe('ABC123');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatVIN(null)).toBe('');
    });
  });

  describe('formatPlate', () => {
    it('uppercases and trims', () => {
      expect(formatPlate('  abc 123  ')).toBe('ABC 123');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatPlate(null)).toBe('');
    });
  });

  describe('formatName', () => {
    it('capitalizes and joins name parts', () => {
      expect(formatName('john', 'doe')).toBe('John Doe');
    });

    it('handles middle name', () => {
      expect(formatName('john', 'doe', 'wayne')).toBe('John Wayne Doe');
    });

    it('skips null parts', () => {
      expect(formatName('john', null)).toBe('John');
    });
  });

  describe('formatAddress', () => {
    it('formats a full address', () => {
      const result = formatAddress({
        address: '123 Main St',
        city: 'Salt Lake City',
        state: 'ut',
        zip: '84101',
      });
      expect(result).toBe('123 Main St, Salt Lake City, UT 84101');
    });

    it('handles missing parts', () => {
      expect(formatAddress({ address: '123 Main St' })).toBe('123 Main St');
    });
  });

  describe('truncate', () => {
    it('truncates with ellipsis when over limit', () => {
      expect(truncate('Hello World', 6)).toBe('Hello…');
    });

    it('returns original if within limit', () => {
      expect(truncate('Hi', 10)).toBe('Hi');
    });
  });

  describe('toTitleCase', () => {
    it('capitalizes first letter of each word', () => {
      expect(toTitleCase('hello world')).toBe('Hello World');
    });
  });

  describe('toDisplayLabel', () => {
    it('converts snake_case to Title Case', () => {
      expect(toDisplayLabel('active_warrant')).toBe('Active Warrant');
    });

    it('converts kebab-case to Title Case', () => {
      expect(toDisplayLabel('active-warrant')).toBe('Active Warrant');
    });

    it('uppercases known law enforcement acronyms', () => {
      expect(toDisplayLabel('pso_client_request')).toBe('PSO Client Request');
      expect(toDisplayLabel('cfs_priority')).toBe('CFS Priority');
      expect(toDisplayLabel('dv_incident')).toBe('DV Incident');
    });

    it('handles mixed acronyms and regular words', () => {
      expect(toDisplayLabel('bolo_alert_active')).toBe('BOLO Alert Active');
    });
  });

  describe('pluralize', () => {
    it('uses singular for count of 1', () => {
      expect(pluralize(1, 'warrant')).toBe('1 warrant');
    });

    it('uses default plural for other counts', () => {
      expect(pluralize(3, 'warrant')).toBe('3 warrants');
      expect(pluralize(0, 'warrant')).toBe('0 warrants');
    });

    it('uses custom plural when provided', () => {
      expect(pluralize(2, 'person', 'people')).toBe('2 people');
    });
  });

  describe('formatCoordinates', () => {
    it('formats coordinates with N/E for positive', () => {
      expect(formatCoordinates(40.7608, 111.891)).toBe('40.7608° N, 111.8910° E');
    });

    it('formats coordinates with S/W for negative', () => {
      expect(formatCoordinates(-33.8688, -111.891)).toBe('33.8688° S, 111.8910° W');
    });
  });

  describe('formatDistance', () => {
    it('formats short distances in meters', () => {
      expect(formatDistance(50)).toBe('50 m');
    });

    it('formats medium distances in miles with 1 decimal', () => {
      expect(formatDistance(1609)).toBe('1.0 mi');
    });

    it('formats long distances as rounded miles', () => {
      expect(formatDistance(32186)).toBe('20 mi');
    });
  });
});
