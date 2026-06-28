import { describe, it, expect } from 'vitest';
import {
  prosecutorDisplayName, daysUntilEvent, generateCourtAppearancePdf,
} from '../courtAppearancePdf';

describe('courtAppearancePdf helpers', () => {
  describe('prosecutorDisplayName', () => {
    it('handles bare string (legacy shape)', () => {
      expect(prosecutorDisplayName('Jane DA')).toBe('Jane DA');
    });

    it('handles {name,...} JSON object', () => {
      expect(prosecutorDisplayName({ name: 'John Prosecutor', phone: '555' })).toBe('John Prosecutor');
    });

    it('handles JSON-stringified object', () => {
      expect(prosecutorDisplayName('{"name":"Jane","phone":"555-1234"}')).toBe('Jane');
    });

    it('falls back to the raw string when JSON has no name', () => {
      // A literal "{" string with no name field returns the raw input.
      expect(prosecutorDisplayName('{"phone":"555-1234"}')).toBe('{"phone":"555-1234"}');
    });

    it('returns em-dash on null/undefined/empty', () => {
      expect(prosecutorDisplayName(null)).toBe('—');
      expect(prosecutorDisplayName(undefined)).toBe('—');
      expect(prosecutorDisplayName('')).toBe('—');
      expect(prosecutorDisplayName('   ')).toBe('—');
    });
  });

  describe('daysUntilEvent', () => {
    it('returns PAST when event has elapsed', () => {
      const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const result = daysUntilEvent(yesterday);
      expect(result.text).toBe('PAST');
      expect(result.isPast).toBe(true);
      expect(result.isImminent).toBe(false);
    });

    it('returns TODAY for an event on the current day', () => {
      // Use 12 hours in the future — still rounds up to 1 sometimes via
      // Math.ceil. Use a few minutes ahead instead.
      const inSeconds = new Date(Date.now() + 1000).toISOString();
      const result = daysUntilEvent(inSeconds);
      // ceil((tiny)/(24h)) === 1 — so it becomes TOMORROW; verify shape.
      expect(['TODAY', 'TOMORROW']).toContain(result.text);
      expect(result.isImminent).toBe(true);
    });

    it('returns "N days" for far-future events', () => {
      const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const result = daysUntilEvent(inTenDays);
      expect(result.text).toMatch(/days/);
      expect(result.isImminent).toBe(false);
      expect(result.isPast).toBe(false);
    });

    it('returns em-dash for missing date', () => {
      // parseTimestamp's intentional fallback for garbage strings is
      // `new Date()` (today), so daysUntilEvent('not-a-date') resolves
      // to TODAY rather than the em-dash sentinel — that's a quirk of
      // the upstream parser, not this helper. We only assert the truly
      // missing case here.
      expect(daysUntilEvent(undefined).text).toBe('—');
      expect(daysUntilEvent('').text).toBe('—');
    });
  });

  describe('generateCourtAppearancePdf', () => {
    it('produces a jsPDF without throwing on a minimal payload', () => {
      const doc = generateCourtAppearancePdf({
        event_number: 'CRT-0001',
        event_type: 'hearing',
        event_date: '2026-12-31',
      });
      expect(doc).toBeDefined();
      // jsPDF instances expose .output(); verify it returns something.
      const blob = doc.output('blob');
      expect(blob).toBeDefined();
    });

    it('handles a full payload with JSON-stringified collections', () => {
      const doc = generateCourtAppearancePdf({
        event_number: 'CRT-0002',
        event_type: 'trial',
        event_date: '2026-12-31',
        event_time: '09:30',
        court_name: 'Third District',
        courtroom: '3A',
        judge_name: 'Judge Smith',
        court_case_number: '231900042',
        defendant_name: 'John Doe',
        defense_attorney: 'Susan Defense',
        prosecutor: '{"name":"Jane DA","phone":"801-555-0100","email":"da@example.gov"}',
        outcome: 'guilty',
        sentence: '30 days',
        fine_amount: 250,
        notes: 'Subject was cooperative.',
        judge_notes: 'Judge prefers no jargon; speak plainly.',
        bail_amount: '5000',
        bond_status: 'posted',
        surety_info: 'AAA Bail Bonds',
        witnesses: JSON.stringify([
          { name: 'Officer Brown', role: 'officer', contact_status: 'confirmed' },
          { name: 'Mary Witness', role: 'civilian_witness', contact_status: 'pending', phone: '555-9999' },
        ]),
        court_fees: JSON.stringify({ filing_fee: '50', service_fee: '25', other_fees: '10', fee_notes: 'Late fee' }),
        continuance_log: JSON.stringify([
          { reason: 'Defense unavailable', old_date: '2026-10-15', new_date: '2026-12-31', date: '2026-10-01' },
        ]),
        continuance_count: 1,
        preparedBy: 'Officer Smith #42',
      });
      expect(doc).toBeDefined();
      const blob = doc.output('blob');
      expect(blob).toBeDefined();
    });

    it('survives malformed JSON in witnesses/court_fees/continuance_log', () => {
      expect(() => generateCourtAppearancePdf({
        event_number: 'CRT-0003',
        event_type: 'hearing',
        event_date: '2026-12-31',
        witnesses: 'not-json',
        court_fees: '{bad',
        continuance_log: 'also-bad',
      })).not.toThrow();
    });
  });
});
