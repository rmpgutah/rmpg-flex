import { describe, it, expect } from 'vitest';
import {
  formatSubjectName,
  summarizeHistory,
  type CriminalHistoryEntry,
} from '../criminalHistoryPdf';

describe('formatSubjectName', () => {
  it('renders Last, First Middle when all parts present', () => {
    expect(formatSubjectName({ last_name: 'Smith', first_name: 'John', middle_name: 'A' })).toBe('Smith, John A');
  });
  it('omits middle when blank', () => {
    expect(formatSubjectName({ last_name: 'Smith', first_name: 'John' })).toBe('Smith, John');
  });
  it('drops the comma when only first_name', () => {
    expect(formatSubjectName({ first_name: 'John' })).toBe('John');
  });
  it('drops the comma when only last_name', () => {
    expect(formatSubjectName({ last_name: 'Smith' })).toBe('Smith');
  });
  it('returns "Unknown Subject" when both names are blank', () => {
    expect(formatSubjectName({})).toBe('Unknown Subject');
    expect(formatSubjectName({ last_name: '', first_name: '' })).toBe('Unknown Subject');
  });
});

describe('summarizeHistory', () => {
  const make = (type: CriminalHistoryEntry['type']): CriminalHistoryEntry => ({
    id: String(Math.random()),
    type,
    date: '2026-06-21T00:00:00Z',
    reference_number: 'TEST',
    description: 'test',
    status: 'ok',
  });

  it('counts each category independently', () => {
    const counts = summarizeHistory([
      make('incident'), make('incident'),
      make('citation'),
      make('field_interview'),
      make('warrant'), make('warrant'), make('warrant'),
    ]);
    expect(counts).toEqual({
      incident: 2, citation: 1, field_interview: 1, warrant: 3, trespass: 0,
    });
  });
  it('returns zero counts for an empty list', () => {
    expect(summarizeHistory([])).toEqual({
      incident: 0, citation: 0, field_interview: 0, warrant: 0, trespass: 0,
    });
  });
  it('ignores unknown types without throwing', () => {
    const bogus = { ...make('incident'), type: 'unknown' } as unknown as CriminalHistoryEntry;
    const counts = summarizeHistory([bogus]);
    expect(counts.incident).toBe(0);
  });
});
