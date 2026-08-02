import { describe, it, expect } from 'vitest';
import { reportKey, parseReportKey, reportFilename } from '../src/utils/dailyReport/store';

describe('report key scheme', () => {
  it('builds a year/month partitioned key', () => {
    expect(reportKey('2026-07-18')).toBe('daily-reports/2026/07/rmpg-daily-2026-07-18.pdf');
  });

  it('round-trips', () => {
    const k = reportKey('2026-07-18');
    expect(parseReportKey(k)).toEqual({
      date: '2026-07-18',
      filename: 'rmpg-daily-2026-07-18.pdf',
    });
  });

  it('exposes the bare filename the UI passes back', () => {
    expect(reportFilename('2026-07-18')).toBe('rmpg-daily-2026-07-18.pdf');
  });

  // The download route resolves user input through parseReportKey rather
  // than interpolating it, so traversal must be structurally rejected.
  it('rejects traversal and malformed input', () => {
    expect(parseReportKey('daily-reports/2026/07/../../../secret.pdf')).toBeNull();
    expect(parseReportKey('rmpg-daily-2026-07-18.txt')).toBeNull();
    expect(parseReportKey('rmpg-daily-not-a-date.pdf')).toBeNull();
    expect(parseReportKey('')).toBeNull();
    expect(parseReportKey('daily-reports/2026/07/rmpg-daily-2026-13-99.pdf')).toBeNull();
  });

  it('accepts a bare filename as well as a full key', () => {
    expect(parseReportKey('rmpg-daily-2026-07-18.pdf')?.date).toBe('2026-07-18');
  });
});
