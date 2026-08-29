import { describe, it, expect } from 'vitest';
import {
  wrapTranscriptLines,
  formatCallDuration,
  generateDialConnectCallPdf,
} from '../dialConnectCallPdf';

describe('formatCallDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatCallDuration(202)).toBe('3:22');
  });
  it('formats hours when needed', () => {
    expect(formatCallDuration(3661)).toBe('1:01:01');
  });
  it('returns em dash for missing', () => {
    expect(formatCallDuration(null)).toBe('—');
  });
});

describe('wrapTranscriptLines', () => {
  it('wraps at word boundaries', () => {
    expect(wrapTranscriptLines('one two three four', 10)).toEqual(['one two', 'three four']);
  });
});

describe('generateDialConnectCallPdf', () => {
  it('does not throw on a populated call with transcript', () => {
    expect(() => generateDialConnectCallPdf({
      recordingSid: 'REabcd1234',
      fromNumber: '+18015550100',
      toNumber: '+18015550999',
      direction: 'inbound',
      transcript: 'Need an officer at the retail corridor.',
      hasAudio: true,
      exportedBy: 'Marcus Reyes',
    })).not.toThrow();
  });

  it('does not throw when only the recording SID is present', () => {
    expect(() => generateDialConnectCallPdf({ recordingSid: 'REempty0001' })).not.toThrow();
  });

  it('does not throw on segmented transcription', () => {
    expect(() => generateDialConnectCallPdf({
      recordingSid: 'REabcd1234',
      segments: [
        { speaker: 'Caller', start: 0, text: 'I need an officer.' },
        { speaker: 'Dispatcher', start: 4, text: 'Copy, starting a call for service.' },
      ],
    })).not.toThrow();
  });
});
