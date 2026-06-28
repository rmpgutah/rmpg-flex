// Smoke test for the law-book PDF generator: it must actually render a valid,
// multi-page-capable document (typecheck/build don't execute jsPDF), including
// the plain-language box + the outline body, without throwing.
import { describe, it, expect } from 'vitest';
import { buildStatuteDoc } from '../statutePdfGenerator';
import type { StatuteResult } from '../../components/StatuteLookup';

const section: StatuteResult = {
  id: 1,
  citation: '76-5-102',
  short_title: 'Assault',
  description:
    '(1) (a) As used in this section, "chokehold" means a hold using an arm.' +
    '(b) Terms defined in Section 76-1-101.5 apply.' +
    '(2) An actor commits assault if the actor:(a) attempts to inflict injury; or(b) commits an act with unlawful force.',
  offense_level: 'class_a_misdemeanor',
  category: 'criminal',
  subcategory: 'Offenses Against the Individual',
  part_name: 'Assault and Related Offenses',
  effective_date: '5/6/2026',
  source_url: 'https://le.utah.gov/xcode/Title76/Chapter5/76-5-S102.html',
  plain_summary: 'It is assault to try to hurt someone with unlawful force or to threaten imminent violence.',
  plain_elements: ['Applies to any actor', 'Class A misdemeanor base offense', 'Chokehold is specially defined'],
};

describe('statute PDF generator', () => {
  it('renders a single-section document', () => {
    const doc = buildStatuteDoc({ docTitle: section.citation, subtitle: section.short_title, sections: [section] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer') as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('paginates a long chapter without throwing', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...section, id: i + 1, citation: `76-5-${100 + i}` }));
    const doc = buildStatuteDoc({ docTitle: '76-5 · Offenses Against the Individual', subtitle: '30 sections', sections: many });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('handles a section with no plain-language summary', () => {
    const bare: StatuteResult = { ...section, plain_summary: null, plain_elements: null };
    const doc = buildStatuteDoc({ docTitle: bare.citation, sections: [bare] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
