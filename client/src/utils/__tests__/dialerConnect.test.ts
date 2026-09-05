import { describe, it, expect } from 'vitest';
import {
  DIALER_FUNCTIONS, VOICEMAIL_FUNCTIONS, CALL_HISTORY_FUNCTIONS,
  minFunctionCounts, displayPhone, formatDuration, pdfFilename, audioFilename,
  counterpartyNumber, clusterCounterparties,
} from '../dialerConnect';

describe('Dial Connect client catalogs', () => {
  it('ensures 10+ functions on Dialer, Voicemail, and Call History', () => {
    const counts = minFunctionCounts();
    expect(counts.dialer).toBeGreaterThanOrEqual(10);
    expect(counts.voicemail).toBeGreaterThanOrEqual(10);
    expect(counts.history).toBeGreaterThanOrEqual(10);
    expect(DIALER_FUNCTIONS.map((f) => f.id)).toContain('hangup');
    expect(VOICEMAIL_FUNCTIONS.map((f) => f.id)).toContain('csv');
    expect(CALL_HISTORY_FUNCTIONS.map((f) => f.id)).toContain('starred');
  });
  it('formats phones, durations, and export names', () => {
    expect(displayPhone('+18015550100')).toBe('(801) 555-0100');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(pdfFilename('voicemail', 9)).toBe('RMPG-DC-VM-9.pdf');
    expect(audioFilename('call', 3)).toBe('RMPG-DC-CALL-3.mp3');
  });
});

describe('counterpartyNumber / clusterCounterparties', () => {
  it('uses the direction-appropriate number and falls back to whichever number exists', () => {
    expect(counterpartyNumber({ direction: 'outbound', from_number: '+18015550001', to_number: '+13855550002' })).toBe('+13855550002');
    expect(counterpartyNumber({ direction: 'inbound', from_number: '+18015550001', to_number: '+13855550002' })).toBe('+18015550001');
    expect(counterpartyNumber({ direction: 'inbound', from_number: null, to_number: '+13855550002' })).toBe('+13855550002');
    expect(counterpartyNumber({ direction: 'outbound', from_number: '+18015550001', to_number: '' })).toBe('+18015550001');
    expect(counterpartyNumber({ direction: 'inbound' })).toBe('');
  });
  it('never clusters rows without a number and orders clusters by size', () => {
    const rows = [
      { direction: 'inbound', from_number: null },
      { direction: 'inbound', from_number: null },
      { direction: 'inbound', from_number: '+18015550001' },
      { direction: 'outbound', to_number: '(801) 555-0001' },
      { direction: 'inbound', from_number: '+13855550002' },
    ];
    expect(clusterCounterparties(rows)).toEqual([['8015550001', 2]]);
  });
});
