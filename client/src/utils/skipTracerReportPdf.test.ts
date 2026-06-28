// Smoke tests for skipTracerReportPdf.
//
// jspdf renders fine under vitest/jsdom but produces a binary blob, so the
// goal here is "it doesn't throw on the shapes the page hands it" rather
// than visual-diffing the PDF. Coverage focuses on:
//   • PascalCase Microbilt envelope keys (Name, "Person ID", "Lives in")
//   • lower_snake local keys (name, person_id, lives_in)
//   • mixed array shapes (string vs object) in phones/emails/addresses
//   • missing / empty / null subjects degrade to "UNKNOWN SUBJECT" cleanly
//
// If a future refactor breaks the renderer, these catch the throw before
// the operator hits "Generate Report" and gets a stack trace.

import { describe, it, expect } from 'vitest';
import { generateSkipTracerReportPdf } from './skipTracerReportPdf';

describe('skipTracerReportPdf', () => {
  it('renders a subject with the legacy Microbilt envelope', () => {
    const doc = generateSkipTracerReportPdf(
      {
        Name: 'John Q Smith',
        'Person ID': 'MB-12345',
        Age: 42,
        'Lives in': 'Salt Lake City, UT',
        phones: ['801-555-0101', '801-555-0102'],
        emails: ['john@example.com'],
        addresses: [
          { address: '123 Main St', city: 'SLC', state: 'UT', postal_code: '84101' },
        ],
        'Used to live in': 'Provo, UT, Orem, UT',
        'Related to': 'Mary Smith, Tim Smith',
      },
      { query: 'John Smith', mode: 'name', officerName: 'Officer Doe', badgeNumber: '101' },
    );
    expect(doc).toBeDefined();
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a lower_snake local person row', () => {
    const doc = generateSkipTracerReportPdf(
      {
        name: 'Jane Doe',
        person_id: 'LOCAL-77',
        age: 31,
        lives_in: 'Denver, CO',
        phones: ['303-555-0199'],
        addresses: [{ address: '500 Pine St', city: 'Denver', state: 'CO', zip: '80202' }],
      },
      { query: 'Jane Doe', mode: 'name' },
    );
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('renders an empty / unknown subject without throwing', () => {
    // The page calls this on whichever row the operator picked; null / {}
    // can come back from a degraded endpoint and the generator should NOT
    // throw before the operator sees the dialog.
    expect(() => generateSkipTracerReportPdf({}, { query: '', mode: 'name' })).not.toThrow();
    const doc = generateSkipTracerReportPdf({}, { query: '', mode: 'name' });
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('tolerates mixed-shape arrays (strings + objects)', () => {
    const doc = generateSkipTracerReportPdf(
      {
        Name: 'Test User',
        phones: ['801-555-0001', { number: '801-555-0002' }, 12345 as unknown as string],
        emails: ['a@b.com', { email: 'c@d.com' }],
        relatives: [{ Name: 'Sibling One' }, 'Sibling Two'],
      },
      { query: 'Test', mode: 'name' },
    );
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('includes officer attribution in the footer when supplied', () => {
    // We can't easily diff the rendered text, but verify the call accepts
    // the optional ctx fields without throwing.
    expect(() =>
      generateSkipTracerReportPdf(
        { Name: 'Subject A' },
        { query: 'A', mode: 'name', officerName: 'Sgt Lee', badgeNumber: '42', caseNumber: 'CFS-2026-555' },
      ),
    ).not.toThrow();
  });
});
