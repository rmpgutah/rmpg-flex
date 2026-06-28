// Smoke tests for webResearchReportPdf.
//
// jspdf renders fine under vitest/jsdom but produces a binary blob, so the
// goal here is "it doesn't throw on the shapes the page hands it" rather
// than visual-diffing the PDF. Coverage focuses on:
//   • the canonical SavedResult shape (search / scrape entries)
//   • mixed entries with operator notes + entity linking
//   • scraped excerpts that exceed the 2000-char truncation boundary
//   • an empty corpus (operator exported with a filter that matched nothing)
//   • optional officer attribution + case number on the cover

import { describe, it, expect } from 'vitest';
import { generateWebResearchReportPdf } from './webResearchReportPdf';

const baseRow = {
  id: 1,
  query: 'subject background osint',
  title: 'Example OSINT Source',
  url: 'https://example.com/osint',
  description: 'Source profile excerpt from the search index.',
  type: 'search' as const,
  notes: null,
  linked_entity_type: null,
  linked_entity_id: null,
  scraped_content: null,
  created_at: '2026-06-22T12:00:00Z',
};

describe('webResearchReportPdf', () => {
  it('renders an all-filter corpus with a mix of search + scrape rows', () => {
    const doc = generateWebResearchReportPdf(
      [
        { ...baseRow, id: 1 },
        { ...baseRow, id: 2, type: 'scrape', title: 'Scraped Page', scraped_content: 'Long markdown extracted here...' },
      ],
      { filter: 'all', officerName: 'Sgt Lee', badgeNumber: '42' },
    );
    expect(doc).toBeDefined();
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders rows with operator notes + linked entities', () => {
    const doc = generateWebResearchReportPdf(
      [
        {
          ...baseRow,
          id: 3,
          notes: 'Verified subject lived at this address 2024-2025; CONFIRM via property records.',
          linked_entity_type: 'incident',
          linked_entity_id: 9001,
        },
      ],
      { filter: 'incident' },
    );
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('truncates a very large scraped excerpt without throwing', () => {
    const giantContent = 'lorem ipsum '.repeat(5000); // ~60k chars
    const doc = generateWebResearchReportPdf(
      [{ ...baseRow, id: 4, type: 'scrape', scraped_content: giantContent }],
      { filter: 'all' },
    );
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('renders an empty corpus as a documented "nothing matched" page', () => {
    expect(() => generateWebResearchReportPdf([], { filter: 'unlinked' })).not.toThrow();
    const doc = generateWebResearchReportPdf([], { filter: 'unlinked' });
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('accepts optional officer + case attribution without throwing', () => {
    expect(() =>
      generateWebResearchReportPdf(
        [baseRow],
        { filter: 'case', officerName: 'Officer Doe', badgeNumber: '101', caseNumber: 'CFS-2026-555' },
      ),
    ).not.toThrow();
  });

  it('tolerates rows with missing optional fields (degraded server payload)', () => {
    const partial = {
      id: 99,
      query: '',
      title: '',
      url: 'https://no-title.example.com/',
      description: '',
      type: 'search',
      notes: null,
      linked_entity_type: null,
      linked_entity_id: null,
      scraped_content: null,
      created_at: '',
    };
    expect(() => generateWebResearchReportPdf([partial as never], { filter: 'all' })).not.toThrow();
  });
});
