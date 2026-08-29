import { describe, it, expect } from 'vitest';
import {
  normalizeDialNumber,
  last10Digits,
  classifyVmUrgency,
  isMissedCall,
  matchesHistoryFilters,
  clusterDuplicates,
  formatDuration,
  parseTagList,
  serializeTags,
  callsToCsv,
  timingSafeEqual,
  assertMinFunctions,
  DIALER_FUNCTIONS,
  VOICEMAIL_FUNCTIONS,
  CALL_HISTORY_FUNCTIONS,
} from '../src/utils/dialerConnect';

describe('Dial Connect function catalogs', () => {
  it('pins at least 10 functions on each surface', () => {
    const counts = assertMinFunctions();
    expect(counts.dialer).toBeGreaterThanOrEqual(10);
    expect(counts.voicemail).toBeGreaterThanOrEqual(10);
    expect(counts.history).toBeGreaterThanOrEqual(10);
    expect(DIALER_FUNCTIONS).toHaveLength(counts.dialer);
    expect(VOICEMAIL_FUNCTIONS).toHaveLength(counts.voicemail);
    expect(CALL_HISTORY_FUNCTIONS).toHaveLength(counts.history);
  });
});

describe('normalizeDialNumber', () => {
  it('prefixes 10-digit US numbers', () => {
    expect(normalizeDialNumber('(801) 555-0100')).toBe('+18015550100');
  });
  it('keeps explicit plus', () => {
    expect(normalizeDialNumber('+18015550100')).toBe('+18015550100');
  });
  it('returns empty for blank', () => {
    expect(normalizeDialNumber('')).toBe('');
    expect(normalizeDialNumber(null)).toBe('');
  });
});

describe('classifyVmUrgency', () => {
  it('flags emergency language', () => {
    expect(classifyVmUrgency('This is an emergency please call 911')).toBe('emergency');
  });
  it('flags urgent callback language', () => {
    expect(classifyVmUrgency('Call me back ASAP')).toBe('urgent');
  });
  it('defaults to normal', () => {
    expect(classifyVmUrgency('Please call when you can')).toBe('normal');
  });
});

describe('history filters and duplicates', () => {
  it('filters missed-only', () => {
    expect(isMissedCall('missed')).toBe(true);
    expect(matchesHistoryFilters({ status: 'completed', direction: 'inbound' }, { missedOnly: true })).toBe(false);
    expect(matchesHistoryFilters({ status: 'missed', direction: 'inbound' }, { missedOnly: true })).toBe(true);
  });
  it('matches last-10 digits in a search', () => {
    expect(last10Digits('+1 (801) 555-0100')).toBe('8015550100');
    expect(matchesHistoryFilters(
      { from_number: '+18015550100', direction: 'inbound' },
      { q: '555-0100' },
    )).toBe(true);
  });
  it('clusters counterparties with 2+ hits', () => {
    const clusters = clusterDuplicates([
      { from_number: '+18015550100', direction: 'inbound', started_at: '2026-08-01' },
      { from_number: '8015550100', direction: 'inbound', started_at: '2026-08-02' },
      { to_number: '+18015550999', direction: 'outbound', started_at: '2026-08-02' },
    ]);
    expect(clusters).toEqual([{ key: '8015550100', count: 2, lastAt: '2026-08-02' }]);
  });
});

describe('formatDuration / tags / csv / hmac compare', () => {
  it('formats seconds', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(65)).toBe('1m 05s');
    expect(formatDuration(null)).toBe('—');
  });
  it('round-trips tags', () => {
    expect(parseTagList(serializeTags([' warrant ', 'warrant', 'cfs']))).toEqual(['warrant', 'cfs']);
  });
  it('csv-escapes quotes', () => {
    const csv = callsToCsv([{ id: 1, notes: 'said "hello", then hung up' }]);
    expect(csv).toContain('"said ""hello"", then hung up"');
  });
  it('compares secrets in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('ab', 'abc')).toBe(false);
  });
});
