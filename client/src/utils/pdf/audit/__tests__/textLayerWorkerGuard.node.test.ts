// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Companion to textLayerWorkerGuard.test.ts, forced onto a plain Node
// environment (no `window`) — matching how extractPdfText is actually
// exercised in CI (tests/**/*.test.ts run against real PDFs).
//
// This only asserts what is honestly observable here: importing
// textLayer.ts must not throw, and must not stomp whatever workerSrc
// pdfjs-dist's own Node-mode static initializer already set (pdfjs-dist
// treats any real Node `process` global as "Node mode" and pre-seeds its
// own internal default, disabling real workers in favor of an in-process
// fake worker — that is correct, deliberate pdfjs behavior, not something
// this module should override). The "assigns a real browser asset URL
// only when a browser window is present" half of the contract is covered
// separately in textLayerWorkerGuard.test.ts against the extracted
// shouldConfigureWorkerSrc function, precisely because pdfjs's own
// Node-mode default makes the real GlobalWorkerOptions object unable to
// distinguish "our guard fired" from "pdfjs's own default fired first" —
// see that file for the full explanation.
describe('textLayer.ts pdfjs worker self-sufficiency (Node environment)', () => {
  it('does not throw on import, and does not overwrite whatever workerSrc pdfjs already configured for Node mode', async () => {
    expect(typeof window).toBe('undefined');

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerSrcBeforeImport = pdfjs.GlobalWorkerOptions.workerSrc;

    await expect(import('../textLayer')).resolves.toBeDefined();

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(workerSrcBeforeImport);
  });
});
