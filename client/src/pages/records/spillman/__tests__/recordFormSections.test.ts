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

  it('defines navigational sections for every non-empty record type', () => {
    for (const tab of ['vehicles', 'properties', 'businesses', 'evidence'] as const) {
      expect(RECORD_FORM_SECTIONS[tab].length).toBeGreaterThan(0);
    }
    expect(
      RECORD_FORM_SECTIONS.vehicles.find(s => s.target === sectionAnchorId('Vehicle Details')),
    ).toBeTruthy();
    expect(
      RECORD_FORM_SECTIONS.properties.find(s => s.target === sectionAnchorId('Security & Access')),
    ).toBeTruthy();
    expect(
      RECORD_FORM_SECTIONS.businesses.find(s => s.target === sectionAnchorId('Business Information')),
    ).toBeTruthy();
    expect(
      RECORD_FORM_SECTIONS.evidence.find(s => s.target === sectionAnchorId('Collection & Storage')),
    ).toBeTruthy();
  });

  it('omits sections whose detail-panel title carries a dynamic count', () => {
    // "Incident History (N)" / "Chain of Custody (N)" slugs are unstable, so
    // the static map must not reference the count-free base title either.
    const allTargets = Object.values(RECORD_FORM_SECTIONS).flat().map(s => s.target);
    expect(allTargets).not.toContain(sectionAnchorId('Incident History'));
    expect(allTargets).not.toContain(sectionAnchorId('Chain of Custody'));
  });
});
