import { describe, it, expect } from 'vitest';
import { formToData } from '../citationFormAdapter';
import { newDraft } from '../violationStackHelpers';

describe('formToData', () => {
  it('maps flat form fields to CitationData when violations is empty', () => {
    const data = formToData(
      { citation_number: 'C-1', type: 'traffic', statute_citation: 'X', fine_amount: 100 } as any,
      [],
    );
    expect(data.citation_number).toBe('C-1');
    expect(data.statute_citation).toBe('X');
    expect(data.violations).toBeUndefined();
  });

  it('includes violations array when present', () => {
    const v = [{ ...newDraft(), statute_citation: 'A', fine_amount: 25, description: 'a' }];
    const data = formToData({ citation_number: 'C-2' } as any, v);
    expect(data.violations).toHaveLength(1);
    expect(data.violations![0].statute_citation).toBe('A');
  });

  it('strips client-only id from violations', () => {
    const v = [{
      id: 'client-uuid',
      statute_citation: 'A', description: '',
      offense_level: 'Infraction' as const, fine_amount: 0,
    }];
    const data = formToData({} as any, v);
    expect((data.violations![0] as any).id).toBeUndefined();
  });
});
