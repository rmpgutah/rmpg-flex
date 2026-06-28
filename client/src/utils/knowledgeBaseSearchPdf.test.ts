// Smoke tests for knowledgeBaseSearchPdf.
//
// jspdf renders fine under vitest/jsdom but produces a binary blob, so the
// goal here is "it doesn't throw on the shapes the page hands it" rather
// than visual-diffing the PDF. Coverage focuses on:
//   • Pure helpers (ellipsize, groupByType) — pure functions, exact assertions.
//   • The generator over each branch it has (empty results, one row, many
//     rows pushing past one page, active type filter, no officer attribution).

import { describe, it, expect } from 'vitest';
import {
  ellipsize,
  groupByType,
  generateKnowledgeBaseSearchPdf,
  type KnowledgeBaseSearchPdfInput,
} from './knowledgeBaseSearchPdf';
import type { KbResult } from './knowledgeBase';

const mkResult = (over: Partial<KbResult> = {}): KbResult => ({
  type: 'person',
  label: 'John Smith',
  title: 'Person record',
  subtitle: 'DOB 1980-01-01',
  route: '/records',
  recordId: 1,
  ...over,
});

const FIXED_DATE = new Date('2026-06-22T20:35:00Z');

describe('knowledgeBaseSearchPdf — helpers', () => {
  describe('ellipsize', () => {
    it('returns the string unchanged when it fits', () => {
      expect(ellipsize('Hello', 10)).toBe('Hello');
      expect(ellipsize('Hello', 5)).toBe('Hello');
    });

    it('truncates with an ellipsis when too long', () => {
      expect(ellipsize('Hello world', 8)).toBe('Hello w…');
      expect(ellipsize('abcdef', 3)).toBe('ab…');
    });

    it('handles undefined / null gracefully', () => {
      expect(ellipsize(undefined, 10)).toBe('');
      // Tolerant of a falsy slice budget (min 1 char preserved before the ellipsis).
      expect(ellipsize('abc', 0)).toBe('a…');
    });
  });

  describe('groupByType', () => {
    it('groups by type while preserving rank order', () => {
      const rs: KbResult[] = [
        mkResult({ type: 'call', label: 'C-1', recordId: 1 }),
        mkResult({ type: 'person', label: 'P-1', recordId: 2 }),
        mkResult({ type: 'call', label: 'C-2', recordId: 3 }),
        mkResult({ type: 'person', label: 'P-2', recordId: 4 }),
      ];
      const out = groupByType(rs);
      expect(out.map(([t]) => t)).toEqual(['call', 'person']);
      expect(out[0][1].map((r) => r.label)).toEqual(['C-1', 'C-2']);
      expect(out[1][1].map((r) => r.label)).toEqual(['P-1', 'P-2']);
    });

    it('returns an empty array for an empty input', () => {
      expect(groupByType([])).toEqual([]);
    });
  });
});

describe('knowledgeBaseSearchPdf — generator', () => {
  const base: KnowledgeBaseSearchPdfInput = {
    query: 'smith',
    results: [],
    officerName: 'Officer Doe',
    badgeNumber: '101',
    generatedAt: FIXED_DATE,
  };

  it('renders an empty-results report without throwing', () => {
    expect(() => generateKnowledgeBaseSearchPdf(base)).not.toThrow();
    const doc = generateKnowledgeBaseSearchPdf(base);
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('renders a mixed-type result set', () => {
    const doc = generateKnowledgeBaseSearchPdf({
      ...base,
      results: [
        mkResult({ type: 'call', label: 'CFS-2026-001', title: 'Welfare Check', subtitle: 'Closed · 100 Main St' }),
        mkResult({ type: 'person', label: 'John Smith', title: 'Person record', subtitle: 'DOB 1980-01-01' }),
        mkResult({ type: 'warrant', label: 'W-2026-007', title: 'John Smith', subtitle: 'Theft · Active' }),
      ],
    });
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('paginates when many rows of a single type push past one page', () => {
    const many: KbResult[] = Array.from({ length: 80 }, (_, i) =>
      mkResult({ type: 'person', label: `Person ${i + 1}`, recordId: i + 1 }),
    );
    const doc = generateKnowledgeBaseSearchPdf({ ...base, results: many });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('reflects the active type filter in the header', () => {
    const doc = generateKnowledgeBaseSearchPdf({
      ...base,
      activeTypeFilter: 'warrant',
      results: [mkResult({ type: 'warrant', label: 'W-1' })],
    });
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('renders without officer attribution', () => {
    const { officerName, badgeNumber, ...rest } = base;
    void officerName;
    void badgeNumber;
    expect(() => generateKnowledgeBaseSearchPdf({
      ...rest,
      results: [mkResult()],
    })).not.toThrow();
  });

  it('includes a case number when provided', () => {
    const doc = generateKnowledgeBaseSearchPdf({
      ...base,
      caseNumber: 'CASE-2026-014',
      results: [mkResult()],
    });
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });
});
