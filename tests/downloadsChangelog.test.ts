import { describe, it, expect } from 'vitest';
import { parseReleaseNoteRow } from '../src/routes/downloads';

describe('parseReleaseNoteRow', () => {
  it('splits multi-line notes into an array of bullet strings', () => {
    const row = { version: '5.8.5', release_date: '2026-07-22', notes: 'Added Kiosk Linux OS image\nFixed ALPR capture retry' };
    const result = parseReleaseNoteRow(row);
    expect(result).toEqual({
      version: '5.8.5',
      releaseDate: '2026-07-22',
      notes: ['Added Kiosk Linux OS image', 'Fixed ALPR capture retry'],
    });
  });

  it('filters out blank lines from notes', () => {
    const row = { version: '5.8.4', release_date: '2026-07-01', notes: 'First fix\n\nSecond fix\n' };
    const result = parseReleaseNoteRow(row);
    expect(result.notes).toEqual(['First fix', 'Second fix']);
  });

  it('returns an empty notes array when notes is an empty string', () => {
    const row = { version: '5.8.3', release_date: '2026-06-15', notes: '' };
    const result = parseReleaseNoteRow(row);
    expect(result.notes).toEqual([]);
  });
});
