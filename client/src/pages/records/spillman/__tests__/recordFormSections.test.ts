import { describe, it, expect } from 'vitest';
import { RECORD_FORM_SECTIONS } from '../recordFormSections';
import { sectionAnchorId } from '../../../../utils/sectionAnchor';

describe('RECORD_FORM_SECTIONS', () => {
  it('defines sections for the persons tab whose ids match real section titles', () => {
    const persons = RECORD_FORM_SECTIONS.persons;
    expect(persons.length).toBeGreaterThan(0);
    expect(persons.find(s => s.target === sectionAnchorId('Physical Description'))).toBeTruthy();
  });

  it('every section has a label and an spm-sec target', () => {
    Object.values(RECORD_FORM_SECTIONS).flat().forEach((s) => {
      expect(s.label).toBeTruthy();
      expect(s.target.startsWith('spm-sec-')).toBe(true);
    });
  });
});
