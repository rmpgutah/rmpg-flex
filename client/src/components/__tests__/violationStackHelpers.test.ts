import { describe, it, expect } from 'vitest';
import { newDraft, totalFineOf, type ViolationDraft } from '../violationStackHelpers';

describe('newDraft', () => {
  it('returns a fresh draft with unique id and zeros/empties', () => {
    const a = newDraft();
    const b = newDraft();
    expect(a.id).not.toBe(b.id);
    expect(a.statute_citation).toBe('');
    expect(a.fine_amount).toBe(0);
    expect(a.offense_level).toBe('Infraction');
  });
});

describe('totalFineOf', () => {
  it('sums fine_amount across drafts, treating non-finite as 0', () => {
    const drafts: ViolationDraft[] = [
      { id: '1', statute_citation: 'a', description: '', offense_level: 'Infraction', fine_amount: 100 },
      { id: '2', statute_citation: 'b', description: '', offense_level: 'Infraction', fine_amount: 50.5 },
      { id: '3', statute_citation: 'c', description: '', offense_level: 'Infraction', fine_amount: NaN },
    ];
    expect(totalFineOf(drafts)).toBe(150.5);
  });
});
