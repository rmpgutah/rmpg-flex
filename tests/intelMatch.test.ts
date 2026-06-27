import { describe, it, expect } from 'vitest';
import {
  isRealValue, normalizePhone, normalizeAddress, nameSimilarity,
  sniffIdentifiers, toFtsQuery,
} from '../src/utils/intelMatch';

describe('isRealValue (sentinel-string guard)', () => {
  it('rejects live sentinel strings', () => {
    for (const v of [null, undefined, '', '  ', 'None', 'N/A', 'na', 'NULL', '0', 'Unknown'])
      expect(isRealValue(v)).toBe(false);
  });
  it('accepts real values', () => {
    for (const v of ['John', '801-555-1234', '1990-01-01']) expect(isRealValue(v)).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('strips formatting and leading 1', () => {
    expect(normalizePhone('(801) 555-1234')).toBe('8015551234');
    expect(normalizePhone('+1 801 555 1234')).toBe('8015551234');
  });
});

describe('normalizeAddress', () => {
  it('canonicalizes suffixes and drops unit numbers', () => {
    expect(normalizeAddress('123 Main Street, Apt 4')).toBe('123 main st');
    expect(normalizeAddress('123 MAIN ST')).toBe('123 main st');
  });
});

describe('nameSimilarity', () => {
  it('is order-insensitive and tolerant of middle names', () => {
    expect(nameSimilarity('John A Smith', 'Smith John')).toBe(1);
    expect(nameSimilarity('John Smith', 'Jane Doe')).toBe(0);
  });
  it('returns 0 for empty input', () => {
    expect(nameSimilarity('', 'John')).toBe(0);
  });
});

describe('sniffIdentifiers', () => {
  it('detects phones', () => {
    expect(sniffIdentifiers('801-555-1234')).toContainEqual({ kind: 'phone', value: '8015551234' });
  });
  it('detects DOBs in both formats, normalizing to ISO', () => {
    expect(sniffIdentifiers('1990-01-02')).toContainEqual({ kind: 'dob', value: '1990-01-02' });
    expect(sniffIdentifiers('1/2/1990')).toContainEqual({ kind: 'dob', value: '1990-01-02' });
  });
  it('detects VINs and plates', () => {
    expect(sniffIdentifiers('1HGCM82633A004352')).toContainEqual({ kind: 'vin', value: '1HGCM82633A004352' });
    expect(sniffIdentifiers('abc123')).toContainEqual({ kind: 'plate', value: 'ABC123' });
  });
  it('detects record numbers', () => {
    expect(sniffIdentifiers('CFS-1042')).toContainEqual({ kind: 'record_number', value: 'CFS-1042' });
    expect(sniffIdentifiers('2026-00123')).toContainEqual({ kind: 'record_number', value: '2026-00123' });
  });
  it('returns nothing for plain names', () => {
    expect(sniffIdentifiers('john smith')).toEqual([]);
  });
});

describe('toFtsQuery', () => {
  it('quotes tokens and adds prefix-* to the last', () => {
    expect(toFtsQuery('john smith')).toBe('"john" "smith"*');
  });
  it('strips FTS operators that would throw', () => {
    expect(toFtsQuery('a"b (c)*')).toBe('"a" "b" "c"*');
  });
  it('returns null for empty input', () => {
    expect(toFtsQuery('  ')).toBeNull();
  });
});
