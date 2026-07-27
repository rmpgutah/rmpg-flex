// ============================================================
// withZone — zone labelling on printed attempt times
// ============================================================
// Notices are recipient- and court-facing, and serve jobs routinely cross
// jurisdictions (the Clough notice is a Utah address served for a Queens
// County, NY case). A bare "07:35" does not say Mountain or Eastern, and the
// reader cannot resolve it -- the same ambiguity that produced the 6-hour
// regression this very column suffered.
// ============================================================

import { describe, it, expect } from 'vitest';
import { withZone } from '../servePdfGenerator';

describe('withZone', () => {
  it('stamps the display zone onto a bare 24h time', () => {
    expect(withZone('07:35')).toBe('07:35 MT');
    expect(withZone('19:52')).toBe('19:52 MT');
  });

  it('leaves empty empty so the caller EMPTY placeholder still applies', () => {
    expect(withZone('')).toBe('');
    expect(withZone('   ')).toBe('');
    expect(withZone(undefined as unknown as string)).toBe('');
  });

  it('never double-stamps a value that already carries a zone', () => {
    expect(withZone('07:35 MT')).toBe('07:35 MT');
    expect(withZone('07:35 MDT')).toBe('07:35 MDT');
    expect(withZone('07:35 MST')).toBe('07:35 MST');
  });

  it('leaves 12-hour times alone — AM/PM already disambiguates the reading', () => {
    expect(withZone('7:35 AM')).toBe('7:35 AM');
    expect(withZone('7:35 PM')).toBe('7:35 PM');
  });

  it('trims incidental whitespace', () => {
    expect(withZone('  07:35  ')).toBe('07:35 MT');
  });
});
