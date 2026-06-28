import { describe, it, expect } from 'vitest';
import { extractPlateTokens, extractPhoneTokens, findNameMentions } from '../src/utils/intelExtract';

describe('extractPlateTokens', () => {
  it('finds plate-shaped tokens (alnum with digit, 5-8 chars)', () => {
    expect(extractPlateTokens('white truck plate ABC1234 fled north')).toEqual(['ABC1234']);
    expect(extractPlateTokens('UT plate g42 kxr seen')).toEqual([]); // spaced — not a token
  });
  it('ignores plain words and pure numbers under 5 digits', () => {
    expect(extractPlateTokens('male subject ran from the 7300 block')).toEqual([]);
  });
  it('dedupes', () => {
    expect(extractPlateTokens('ABC123 again ABC123')).toEqual(['ABC123']);
  });
});

describe('extractPhoneTokens', () => {
  it('finds and normalizes phone numbers', () => {
    expect(extractPhoneTokens('caller at (801) 555-1234 reports')).toEqual(['8015551234']);
    expect(extractPhoneTokens('call 1-801-555-1234')).toEqual(['8015551234']);
  });
  it('ignores short digit runs', () => {
    expect(extractPhoneTokens('case 2026-00123')).toEqual([]);
  });
});

describe('findNameMentions', () => {
  const persons = [
    { id: 1, first_name: 'John', last_name: 'Smith' },
    { id: 2, first_name: 'Maria', last_name: 'Del Toro' },
  ];
  it('matches "First Last" case-insensitively', () => {
    expect(findNameMentions('contact with JOHN SMITH at the door', persons)).toEqual([1]);
  });
  it('matches "Last, First"', () => {
    expect(findNameMentions('subject identified as Smith, John', persons)).toEqual([1]);
  });
  it('handles multi-word last names and returns multiple ids', () => {
    expect(findNameMentions('Maria Del Toro arrived with John Smith', persons).sort()).toEqual([1, 2]);
  });
  it('does not match partial names', () => {
    expect(findNameMentions('Johnny Smithers was present', persons)).toEqual([]);
  });
});
