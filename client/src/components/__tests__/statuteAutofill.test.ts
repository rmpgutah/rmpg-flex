import { describe, it, expect } from 'vitest';
import { applyStatuteAutofill, type StatuteRow } from '../statuteAutofill';
import { newDraft } from '../violationStackHelpers';

const STATUTE: StatuteRow = {
  id: 1, citation_code: 'UCA 41-6a-601', title: 'Speed Limits',
  offense_level: 'Infraction', default_fine: 175, description: 'Speed limit violation',
};

describe('applyStatuteAutofill', () => {
  it('fills empty description, level, fine from statute', () => {
    const draft = newDraft();
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.statute_id).toBe(1);
    expect(out.statute_citation).toBe('UCA 41-6a-601');
    expect(out.description).toBe('Speed limit violation');
    expect(out.offense_level).toBe('Infraction');
    expect(out.fine_amount).toBe(175);
  });

  it('keeps officer-edited description (non-empty)', () => {
    const draft = { ...newDraft(), description: 'Custom note' };
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.description).toBe('Custom note');
  });

  it('keeps officer-edited fine (non-zero)', () => {
    const draft = { ...newDraft(), fine_amount: 50 };
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.fine_amount).toBe(50);
  });
});
