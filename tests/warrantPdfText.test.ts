import { describe, it, expect } from 'vitest';
import { extractPdfText } from '../src/utils/warrantSources/pdfText';
import { readFileSync } from 'node:fs';

describe('extractPdfText', () => {
  it('returns text from a real PDF buffer', async () => {
    const buf = readFileSync('tests/fixtures/warrants/sample.pdf');
    const text = await extractPdfText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(text.length).toBeGreaterThan(0);
  }, 30000);
});
