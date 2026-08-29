import { describe, it, expect } from 'vitest';
import {
  DIALER_FUNCTIONS, VOICEMAIL_FUNCTIONS, CALL_HISTORY_FUNCTIONS,
  minFunctionCounts, displayPhone, formatDuration, pdfFilename, audioFilename,
} from '../dialerConnect';

describe('Dial Connect client catalogs', () => {
  it('ensures 10+ functions on Dialer, Voicemail, and Call History', () => {
    const counts = minFunctionCounts();
    expect(counts.dialer).toBeGreaterThanOrEqual(10);
    expect(counts.voicemail).toBeGreaterThanOrEqual(10);
    expect(counts.history).toBeGreaterThanOrEqual(10);
    expect(DIALER_FUNCTIONS.map((f) => f.id)).toContain('record');
    expect(VOICEMAIL_FUNCTIONS.map((f) => f.id)).toContain('print_pdf');
    expect(CALL_HISTORY_FUNCTIONS.map((f) => f.id)).toContain('download_audio');
  });
  it('formats phones, durations, and export names', () => {
    expect(displayPhone('+18015550100')).toBe('(801) 555-0100');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(pdfFilename('voicemail', 9)).toBe('RMPG-DC-VM-9.pdf');
    expect(audioFilename('call', 3)).toBe('RMPG-DC-CALL-3.mp3');
  });
});
