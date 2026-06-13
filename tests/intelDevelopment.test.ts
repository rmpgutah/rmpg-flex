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

import { canTransition, confidenceScore } from '../src/utils/intelDevelopment';

const graded: IntelReport = {
  ...base, status: 'graded',
  source_reliability: 'B', info_credibility: 2, handling_code: 'H1',
  sanitized_narrative: 'clean', assessment: 'significant', criminal_predicate: 'theft pattern',
};

describe('canTransition', () => {
  it('lets a supervisor claim a submitted report', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'under_evaluation', 'supervisor').ok).toBe(true);
  });
  it('blocks an officer from grading', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: 1, handling_code: 'H1' };
    expect(canTransition(r, 'graded', 'officer').ok).toBe(false);
  });
  it('requires a full grade before graded', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: null, handling_code: 'H1' };
    const res = canTransition(r, 'graded', 'supervisor');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/grade|credibility/i);
  });
  it('allows grading a fully-graded report', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: 1, handling_code: 'H1' };
    expect(canTransition(r, 'graded', 'supervisor').ok).toBe(true);
  });
  it('requires sanitized narrative + assessment + predicate before analyzed', () => {
    const r = { ...graded, sanitized_narrative: null };
    expect(canTransition(r, 'analyzed', 'supervisor').ok).toBe(false);
  });
  it('allows dissemination of an analyzed, fully-prepared report', () => {
    expect(canTransition({ ...graded, status: 'analyzed' }, 'disseminated', 'supervisor').ok).toBe(true);
  });
  it('requires a reason to reject', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'rejected', 'supervisor').ok).toBe(false);
    expect(canTransition({ ...base, status: 'submitted', rejected_reason: 'no predicate' }, 'rejected', 'supervisor').ok).toBe(true);
  });
  it('requires a reason to recall', () => {
    expect(canTransition({ ...graded, status: 'disseminated' }, 'recalled', 'supervisor').ok).toBe(false);
    expect(canTransition({ ...graded, status: 'disseminated', recalled_reason: 'error' }, 'recalled', 'supervisor').ok).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'disseminated', 'supervisor').ok).toBe(false);
  });
});

describe('confidenceScore', () => {
  it('is highest for A1', () => {
    expect(confidenceScore('A', 1)).toBe(100);
  });
  it('is lowest for E5', () => {
    expect(confidenceScore('E', 5)).toBeLessThanOrEqual(20);
  });
  it('treats cannot-be-judged (F/6) as neutral, not worst', () => {
    expect(confidenceScore('F', 6)).toBeGreaterThan(confidenceScore('E', 5));
  });
  it('returns 0 when ungraded', () => {
    expect(confidenceScore(null, null)).toBe(0);
  });
});
