import { describe, it, expect, vi } from 'vitest';
import { extractPdfMarkdown, isScanStub } from '../src/utils/serveIntakeExtract';

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);   // "%PDF"

function fakeAi(result: unknown) {
  return { toMarkdown: vi.fn().mockResolvedValue(result) } as any;
}

describe('extractPdfMarkdown', () => {
  it('returns pre-cleaned markdown when toMarkdown succeeds', async () => {
    const ai = fakeAi({
      name: 'doc.pdf', format: 'markdown', mimetype: 'application/pdf',
      data: '## Contents\n### Page 1\nPalo Alto, СA 94304',
    });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('tomarkdown');
    expect(out.structured).toBe(true);
    expect(out.text).toContain('CA 94304');   // homoglyph fixed by pre-clean
  });

  it('reports unstructured when toMarkdown returns no heading structure', async () => {
    const ai = fakeAi({ name: 'doc.pdf', format: 'markdown', data: 'flat text only' });
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
