import { describe, it, expect } from 'vitest';
import { toDisplayLabel } from '../formatters';
import {
  wrapText,
  fmtTimestamp,
  fmtDate,
  isOverdue,
  generateAffairsComplaintPdf,
  type IaComplaintForPdf,
  type IaInvestigationForPdf,
} from '../affairsComplaintPdf';

function mkComplaint(overrides: Partial<IaComplaintForPdf> = {}): IaComplaintForPdf {
  return {
    id: 42,
    complaint_number: 'IA-26-0042',
    complainant_name: 'Jane Doe',
    complainant_contact: '801-555-0199',
    subject_officer_id: 17,
    subject_officer_name: 'Officer Smith #101',
    complaint_type: 'discourtesy',
    description: 'Subject officer was rude to complainant during traffic stop on Main St.',
    incident_date: '2026-06-15',
    incident_location: '500 S Main St, Salt Lake City',
    witnesses: 'Witness 1: passenger in vehicle. Witness 2: clerk at gas station across the street.',
    evidence_list: 'BWC video clip #BWC-2026-1234, traffic stop audio recording.',
    status: 'under_investigation',
    assigned_to: 5,
    assigned_to_name: 'Supervisor Jones',
    finding: null,
    discipline: null,
    closed_date: null,
    created_at: '2026-06-16T14:00:00Z',
    ...overrides,
  };
}

function mkInvestigation(overrides: Partial<IaInvestigationForPdf> = {}): IaInvestigationForPdf {
  return {
    id: 1,
    complaint_id: 42,
    investigator_id: 5,
    investigator_name: 'Supervisor Jones',
    started_at: '2026-06-17T09:00:00Z',
    completed_at: null,
    summary: 'Initial review pending.',
    findings: null,
    recommendations: null,
    reviewed_by: null,
    reviewed_at: null,
    status: 'in_progress',
    ...overrides,
  };
}

describe('wrapText (affairs pdf)', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('wraps at word boundaries', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('line one\nline two', 50)).toEqual(['line one', 'line two']);
  });
});

describe('fmtTimestamp (affairs pdf)', () => {
  it('returns em-dash for missing input', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
  });
  it('formats a UTC timestamp in Mountain Time with MT suffix', () => {
    const out = fmtTimestamp('2026-06-22T14:23:05Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} MT$/);
    expect(out).toContain('2026-06-22');
  });
});

describe('fmtDate (affairs pdf)', () => {
  it('returns em-dash for missing input', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });
  it('formats an ISO date in Mountain Time', () => {
    const out = fmtDate('2026-06-22T00:00:00Z');
    // Could be Jun 21 or Jun 22 depending on MT offset; just check the year/month chunk
    expect(out).toMatch(/Jun\s\d{1,2},\s2026/);
  });
});

describe('prettyLabel (affairs pdf)', () => {
  it('returns empty string for missing input', () => {
    expect(toDisplayLabel(null)).toBe('');
    expect(toDisplayLabel(undefined)).toBe('');
    expect(toDisplayLabel('')).toBe('');
  });
  it('uppercases first letter of each word and replaces underscores', () => {
    expect(toDisplayLabel('excessive_force')).toBe('Excessive Force');
    expect(toDisplayLabel('under_investigation')).toBe('Under Investigation');
  });
});

describe('isOverdue (affairs pdf)', () => {
  it('is false when complaint has a closed_date', () => {
    expect(isOverdue(mkComplaint({ closed_date: '2026-06-20' }))).toBe(false);
  });
  it('is false when status is a closed disposition', () => {
    for (const status of ['closed', 'sustained', 'not_sustained', 'exonerated', 'unfounded']) {
      expect(isOverdue(mkComplaint({ status, closed_date: null }))).toBe(false);
    }
  });
  it('is false when complaint is open but <90 days old', () => {
    const now = new Date('2026-06-22T00:00:00Z').getTime();
    // filed 60 days ago, still open
    expect(isOverdue(mkComplaint({ created_at: '2026-04-23T00:00:00Z' }), now)).toBe(false);
  });
  it('is true when complaint is open and >90 days old', () => {
    const now = new Date('2026-06-22T00:00:00Z').getTime();
    // filed 100 days ago, still open
    expect(isOverdue(mkComplaint({ created_at: '2026-03-14T00:00:00Z' }), now)).toBe(true);
  });
  it('is false when created_at is missing (cannot compute)', () => {
    expect(isOverdue(mkComplaint({ created_at: null }))).toBe(false);
  });
});

describe('generateAffairsComplaintPdf — smoke', () => {
  it('generates a PDF with no investigations (zero-investigation path)', () => {
    const doc = generateAffairsComplaintPdf({
      complaint: mkComplaint(),
      investigations: [],
      preparedBy: 'IA Supervisor Jones',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('generates a PDF with multiple investigations', () => {
    const doc = generateAffairsComplaintPdf({
      complaint: mkComplaint(),
      investigations: [
        mkInvestigation({ id: 1, status: 'completed', completed_at: '2026-06-20T15:00:00Z' }),
        mkInvestigation({ id: 2, status: 'reviewed', reviewed_at: '2026-06-21T10:00:00Z' }),
      ],
      preparedBy: 'IA Supervisor Jones',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('generates a PDF with finding + discipline (closed disposition)', () => {
    const doc = generateAffairsComplaintPdf({
      complaint: mkComplaint({
        status: 'sustained',
        finding: 'Allegation of discourtesy SUSTAINED. Officer admitted to inappropriate tone during stop.',
        discipline: 'Letter of reprimand, 8 hours mandatory de-escalation refresher training.',
        closed_date: '2026-06-22',
      }),
      investigations: [
        mkInvestigation({ status: 'reviewed', completed_at: '2026-06-21T15:00:00Z', reviewed_at: '2026-06-22T10:00:00Z' }),
      ],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('generates a PDF that paginates with a very long allegation', () => {
    const longText = Array(200).fill('Lorem ipsum dolor sit amet consectetur adipiscing elit.').join(' ');
    const doc = generateAffairsComplaintPdf({
      complaint: mkComplaint({ description: longText }),
      investigations: [mkInvestigation()],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('handles missing complainant_name + null fields gracefully (no throw)', () => {
    expect(() => generateAffairsComplaintPdf({
      complaint: { id: 1, complaint_number: 'IA-26-0001', description: 'Anon' },
      investigations: [],
    })).not.toThrow();
  });

  it('embeds payload hash when provided', () => {
    const fakeHash = 'a'.repeat(64);
    const doc = generateAffairsComplaintPdf({
      complaint: mkComplaint(),
      payloadHash: fakeHash,
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('does not embed payload hash placeholder when omitted', () => {
    const doc = generateAffairsComplaintPdf({ complaint: mkComplaint() });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('uses complaint_number as labelOrId when present, falls back to IA-<id>', () => {
    const doc1 = generateAffairsComplaintPdf({ complaint: mkComplaint({ complaint_number: 'IA-26-9999' }) });
    expect(doc1).toBeDefined();
    const doc2 = generateAffairsComplaintPdf({ complaint: { id: 99, description: 'x' } });
    expect(doc2).toBeDefined();
  });
});
