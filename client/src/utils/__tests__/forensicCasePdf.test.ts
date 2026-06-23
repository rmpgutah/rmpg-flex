import { describe, it, expect } from 'vitest';
import {
  wrapText,
  fmtTimestamp,
  fmtDate,
  parseChain,
  prettyLabel,
  generateForensicCasePdf,
  type ForensicCaseForPdf,
  type ForensicExhibitForPdf,
  type ForensicAnalysisForPdf,
} from '../forensicCasePdf';

function mkCase(overrides: Partial<ForensicCaseForPdf> = {}): ForensicCaseForPdf {
  return {
    id: 17,
    lab_number: 'FL-2026-0017',
    title: 'Suspect phone — digital extraction',
    case_type: 'digital_forensics',
    status: 'in_progress',
    priority: 'urgent',
    description: 'Phone recovered from suspect at scene; need call log + browser history.',
    requesting_agency: 'RMPG',
    requesting_officer: 'Officer Smith #101',
    lead_examiner_name: 'Examiner Jones',
    linked_incident_number: 'INC-2026-0042',
    received_date: '2026-06-20T10:00:00Z',
    due_date: '2026-07-04T17:00:00Z',
    created_at: '2026-06-20T10:00:00Z',
    ...overrides,
  };
}

function mkExhibit(overrides: Partial<ForensicExhibitForPdf> = {}): ForensicExhibitForPdf {
  return {
    id: 1,
    exhibit_number: 'E-001',
    exhibit_type: 'digital_device',
    description: 'iPhone 14, IMEI 358XXX',
    quantity: 1,
    condition_received: 'Locked, screen intact',
    storage_location: 'Lab vault 3, shelf B',
    collected_by: 'Officer Smith',
    collected_date: '2026-06-20T09:30:00Z',
    hash_sha256: 'a'.repeat(64),
    hash_md5: 'b'.repeat(32),
    disposition: 'in_lab',
    chain_of_custody: JSON.stringify([
      { at: '2026-06-20T10:00:00Z', from: null, to: 'Examiner Jones', reason: 'intake' },
      { at: '2026-06-21T11:00:00Z', from: 'Examiner Jones', to: 'Lab vault 3', reason: 'transfer', notes: 'overnight storage' },
    ]),
    ...overrides,
  };
}

function mkAnalysis(overrides: Partial<ForensicAnalysisForPdf> = {}): ForensicAnalysisForPdf {
  return {
    id: 1,
    analysis_type: 'digital_extraction',
    status: 'in_progress',
    methodology: 'Cellebrite UFED Touch 2, advanced logical extraction',
    equipment_used: 'Cellebrite UFED Touch 2 (serial 12345)',
    analyst_name: 'Examiner Jones',
    started_at: '2026-06-21T09:00:00Z',
    ...overrides,
  };
}

describe('wrapText (forensic pdf)', () => {
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

describe('fmtTimestamp (forensic pdf)', () => {
  it('returns em-dash for missing input', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
  });
  it('formats a UTC timestamp in Mountain Time with MT suffix', () => {
    const out = fmtTimestamp('2026-06-22T14:23:05Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} MT$/);
    expect(out).toContain('2026-06-22');
    expect(out).toContain(' MT');
  });
});

describe('fmtDate (forensic pdf)', () => {
  it('returns em-dash for missing input', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
  });
  it('formats an ISO date in Mountain Time', () => {
    const out = fmtDate('2026-06-22T14:23:05Z');
    expect(out).toMatch(/2026/);
  });
});

describe('parseChain', () => {
  it('returns [] for nullish or empty input', () => {
    expect(parseChain(undefined)).toEqual([]);
    expect(parseChain('')).toEqual([]);
  });
  it('returns the array unchanged when already parsed', () => {
    const arr = [{ at: '2026-06-22T00:00:00Z', to: 'Jones', reason: 'intake' }];
    expect(parseChain(arr)).toBe(arr);
  });
  it('parses a JSON string', () => {
    const json = JSON.stringify([{ at: '2026-06-22T00:00:00Z', to: 'Jones' }]);
    const parsed = parseChain(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].to).toBe('Jones');
  });
  it('falls back to [] on malformed JSON instead of throwing', () => {
    expect(parseChain('not valid json {{{')).toEqual([]);
  });
  it('falls back to [] when the parsed JSON is not an array', () => {
    expect(parseChain('"just a string"')).toEqual([]);
    expect(parseChain('{"a":1}')).toEqual([]);
  });
});

describe('prettyLabel', () => {
  it('returns em-dash for missing input', () => {
    expect(prettyLabel(undefined)).toBe('—');
    expect(prettyLabel('')).toBe('—');
  });
  it('converts snake_case to Title Case', () => {
    expect(prettyLabel('digital_forensics')).toBe('Digital Forensics');
    expect(prettyLabel('chain_of_custody')).toBe('Chain Of Custody');
  });
  it('preserves single-word labels', () => {
    expect(prettyLabel('intake')).toBe('Intake');
  });
});

describe('generateForensicCasePdf', () => {
  it('produces a valid jsPDF with at least one page for a minimal case', () => {
    const doc = generateForensicCasePdf({ case: { id: 1 } });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(1500);
  });

  it('renders a full case with exhibits, analyses, and a payload hash', () => {
    const doc = generateForensicCasePdf({
      case: mkCase(),
      exhibits: [mkExhibit(), mkExhibit({ id: 2, exhibit_number: 'E-002', description: 'SD card from phone' })],
      analyses: [mkAnalysis()],
      preparedBy: 'Sgt. Doe',
      payloadHash: 'a'.repeat(64),
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(3000);
  });

  it('does not crash when payload hash is omitted', () => {
    const doc = generateForensicCasePdf({
      case: mkCase(),
      exhibits: [mkExhibit()],
      analyses: [],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('paginates when given many exhibits (sanity, no crash)', () => {
    const exhibits: ForensicExhibitForPdf[] = [];
    for (let i = 0; i < 25; i++) {
      exhibits.push(mkExhibit({
        id: i + 1,
        exhibit_number: `E-${String(i + 1).padStart(3, '0')}`,
        description: `Exhibit ${i + 1} — long description that takes some space on the page so we definitely overflow the first page when we have a couple dozen of these`,
      }));
    }
    const doc = generateForensicCasePdf({ case: mkCase(), exhibits, analyses: [] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('handles an empty chain_of_custody on an exhibit without throwing', () => {
    const doc = generateForensicCasePdf({
      case: mkCase(),
      exhibits: [mkExhibit({ chain_of_custody: undefined })],
      analyses: [],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('renders the case-level findings + conclusion when present', () => {
    const doc = generateForensicCasePdf({
      case: mkCase({
        findings: 'iPhone successfully unlocked via Cellebrite. Browser history and call log extracted.',
        conclusion: 'Evidence supports the affidavit; full extraction archived to evidence locker.',
      }),
      exhibits: [mkExhibit()],
      analyses: [],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('shows the overdue alert when due_date is past and case is not completed', () => {
    // due_date in the past, no completed_date — should trip the alert path.
    // We can't assert visual output but we verify no crash + non-empty output.
    const doc = generateForensicCasePdf({
      case: mkCase({ due_date: '2025-01-01T00:00:00Z', completed_date: undefined }),
    });
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(1500);
  });
});
