// client/src/utils/pdf/v2/engine/__tests__/multiCopy.sidecar.test.ts
import { describe, it, expect } from 'vitest';
import { renderMultiCopyPdfV2 } from '../multiCopy';
import { embedSidecar, outputWithSidecar, extractSidecarFromBytes } from '../sidecar';
import { citationSchema, citationCanonicalData, type CitationData } from '../../forms/citation';
import { CITATION_INSTRUCTIONS } from '../../forms/citationInstructions';

describe('multiCopy + sidecar round-trip', () => {
  it('embeds canonical citation data with violations[] and round-trips', async () => {
    const data: CitationData = {
      citation_number: 'C-26-99',
      violations: [
        {
          statute_citation: 'UCA 41-6a-601',
          description: 'Speeding',
          offense_level: 'Infraction',
          fine_amount: 175,
        },
        {
          statute_citation: 'UCA 41-6a-92',
          description: 'Failure to signal',
          offense_level: 'Infraction',
          fine_amount: 50,
        },
      ],
    };
    const doc = await renderMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS);
    embedSidecar(doc, {
      v: 1,
      schemaId: 'citation',
      formNumber: citationSchema.meta.formNumber,
      caseNumber: 'C-26-99',
      generatedAt: '2026-05-06T00:00:00Z',
      data: citationCanonicalData(data),
    });
    const bytes = outputWithSidecar(doc);
    const extracted = extractSidecarFromBytes(bytes);
    expect(extracted).not.toBeNull();
    expect(extracted!.schemaId).toBe('citation');
    expect(extracted!.caseNumber).toBe('C-26-99');
    const extractedData = extracted!.data as { violations?: unknown[] };
    expect(extractedData.violations).toHaveLength(2);
    expect((extractedData.violations as any)[0].statute_citation).toBe('UCA 41-6a-601');
  });

  it('embeds exactly one sidecar across the 3-page output (Info dict)', async () => {
    const data: CitationData = { citation_number: 'C-26-100' };
    const doc = await renderMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS);
    embedSidecar(doc, {
      v: 1,
      schemaId: 'citation',
      formNumber: citationSchema.meta.formNumber,
      caseNumber: 'C-26-100',
      generatedAt: '2026-05-06T00:00:00Z',
      data: citationCanonicalData(data),
    });
    const bytes = outputWithSidecar(doc);
    // Latin-1 decode like extractSidecarFromBytes does internally.
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    const kwHits = text.match(/\/Keywords\s*\(RMPG-SIDECAR-V1:/g) ?? [];
    expect(kwHits).toHaveLength(1);
    const postEofHits = text.match(/%RMPG_SIDECAR_BEGIN /g) ?? [];
    expect(postEofHits).toHaveLength(1);
  });
});
