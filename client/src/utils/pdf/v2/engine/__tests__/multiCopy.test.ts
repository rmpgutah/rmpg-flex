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

  it('emits each copy banner on its own page', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1' },
      CITATION_INSTRUCTIONS,
    );
    const pages: any[] = (doc as any).internal.pages;
    const text = pages.map((p) => Array.isArray(p) ? p.join('\n') : String(p ?? '')).join('\n---PAGE---\n');
    expect(text).toContain('VIOLATOR COPY');
    expect(text).toContain('OFFICER COPY');
    expect(text).toContain('ADMINISTRATIVE COPY');
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
