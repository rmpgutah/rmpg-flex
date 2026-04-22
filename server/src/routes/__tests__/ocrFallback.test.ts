import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Lightweight source-presence smoke test. A full OCR integration test would
// require tesseract on PATH + a scanned-PDF fixture; both are out of scope
// here (tesseract is not yet installed on the VPS, and jsdom workers
// cannot easily spawn system binaries in the test sandbox).
//
// Purpose: guard against the OCR fallback being silently deleted by a
// future refactor of serveIntake.ts — if `ocrFallback` or `tesseract` are
// gone from the source, the test fails, which is what we want.
describe('OCR fallback wiring in serveIntake.ts', () => {
  const src = readFileSync(
    join(__dirname, '..', 'serveIntake.ts'),
    'utf-8',
  );

  it('defines an ocrFallback helper', () => {
    expect(src).toMatch(/async function ocrFallback/);
  });

  it('invokes pdftoppm and tesseract', () => {
    expect(src).toContain('/usr/bin/pdftoppm');
    expect(src).toContain('/usr/bin/tesseract');
  });

  it('wires OCR into pdfBufferToText after pdftotext', () => {
    // Both the short-circuit threshold (<50 chars) and the ocrFallback
    // call must still live in the file.
    expect(src).toMatch(/text\.trim\(\)\.length\s*<\s*50/);
    expect(src).toMatch(/await ocrFallback\(tmpPdf\)/);
  });

  it.skip('extracts text from a scanned PDF via tesseract (requires tesseract on PATH)', () => {
    // Enable once tesseract-ocr is installed on dev + VPS.
  });
});
