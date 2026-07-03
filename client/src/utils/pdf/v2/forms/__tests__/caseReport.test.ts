import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../../engine/renderer';
import { caseReportSchema, buildCaseReportSections, type CaseReportData } from '../caseReport';

function getDocText(doc: Awaited<ReturnType<typeof renderPdfV2>>): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

const BASE_DATA: CaseReportData = {
  caseRow: {
    case_number: '26-CR-00042',
    status: 'open',
    priority: 'high',
    case_type: 'burglary',
    lead_investigator_name: 'Det. Alvarez',
    opened_date: '2026-06-01',
    summary: 'Residential burglary, forced entry via rear door.',
  },
  persons: [{ last_name: 'Doe', first_name: 'John', role: 'suspect', date_of_birth: '1990-01-01', phone: '555-0100' }],
  evidence: [{ evidence_number: 'EV-1', description: 'Pry bar', evidence_type: 'tool', status: 'logged' }],
};

describe('caseReportSchema', () => {
  it('renders the case number in the header', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('26-CR-00042');
  });

  it('renders a bulleted row for each linked record', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).toContain('Doe');
    expect(text).toContain('Pry bar');
  });

  it('omits sections with zero records (no filler pages)', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).not.toContain('Linked Calls for Service');
    expect(text).not.toContain('Warrants');
  });

  it('re-exports buildCaseReportSections unchanged', () => {
    const sections = buildCaseReportSections(BASE_DATA);
    expect(sections.map((s) => s.key)).toEqual(['persons', 'evidence']);
  });

  it('renders the Overview cover fields the legacy generator showed (Priority label, Generated timestamp)', async () => {
    // This is a content-parity regression guard: the v2 migration is
    // visual/architecture-only, not a content redesign, so every field
    // the legacy caseReportGenerator.ts's Overview section showed must
    // still appear (the priority badge is additive, not a replacement
    // for the plain-text "PRIORITY" label+value the original always drew).
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).toContain('PRIORITY');
    expect(text).toContain('HIGH');
    expect(text).toContain('GENERATED');
  });
});
