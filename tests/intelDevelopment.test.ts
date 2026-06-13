import { describe, it, expect } from 'vitest';
import {
  gradeLabel,
  nextReportNumber,
  computeReviewDate,
  retentionStatus,
  type IntelReport,
} from '../src/utils/intelDevelopment';

const base: IntelReport = {
  id: 1, report_number: 'INT-2026-0001', title: 't', status: 'submitted',
  source_reliability: null, info_credibility: null, handling_code: null,
  raw_narrative: null, sanitized_narrative: null, assessment: null,
  criminal_predicate: null, rejected_reason: null, recalled_reason: null,
  review_date: null, retention_status: 'active', disseminated_at: null,
};

describe('gradeLabel', () => {
  it('renders the Admiralty pair with words', () => {
    expect(gradeLabel('B', 2)).toBe('B2 — Usually reliable / Probably true');
  });
  it('handles cannot-be-judged grades', () => {
    expect(gradeLabel('F', 6)).toBe('F6 — Cannot be judged / Cannot be judged');
  });
  it('returns UNGRADED when missing', () => {
    expect(gradeLabel(null, null)).toBe('UNGRADED');
  });
});

describe('nextReportNumber', () => {
  it('zero-pads to 4 digits', () => {
    expect(nextReportNumber(2026, 1)).toBe('INT-2026-0001');
    expect(nextReportNumber(2026, 42)).toBe('INT-2026-0042');
  });
});

describe('computeReviewDate', () => {
  it('adds 5 years for a normal handling code', () => {
    expect(computeReviewDate('2026-06-13T00:00:00Z', 'H1')).toBe('2031-06-13');
  });
  it('adds 1 year for no-further-dissemination (H5)', () => {
    expect(computeReviewDate('2026-06-13T00:00:00Z', 'H5')).toBe('2027-06-13');
  });
});

describe('retentionStatus', () => {
  it('flags due_review once review_date passes', () => {
    const r = { ...base, status: 'disseminated', review_date: '2026-01-01', retention_status: 'active' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('due_review');
  });
  it('stays active before review_date', () => {
    const r = { ...base, status: 'disseminated', review_date: '2031-01-01', retention_status: 'active' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('active');
  });
  it('never re-flags an already-purged report', () => {
    const r = { ...base, review_date: '2000-01-01', retention_status: 'purged' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('purged');
  });
});
