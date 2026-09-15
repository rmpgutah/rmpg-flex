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
  voicemailsToCsv,
  timingSafeEqual,
  assertMinFunctions,
  DIALER_FUNCTIONS,
  VOICEMAIL_FUNCTIONS,
  CALL_HISTORY_FUNCTIONS,
  isAllowedRecordingSourceUrl,
  ingestCallFields,
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
  it('exports voicemail without extra identity columns', () => {
    const csv = voicemailsToCsv([{ id: 9, from_number: '+18015550100', transcript: 'call me', urgency: 'urgent' }]);
    expect(csv).toContain('call me');
    expect(csv.split('\r\n')[0]).toContain('from_number');
  });
  it('compares secrets in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('ab', 'abc')).toBe(false);
  });
});

describe('isAllowedRecordingSourceUrl', () => {
  it('allows Dial Connect and Twilio HTTPS hosts only', () => {
    expect(isAllowedRecordingSourceUrl('https://dialer.rmpgutah.us/rec/3.mp3')).toBe(true);
    expect(isAllowedRecordingSourceUrl('https://api.twilio.com/2010-04-01/Accounts/ACxx/Recordings/RE123')).toBe(true);
    expect(isAllowedRecordingSourceUrl('https://recordings.twilio.com/x')).toBe(true);
    expect(isAllowedRecordingSourceUrl('https://evil.example/steal')).toBe(false);
    expect(isAllowedRecordingSourceUrl('http://dialer.rmpgutah.us/rec/3.mp3')).toBe(false);
    expect(isAllowedRecordingSourceUrl('not-a-url')).toBe(false);
  });
});

describe('ingestCallFields (event → row mapping)', () => {
  it('leaves direction and status null when the event omits them so COALESCE keeps stored values', () => {
    const f = ingestCallFields({ callSid: 'CA1', recordingUrl: 'https://dialer.rmpgutah.us/r.mp3' });
    expect(f.callSid).toBe('CA1');
    expect(f.direction).toBeNull();
    expect(f.status).toBeNull();
    expect(f.fromNumber).toBeNull();
    expect(f.toNumber).toBeNull();
    expect(f.duration).toBeNull();
    expect(f.recordingUrl).toBe('https://dialer.rmpgutah.us/r.mp3');
  });
  it('normalizes numbers, accepts camelCase and snake_case, and rejects unknown enums', () => {
    const f = ingestCallFields({
      call_sid: ' CA2 ', direction: 'sideways', status: 'weird',
      from: '(801) 555-0100', to_number: '+13855550100', duration_seconds: '42',
      dispatcherName: 'Zamora',
    });
    expect(f.callSid).toBe('CA2');
    expect(f.direction).toBeNull();
    expect(f.status).toBeNull();
    expect(f.fromNumber).toBe('+18015550100');
    expect(f.toNumber).toBe('+13855550100');
    expect(f.duration).toBe(42);
    expect(f.agentName).toBe('Zamora');
  });
  it('keeps valid direction/status and treats a blank sid as absent', () => {
    const f = ingestCallFields({ callSid: '   ', direction: 'outbound', status: 'failed' });
    expect(f.callSid).toBeNull();
    expect(f.direction).toBe('outbound');
    expect(f.status).toBe('failed');
  });
});
