import { describe, it, expect, vi } from 'vitest';
import { extractPdfMarkdown, isScanStub } from '../src/utils/serveIntakeExtract';

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);   // "%PDF"

function fakeAi(result: unknown) {
  return { toMarkdown: vi.fn().mockResolvedValue(result) } as any;
}

describe('extractPdfMarkdown', () => {
  it('reports structured when toMarkdown finds real semantic headings beyond the scaffold', async () => {
    // Real live-endpoint shape (verified 2026-07-26): a fixed
    // `# <name>` / `## Metadata` / `## Contents` / `### Page N` scaffold
    // wraps EVERY conversion, but here the page content also carries its
    // own semantic heading (`#### Recipient`) — evidence the converter
    // actually walked the PDF's StructTree, not just flat text.
    const ai = fakeAi({
      name: 'doc.pdf', format: 'markdown', mimetype: 'application/pdf',
      data: '# doc.pdf\n## Metadata\n- PDFFormatVersion=1.4\n## Contents\n### Page 1\n#### Recipient\nPalo Alto, СA 94304',
    });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('tomarkdown');
    expect(out.structured).toBe(true);
    expect(out.text).toContain('CA 94304');   // homoglyph fixed by pre-clean
  });

  it('reports unstructured when toMarkdown returns only the fixed scaffold plus flat text', async () => {
    // Same scaffold as the live endpoint always emits — # name, ## Metadata,
    // ## Contents, ### Page N — but the page body itself has no further
    // heading structure, just flat text. This is what a StructTree-less
    // fallback conversion actually looks like in prod (not the unrealistic
    // bare 'flat text only' this test used to pass), and `structured` must
    // come back false for it.
    const ai = fakeAi({
      name: 'doc.pdf', format: 'markdown',
      data: '# doc.pdf\n## Metadata\n- PDFFormatVersion=1.4\n## Contents\n### Page 1\nflat text only, no further headings',
    });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.structured).toBe(false);
  });

  it('returns empty rather than throwing when toMarkdown reports an error format', async () => {
    const ai = fakeAi({ name: 'doc.pdf', format: 'error', error: 'unsupported' });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('empty');
    expect(out.text).toBe('');
  });

  it('returns empty when the binding throws, so the caller can fall back', async () => {
    const ai = { toMarkdown: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('empty');
  });

  it('accepts an array response and picks the matching document', async () => {
    const ai = fakeAi([{ name: 'doc.pdf', format: 'markdown', data: '# A\ncontent here' }]);
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.text).toContain('content here');
  });
});

describe('isScanStub', () => {
  it('flags a page with almost no extractable text', () => {
    expect(isScanStub('', 1)).toBe(true);
    expect(isScanStub('  \n \n', 1)).toBe(true);
  });

  it('does not flag a page with real content', () => {
    expect(isScanStub('Case 900904528 Plaintiff AVERY LANE HOLT', 1)).toBe(false);
  });

  it('scales the threshold with page count', () => {
    const thin = 'x'.repeat(100);
    expect(isScanStub(thin, 10)).toBe(true);    // 10 chars/page — a scan
    expect(isScanStub(thin, 1)).toBe(false);    // 100 chars on 1 page — thin but real
  });
});
