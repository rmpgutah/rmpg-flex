import { describe, it, expect } from 'vitest';
import { renderMultiCopyPdfV2 } from '../multiCopy';
import { citationSchema } from '../../forms/citation';
import { CITATION_INSTRUCTIONS } from '../../forms/citationInstructions';

describe('renderMultiCopyPdfV2', () => {
  it('produces ≥3 pages (one per copy variant, more if continuation needed)', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1', issuing_officer_name: 'ZAMORA' },
      CITATION_INSTRUCTIONS,
    );
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it('emits each copy banner on the page where its copy begins', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1' },
      CITATION_INSTRUCTIONS,
    );
    const pages: any[] = (doc as any).internal.pages;
    const text = pages.map((p) => Array.isArray(p) ? p.join('\n') : String(p ?? ''));

    // The page-marker strings rendered by drawDefaultHeader: every copy-
    // start page contains the form title 'CITATION'. Continuation pages
    // (where the left panel overflowed into a new addPage) do NOT have
    // their header redrawn, so they don't carry the 'CITATION' marker.
    // → Banner pages MUST be a subset of header pages, and each variant's
    // banner must appear on a header page.
    const headerPageIndices = text
      .map((t, i) => (i > 0 && t.includes('CITATION') ? i : -1))
      .filter((i) => i > 0);
    expect(headerPageIndices.length).toBeGreaterThanOrEqual(3);

    for (const variant of CITATION_INSTRUCTIONS) {
      // Use the leading ASCII portion of the banner (jsPDF may encode the
      // em dash differently in the stream, but the leading 'X COPY' is
      // always present as plain ASCII).
      const needle = variant.bannerText.split(' —')[0].split(/\s+--/)[0];
      const bannerPage = text.findIndex((t, i) => i > 0 && t.includes(needle));
      expect(bannerPage, `banner "${needle}" missing`).toBeGreaterThan(0);
      expect(headerPageIndices, `banner "${needle}" landed on a continuation page (${bannerPage}) — expected a copy-start (header) page`).toContain(bannerPage);
    }
  });

  it('renders footers with PAGE N OF M reflecting total page count', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1' },
      CITATION_INSTRUCTIONS,
    );
    const total = doc.getNumberOfPages();
    const pages: any[] = (doc as any).internal.pages;
    const text = pages.map((p) => Array.isArray(p) ? p.join('\n') : String(p ?? ''));
    for (let p = 1; p <= total; p++) {
      expect(text[p]).toContain(`OF ${total}`);
    }
  });
});
