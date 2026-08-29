import { describe, it, expect } from 'vitest';
import {
  generateDialerCallRecordPdf,
  hasRecording,
  fmtMt,
  type DialerRecordForPdf,
} from '../dialerCallRecordPdf';

function rec(overrides: Partial<DialerRecordForPdf> = {}): DialerRecordForPdf {
  return {
    id: 42,
    kind: 'call',
    call_sid: 'CA123',
    direction: 'inbound',
    status: 'completed',
    from_number: '+18015550100',
    from_name: 'Jane Caller',
    to_number: '+18015550999',
    agent_name: 'Disp. Rivera',
    started_at: '2026-08-29T12:00:00Z',
    duration_seconds: 93,
    transcript: 'Caller reported a prowler at 400 W. Requested a unit.',
    transcript_status: 'ready',
    recording_r2_key: 'dialer-connect/call/42/1',
    ...overrides,
  };
}

describe('dialerCallRecordPdf', () => {
  it('treats r2 key or source url as a recording on file', () => {
    expect(hasRecording(rec())).toBe(true);
    expect(hasRecording(rec({ recording_r2_key: null, recording_source_url: 'https://example' }))).toBe(true);
    expect(hasRecording(rec({ recording_r2_key: null, recording_source_url: null }))).toBe(false);
  });

  it('formats mountain time with an MT suffix', () => {
    expect(fmtMt('2026-08-29T18:00:00Z')).toMatch(/MT$/);
    expect(fmtMt(null)).toBe('—');
  });

  it('builds a multi-page-safe letter PDF for a call transcript', () => {
    const doc = generateDialerCallRecordPdf({ record: rec(), exportedBy: 'J. Rivera' });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.internal.pageSize.getWidth()).toBe(612);
  });

  it('builds a voicemail PDF with emergency banner copy in the payload', () => {
    const doc = generateDialerCallRecordPdf({
      record: rec({
        kind: 'voicemail',
        urgency: 'emergency',
        mailbox: 'Dispatch',
        transcript: 'Officer down — send help.',
      }),
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
