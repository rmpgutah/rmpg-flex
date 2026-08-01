import { describe, it, expect } from 'vitest';
import { shouldConfigureWorkerSrc } from '../textLayer';

// Regression test for the 2026-07-31 gallery outage: textLayer.ts used to
// have no worker configuration of its own and depended on renderToCanvas.ts
// (importing the same legacy pdfjs specifier) configuring
// GlobalWorkerOptions as a side effect. When renderToCanvas.ts switched to
// the standard pdfjs-dist build, that side effect vanished and
// extractPdfText broke in the browser with
// "No GlobalWorkerOptions.workerSrc specified".
//
// This asserts the GUARD'S OWN DECISION LOGIC directly, via the exported
// `shouldConfigureWorkerSrc`, rather than driving it through the real
// `pdfjs.GlobalWorkerOptions` object end-to-end. That end-to-end path is
// NOT a meaningful test here: pdfjs-dist's own `PDFWorker` static
// initializer treats any run under a real Node `process` global —
// including this project's default jsdom test environment, which does not
// remove `process` — as "Node mode" and pre-seeds
// `GlobalWorkerOptions.workerSrc` with its own internal default before our
// guard runs at all. That would mask whether our guard fired, which is
// exactly the kind of masking that let the original bug hide through 15
// tests and four review rounds. Testing the extracted pure function
// sidesteps that masking and verifies the actual logic we wrote and
// control.
describe('textLayer.ts shouldConfigureWorkerSrc', () => {
  it('assigns when a browser window is present and nothing has configured a workerSrc yet', () => {
    expect(shouldConfigureWorkerSrc(true, undefined)).toBe(true);
  });

  it('does not clobber a workerSrc some other module already configured', () => {
    expect(shouldConfigureWorkerSrc(true, 'https://example.test/already-set.mjs')).toBe(false);
  });

  it('never assigns when there is no browser window (the Node/CI path)', () => {
    expect(shouldConfigureWorkerSrc(false, undefined)).toBe(false);
    expect(shouldConfigureWorkerSrc(false, 'anything')).toBe(false);
  });
});
